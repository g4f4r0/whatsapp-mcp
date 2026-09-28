/**
 * SIGINT/SIGTERM + unhandled-startup-error wiring shared by the two process
 * entrypoints (main.ts for a single account, gateway-main.ts for the
 * gateway) — both need "flush logs and exit 0 on a clean shutdown, exit 1 on
 * a startup crash," differing only in what shutdown itself does.
 */

import type { Logger } from "pino";

export interface LifecycleOptions {
  waLogger: Logger;
  mcpLogger: Logger;
  /** Runs on SIGINT/SIGTERM before logs are flushed and the process exits 0. */
  onShutdown: (signal: string) => void | Promise<void>;
  /** The already-started main() promise — startup errors here exit 1. */
  main: Promise<void>;
  /** Named in the fatal-error log line, e.g. "application" or "gateway". */
  label: string;
}

export function installLifecycle(opts: LifecycleOptions): void {
  const { waLogger, mcpLogger } = opts;

  async function shutdown(signal: string) {
    mcpLogger.info(`Received ${signal}. Shutting down gracefully...`);
    await opts.onShutdown(signal);
    waLogger.flush();
    mcpLogger.flush();
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  opts.main.catch((error) => {
    mcpLogger.fatal({ err: error }, `Unhandled error during ${opts.label} startup`);
    waLogger.flush();
    mcpLogger.flush();
    process.exit(1);
  });
}
