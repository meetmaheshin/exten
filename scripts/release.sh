#!/usr/bin/env bash
# Cut a new release.
#
# Usage:   scripts/release.sh <version>      (e.g. scripts/release.sh 0.2.4)
#
# What it does:
#   1) Bumps version in apps/extension/package.json, CURRENT_VERSION in
#      apps/extension/src/extension.ts, and the /api/version response in
#      apps/backend/src/app.ts
#   2) Rebuilds the .vsix and (optionally) the desktop installer
#   3) Renames artifacts to stable names that match the dashboard's
#      releases/latest/download URLs
#   4) Creates a git tag and pushes it
#   5) Creates a GitHub Release on dmahaesh/ailancers-code with all artifacts
#      attached
#
# Requires:
#   - gh CLI authenticated (run `gh auth login` once)
#   - pnpm available
#   - Write access to dmahaesh/ailancers-code on GitHub
#
# After it runs the dashboard download URLs (releases/latest/download/...)
# automatically point at the new artifacts. No URL updates needed.

set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "usage: scripts/release.sh <version>"
  echo "example: scripts/release.sh 0.2.4"
  exit 1
fi

VERSION="$1"
RELEASE_REPO="dmahaesh/ailancers-code"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo ""
echo "─── Releasing v$VERSION ───────────────────────────────────"
echo ""

# ── 1. Version bumps ──
echo "[1/5] Bumping version strings…"

# apps/extension/package.json
node -e "
  const fs = require('fs');
  const path = 'apps/extension/package.json';
  const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
  pkg.version = '$VERSION';
  fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  console.log('  apps/extension/package.json → ' + pkg.version);
"

