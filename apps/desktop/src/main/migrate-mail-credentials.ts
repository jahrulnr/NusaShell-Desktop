import { safeStorage } from "electron";
import { readFile, unlink, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Buffer } from "node:buffer";

/**
 * One-time migration: decrypts legacy `mail-settings.json` (encrypted with
 * Electron safeStorage) and writes the accounts to the new plugin-managed
 * store file `accounts.dat` (base64-encoded JSON) that the Mail MCP reads
 * directly via `NUSASHELL_USER_DATA`.
 *
 * This file is temporary migration glue and can be removed after one release
 * cycle once existing users have migrated. It exists because the old store
 * used Electron-specific safeStorage encryption that the MCP process (a
 * plain Node.js child process) cannot decrypt.
 *
 * No-op when the legacy file is missing or the target already exists.
 */
export async function migrateMailCredentials(
  legacyPath: string,
  targetPath: string,
): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) return;

  let legacyRaw: string;
  try {
    legacyRaw = await readFile(legacyPath, "utf8");
  } catch {
    return;
  }

  let parsed: { accounts?: unknown[] };
  try {
    parsed = JSON.parse(legacyRaw) as { accounts?: unknown[] };
  } catch {
    return;
  }

  if (!Array.isArray(parsed.accounts) || parsed.accounts.length === 0) {
    try { await unlink(legacyPath); } catch {}
    return;
  }

  const accounts: unknown[] = [];
  for (const entry of parsed.accounts) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const passwordField = raw.password;
    if (typeof passwordField !== "string") continue;
    try {
      const decrypted = safeStorage.decryptString(Buffer.from(passwordField, "base64"));
      accounts.push({
        id: raw.id,
        name: raw.name,
        email: raw.email,
        username: raw.username,
        password: decrypted,
        enabled: raw.enabled ?? true,
        imap: raw.imap,
        smtp: raw.smtp,
      });
    } catch {
      continue;
    }
  }

  if (accounts.length === 0) {
    try { await unlink(legacyPath); } catch {}
    return;
  }

  await mkdir(dirname(targetPath), { recursive: true });
  const encoded = Buffer.from(JSON.stringify(accounts), "utf8").toString("base64");
  await writeFile(targetPath, encoded, { mode: 0o600 });
  try { await unlink(legacyPath); } catch {}
}
