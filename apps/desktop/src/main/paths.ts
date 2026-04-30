import { app } from "electron";
import * as path from "node:path";

/**
 * Path to the app icon that's safe to hand to OS APIs (tray, notifications).
 *
 * In dev: dist/main/index.js → ../../resources/icon.png inside the repo.
 * In a packaged build: process.resourcesPath/icon.png — this is the file
 * mirrored via electron-builder's extraResources, *outside* app.asar.
 * Linux notification daemons in particular can't always read files from
 * inside an asar archive, so we pin to the unpacked copy.
 */
export function getIconPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon.png");
  }
  return path.join(__dirname, "..", "..", "resources", "icon.png");
}
