/**
 * Spawns and supervises one child process per WhatsApp account. Each child is
 * exactly today's single-account app (src/main.ts, unchanged): its own Baileys
 * socket, SQLite DB, send-pacer/blocklist/cold-contact state and MCP/QR/stream
 * servers — all bound to 127.0.0.1 on the account's already-assigned port block,
 * never exposed directly. The gateway is the only thing that talks to them.
 */

import { type ChildProcess, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Logger } from "pino";
import type { AccountConfig } from "./accounts.ts";

export interface ChildHandle {
  account: AccountConfig;
  stop(): void;
}

export interface SpawnChildrenOptions {
  /** Repo root — cwd for `node src/main.ts`. */
  appDir: string;
  /** `~/.local/share/whatsapp-mcp` — each account keeps its existing `<name>/` subdir. */
  dataRoot: string;
  /** Shared secret for gateway↔child calls only (never the real WHATSAPP_MCP_AUTH_TOKEN). */
  internalToken: string;
  logger: Logger;
  /** Delay before respawning a crashed child. Default 15s, matching the old per-account loop. */
  restartDelayMs?: number;
}

/** Same no-cold-messaging / rate-limit guardrails every account has always run under. */
const SEND_GUARDRAILS = {
  SEND_COLD_OVERRIDE: "deny",
  SEND_RATE_LIMIT_PER_HOUR: "20",
};

export function spawnChild(account: AccountConfig, opts: SpawnChildrenOptions): ChildHandle {
  let stopped = false;
  let proc: ChildProcess | null = null;
  const restartDelayMs = opts.restartDelayMs ?? 15_000;
  const dataDir = path.join(opts.dataRoot, account.name);

  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const daemonLogPath = path.join(dataDir, "daemon.log");

  /** Best-effort: a stop()/cleanup racing with a child's exit must never crash the gateway. */
  function appendLog(line: string): void {
    try {
      fs.appendFileSync(daemonLogPath, line);
    } catch {
      /* best effort */
    }
  }

  function launch(): void {
    if (stopped) return;

    appendLog(`${new Date().toISOString()} gateway starting child\n`);
    const logFd = fs.openSync(daemonLogPath, "a");

    proc = spawn(process.execPath, ["--experimental-strip-types", "src/main.ts"], {
      cwd: opts.appDir,
      env: {
        ...process.env,
        WHATSAPP_MCP_DATA_DIR: dataDir,
        EXPECTED_WA_NUMBER: account.expectedWaNumber,
        MCP_TRANSPORT: "httpstream",
        MCP_HOST: "127.0.0.1",
        MCP_PORT: String(account.mcpPort),
        MCP_AUTH_TOKEN: opts.internalToken,
        QR_SERVER_HOST: "127.0.0.1",
        QR_SERVER_PORT: String(account.qrPort),
        STREAM_SERVER_HOST: "127.0.0.1",
        STREAM_SERVER_PORT: String(account.streamPort),
        ...SEND_GUARDRAILS,
      },
      stdio: ["ignore", logFd, logFd],
    });
    fs.closeSync(logFd);

    opts.logger.info({ account: account.name, pid: proc.pid }, "spawned account child");

    proc.on("exit", (code, signal) => {
      opts.logger.warn({ account: account.name, code, signal }, "account child exited");
      appendLog(
        `${new Date().toISOString()} exited (code=${code} signal=${signal}), restarting in ${restartDelayMs / 1000}s\n`,
      );
      proc = null;
      if (!stopped) setTimeout(launch, restartDelayMs);
    });
  }

  launch();

  return {
    account,
    stop() {
      stopped = true;
      proc?.kill("SIGTERM");
    },
  };
}

export function spawnChildren(
  accounts: AccountConfig[],
  opts: SpawnChildrenOptions,
): ChildHandle[] {
  return accounts.map((account) => spawnChild(account, opts));
}
