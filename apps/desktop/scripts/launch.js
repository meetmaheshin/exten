/**
 * Launch Electron with pnpm compatibility fix.
 *
 * Problem: pnpm symlinks electron npm package to node_modules/electron,
 * which shadows Electron's internal require('electron') module.
 *
 * Fix: Remove the symlink before launching, restore after exit.
 * Inside Electron process, require('electron') then resolves to the internal API.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const projectDir = path.join(__dirname, "..");
const electronBin = require("electron");
const nmElectron = path.join(projectDir, "node_modules", "electron");
const nmElectronBak = nmElectron + "._bak_";

function hide() {
  try {
    if (fs.existsSync(nmElectron) && !fs.existsSync(nmElectronBak)) {
      fs.renameSync(nmElectron, nmElectronBak);
      return true;
    }
  } catch {}
  return false;
}

function restore() {
  try {
    if (fs.existsSync(nmElectronBak)) {
      // Remove electron if it was recreated
      if (fs.existsSync(nmElectron)) {
        fs.rmSync(nmElectron, { recursive: true, force: true });
      }
      fs.renameSync(nmElectronBak, nmElectron);
    }
  } catch {}
}

// Also check root node_modules
const rootNmElectron = path.join(projectDir, "..", "..", "node_modules", "electron");
const rootNmElectronBak = rootNmElectron + "._bak_";
let hidRoot = false;

function hideRoot() {
  try {
    if (fs.existsSync(rootNmElectron) && !fs.existsSync(rootNmElectronBak)) {
      fs.renameSync(rootNmElectron, rootNmElectronBak);
      return true;
    }
  } catch {}
  return false;
}

function restoreRoot() {
  try {
    if (fs.existsSync(rootNmElectronBak)) {
      if (fs.existsSync(rootNmElectron)) {
        fs.rmSync(rootNmElectron, { recursive: true, force: true });
      }
      fs.renameSync(rootNmElectronBak, rootNmElectron);
    }
  } catch {}
}

const hidden = hide();
hidRoot = hideRoot();

const child = spawn(electronBin, ["."], {
  cwd: projectDir,
  stdio: "inherit",
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
});

child.on("exit", (code) => {
  if (hidden) restore();
  if (hidRoot) restoreRoot();
  process.exit(code || 0);
});

process.on("SIGINT", () => {
  if (hidden) restore();
  if (hidRoot) restoreRoot();
  child.kill();
});

process.on("SIGTERM", () => {
  if (hidden) restore();
  if (hidRoot) restoreRoot();
  child.kill();
});