# apps/extension/src/extension.ts (CURRENT_VERSION constant)
node -e "
  const fs = require('fs');
  const path = 'apps/extension/src/extension.ts';
  let src = fs.readFileSync(path, 'utf8');
  src = src.replace(/const CURRENT_VERSION = \"[^\"]*\";/, 'const CURRENT_VERSION = \"$VERSION\";');
  fs.writeFileSync(path, src);
  console.log('  apps/extension/src/extension.ts CURRENT_VERSION → $VERSION');
"

# apps/backend/src/app.ts (/api/version response — extension only;
# desktop tracker has its own version cycle)
node -e "
  const fs = require('fs');
  const path = 'apps/backend/src/app.ts';
  let src = fs.readFileSync(path, 'utf8');
  src = src.replace(/extension: \{ version: \"[^\"]*\"/, 'extension: { version: \"$VERSION\"');
  fs.writeFileSync(path, src);
  console.log('  apps/backend/src/app.ts /api/version → $VERSION');
"

# ── 2. Build the VSIX ──
echo ""
echo "[2/5] Building extension .vsix…"
pnpm --filter ailancers-code package > /dev/null
VSIX_FILE="apps/extension/ailancers-code-$VERSION.vsix"
if [ ! -f "$VSIX_FILE" ]; then
  echo "ERROR: expected $VSIX_FILE not found after build"
  exit 1
fi
echo "  built $VSIX_FILE ($(du -h "$VSIX_FILE" | cut -f1))"

# Make a copy with the stable name the dashboard URL expects
cp "$VSIX_FILE" "apps/extension/ailancers-code.vsix"

# ── 3. (Optional) collect desktop artifacts if present ──
echo ""
echo "[3/5] Collecting desktop artifacts (if available)…"
DESKTOP_ARTIFACTS=()
WIN_EXE=$(ls apps/desktop/out/Ailancers\ Tracker\ Setup\ *.exe 2>/dev/null | head -1 || true)
DEB_FILE=$(ls apps/desktop/out/ailancers-tracker-*-x64.deb 2>/dev/null | head -1 || true)
TGZ_FILE=$(ls apps/desktop/out/ailancers-tracker-*-x64.tar.gz 2>/dev/null | head -1 || true)
if [ -n "$WIN_EXE" ]; then
  cp "$WIN_EXE" "apps/desktop/out/Ailancers-Tracker-Setup.exe"
  DESKTOP_ARTIFACTS+=("apps/desktop/out/Ailancers-Tracker-Setup.exe")
  echo "  Windows installer: $(basename "$WIN_EXE")"
fi
if [ -n "$DEB_FILE" ]; then
  cp "$DEB_FILE" "apps/desktop/out/ailancers-tracker-x64.deb"
  DESKTOP_ARTIFACTS+=("apps/desktop/out/ailancers-tracker-x64.deb")
  echo "  Linux .deb:        $(basename "$DEB_FILE")"
fi
if [ -n "$TGZ_FILE" ]; then
  cp "$TGZ_FILE" "apps/desktop/out/ailancers-tracker-x64.tar.gz"
  DESKTOP_ARTIFACTS+=("apps/desktop/out/ailancers-tracker-x64.tar.gz")
  echo "  Linux .tar.gz:     $(basename "$TGZ_FILE")"
fi
if [ ${#DESKTOP_ARTIFACTS[@]} -eq 0 ]; then
  echo "  (no desktop artifacts found — only .vsix will be uploaded)"
fi

# ── 4. Commit + tag + push ──
echo ""
echo "[4/5] Committing, tagging, pushing…"
git add apps/extension/package.json apps/extension/src/extension.ts apps/backend/src/app.ts
if git diff --cached --quiet; then
  echo "  (no version changes to commit — already at $VERSION)"
else
  git commit -m "Bump version to $VERSION"
fi
git tag -f "v$VERSION"
git push origin main 2>&1 | tail -3 || echo "  (push to origin failed; continuing — you can push manually)"
git push origin "v$VERSION" --force 2>&1 | tail -3 || echo "  (push tag to origin failed; continuing)"

# ── 5. Create the GitHub Release ──
echo ""
echo "[5/5] Creating GitHub Release on $RELEASE_REPO…"

# On Windows the gh CLI is at "C:\Program Files\GitHub CLI\gh.exe" and
# Git Bash doesn't always have it on PATH. Try a few well-known locations.
GH_CMD=""
if command -v gh >/dev/null 2>&1; then
  GH_CMD="gh"
elif [ -x "/c/Program Files/GitHub CLI/gh.exe" ]; then
  GH_CMD="/c/Program Files/GitHub CLI/gh.exe"
elif [ -x "/c/Program Files (x86)/GitHub CLI/gh.exe" ]; then
  GH_CMD="/c/Program Files (x86)/GitHub CLI/gh.exe"
elif [ -x "$LOCALAPPDATA/Programs/GitHub CLI/gh.exe" ]; then
  GH_CMD="$LOCALAPPDATA/Programs/GitHub CLI/gh.exe"
else
  echo "ERROR: gh CLI not found. Install with 'winget install GitHub.cli' (Windows) or your distro's package manager, then run 'gh auth login'."
  exit 1
fi

"$GH_CMD" release create "v$VERSION" \
  --repo "$RELEASE_REPO" \
  --title "v$VERSION" \
  --notes "Release $VERSION. See git log for changes." \
  "apps/extension/ailancers-code.vsix" \
  "${DESKTOP_ARTIFACTS[@]}"

echo ""
echo "─── Done. Release v$VERSION live at: ──────────────────────"
echo "https://github.com/$RELEASE_REPO/releases/tag/v$VERSION"
echo ""
echo "Download URLs (stable, no need to update anywhere):"
echo "  https://github.com/$RELEASE_REPO/releases/latest/download/ailancers-code.vsix"
echo "  https://github.com/$RELEASE_REPO/releases/latest/download/Ailancers-Tracker-Setup.exe"
echo "  https://github.com/$RELEASE_REPO/releases/latest/download/ailancers-tracker-x64.deb"
echo "  https://github.com/$RELEASE_REPO/releases/latest/download/ailancers-tracker-x64.tar.gz"
echo ""
echo "Don't forget to redeploy the backend so /api/version reports $VERSION."
