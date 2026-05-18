#!/bin/bash
# Debian/RPM postinst hook for Ailancers Tracker.
#
# Electron embeds Chromium, which needs its `chrome-sandbox` helper to be
# setuid-root (mode 4755). Without this, every launch dies with:
#   "FATAL:setuid_sandbox_host.cc(158) The SUID sandbox helper binary was
#    found, but is not configured correctly."
#
# electron-builder generates the .deb but doesn't apply the right mode by
# default — Debian's packaging policy actively strips setuid bits during
# fakeroot build, so the file ends up 0755. We restore it here at install
# time, when the script is running as real root.
#
# References:
#   - https://github.com/electron-userland/electron-builder/issues/2781
#   - https://github.com/electron/electron/issues/17972
set -e

# Install directory comes from productName in electron-builder.yml. After
# fixing the zygote-truncates-at-space bug, productName is "Ailancers-Tracker"
# (hyphen) so the directory is /opt/Ailancers-Tracker/.
#
# Belt-and-suspenders: also try the old spaced path, in case someone is
# upgrading from a v0.2.18-or-earlier install where dpkg's upgrade logic
# left the spaced directory behind.
for SANDBOX in \
  "/opt/Ailancers-Tracker/chrome-sandbox" \
  "/opt/Ailancers Tracker/chrome-sandbox"; do
  if [ -f "$SANDBOX" ]; then
    chown root:root "$SANDBOX"
    chmod 4755 "$SANDBOX"
  fi
done

exit 0
