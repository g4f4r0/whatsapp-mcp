/**
 * Entrypoint for the multi-account gateway (ops: run-whatsapp-mcp.sh). One
 * process, one public MCP server, one child per configured account. See
 * src/gateway/server.ts for the wiring.
 */

import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import { startGateway } from "./gateway/server.ts";
import { installLifecycle } from "./process-lifecycle.ts";

const dataRoot =
  process.env.WHATSAPP_MCP_DATA_ROOT ||
  path.join(process.env.HOME ?? "", ".local/share/whatsapp-mcp");
const gatewayLogDir = process.env.WHATSAPP_MCP_GATEWAY_LOG_DIR || dataRoot;
fs.mkdirSync(gatewayLogDir, { recursive: true });

function createAppLogger(filename: string) {
  return pino(
    { level: process.env.LOG_LEVEL || "info", timestamp: pino.stdTimeFunctions.isoTime },
    pino.destination(path.join(gatewayLogDir, filename)),
  );
}

const waLogger = createAppLogger("gateway-wa-logs.txt");
const mcpLogger = createAppLogger("gateway-mcp-logs.txt");

let handle: Awaited<ReturnType<typeof startGateway>> | null = null;

async function main() {
  mcpLogger.info("Starting WhatsApp MCP gateway...");
  handle = await startGateway({
    appDir: path.join(import.meta.dirname, ".."),
    dataRoot,
    mcpLogger,
    waLogger,
  });
  mcpLogger.info({ accounts: handle.children.map((c) => c.account.name) }, "gateway ready");
}

installLifecycle({
  waLogger,
  mcpLogger,
  onShutdown: () => handle?.stop(),
  main: main(),
  label: "gateway",
});
