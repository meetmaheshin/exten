import { safeStorage, app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs";

/**
 * Encrypted credential store using Electron's safeStorage.
 * Uses OS-level encryption (DPAPI on Windows, Keychain on macOS, libsecret on Linux).
 */
export class SecureStore {
  private filePath: string;
  private cache = new Map<string, string>();

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "credentials.enc");
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const entries: Array<{ key: string; value: string }> = JSON.parse(raw);
      for (const entry of entries) {
        try {
          const decrypted = safeStorage.decryptString(Buffer.from(entry.value, "base64"));
          this.cache.set(entry.key, decrypted);
        } catch {
          // Skip corrupted entries
        }
      }
    } catch {
      // Fresh start
    }
  }

  private persist(): void {
    try {
      const entries: Array<{ key: string; value: string }> = [];
      for (const [key, value] of this.cache) {
        const encrypted = safeStorage.encryptString(value);
        entries.push({ key, value: encrypted.toString("base64") });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(entries), "utf-8");
    } catch {
      // Non-critical
    }
  }

  get(key: string): string | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: string): void {
    this.cache.set(key, value);
    this.persist();
  }

  delete(key: string): void {
    this.cache.delete(key);
    this.persist();
  }
}
