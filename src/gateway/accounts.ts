/**
 * Reads the account configs `wa-account add` writes — one `<account>.env` file
 * per WhatsApp account under `WHATSAPP_MCP_ACCOUNTS_DIR`. Each file was already
 * assigned its own port block (MCP_PORT/QR_SERVER_PORT/STREAM_SERVER_PORT); the
 * gateway reuses those as the child's *internal* ports (loopback-only, never
 * registered anywhere) instead of inventing a second scheme.
 */

import fs from "node:fs";
import path from "node:path";

export interface AccountConfig {
  /** Directory-derived name, e.g. "business" (from business.env). */
  name: string;
  expectedWaNumber: string;
  mcpPort: number;
  qrPort: number;
  streamPort: number;
}

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

export function defaultAccountsDir(): string {
  return (
    process.env.WHATSAPP_MCP_ACCOUNTS_DIR ??
    path.join(process.env.HOME ?? "", ".config/whatsapp-mcp/accounts")
  );
}

/** Reads every `<account>.env` in `accountsDir`, sorted by account name. Missing dir → []. */
export function loadAccounts(accountsDir: string): AccountConfig[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(accountsDir).filter((f) => f.endsWith(".env"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const accounts: AccountConfig[] = [];
  for (const entry of entries.sort()) {
    const name = entry.slice(0, -".env".length);
    const raw = parseEnvFile(fs.readFileSync(path.join(accountsDir, entry), "utf8"));

    const expectedWaNumber = raw.EXPECTED_WA_NUMBER;
    const mcpPort = Number(raw.MCP_PORT);
    const qrPort = Number(raw.QR_SERVER_PORT);
    const streamPort = Number(raw.STREAM_SERVER_PORT);
    if (
      !expectedWaNumber ||
      !Number.isInteger(mcpPort) ||
      !Number.isInteger(qrPort) ||
      !Number.isInteger(streamPort)
    ) {
      throw new Error(`invalid account config: ${path.join(accountsDir, entry)}`);
    }

    accounts.push({ name, expectedWaNumber, mcpPort, qrPort, streamPort });
  }
  return accounts;
}
