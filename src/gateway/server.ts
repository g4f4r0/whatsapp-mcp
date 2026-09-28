/**
 * The gateway: one public MCP server fronting every WhatsApp account, plus a
 * QR pairing proxy. Every tool from src/mcp/tools/*.ts is reused unchanged
 * (via ProxyRegistrar) with a required `account` added; `list_accounts` is the
 * one gateway-native tool. Each account still runs as its own child process
 * (src/gateway/children.ts) — this file only wires the public surface.
 */

import { randomBytes } from "node:crypto";
import { FastMCP } from "fastmcp";
import type { Logger } from "pino";
import { z } from "zod";
import { createBearerAuthenticate } from "../mcp/bearer-auth.ts";
import {
  registerActionsTools,
  registerChatsTools,
  registerConnectionTools,
  registerContactsTools,
  registerGroupsTools,
  registerMediaTools,
  registerMessagesTools,
  registerMonitoringTools,
  registerSendingTools,
  registerWebhooksTools,
  type ToolDeps,
} from "../mcp/tools/index.ts";
import { type AccountConfig, defaultAccountsDir, loadAccounts } from "./accounts.ts";
import { type ChildHandle, spawnChildren } from "./children.ts";
import { AccountClient } from "./mcp-client.ts";
import { ProxyRegistrar } from "./proxy-registrar.ts";
import { createQrProxy } from "./qr-proxy.ts";

const SERVER_INSTRUCTIONS = `
WhatsApp as an MCP server: every tool takes a required "account" — call list_accounts
first to see what's configured. Read/search history, send messages & media, and react
to inbound messages, all scoped to one account per call.

REACTING TO INCOMING MESSAGES — pick by how long you must stay reactive:

| Lifetime | Situation | Tool |
|---|---|---|
| Seconds–minutes | "I just sent something, await the reply and have nothing else to do meanwhile" | wait_for_messages (bounded block) |
| Session-length | "Be PRESENT in this chat — monitor / watch / follow a group, act as the user's persona, chat with people over minutes-to-hours while doing other work" | follow_chat (returns a stream URL you attach to your harness's background monitor, e.g. Monitor({ws:{url}}); woken per message, never occupies a turn) |
| Deployment-length | A deployed, headless service that owns its own HTTPS endpoint (server, n8n, cloud function) | register_webhook |

Do NOT loop wait_for_messages to "stay present" — each empty return wastes a turn and
blocks all other work. For standing presence use follow_chat.
`.trim();

async function accountHealth(qrPort: number): Promise<string> {
  try {
    const res = await fetch(`http://127.0.0.1:${qrPort}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    const body = (await res.json()) as { status?: string };
    return body.status ?? "unreachable";
  } catch {
    return "unreachable";
  }
}

function registerListAccounts(server: FastMCP, accounts: AccountConfig[]): void {
  server.addTool({
    name: "list_accounts",
    description:
      "List configured WhatsApp accounts and their connection status. Call this first — every " +
      "other tool needs an `account` from here.",
    parameters: z.object({}),
    execute: async () => {
      const results = await Promise.all(
        accounts.map(async (a) => ({
          account: a.name,
          status: await accountHealth(a.qrPort),
        })),
      );
      return JSON.stringify(results, null, 2);
    },
  });
}

export interface GatewayOptions {
  appDir: string;
  dataRoot: string;
  accountsDir?: string;
  mcpLogger: Logger;
  waLogger: Logger;
}

export interface GatewayHandle {
  children: ChildHandle[];
  stop(): Promise<void>;
}

export async function startGateway(opts: GatewayOptions): Promise<GatewayHandle> {
  const accounts = loadAccounts(opts.accountsDir ?? defaultAccountsDir());
  if (accounts.length === 0) {
    opts.mcpLogger.warn("no accounts configured — nothing to serve. Run wa-account add first.");
  }

  // Gateway↔child traffic only — never the real WHATSAPP_MCP_AUTH_TOKEN, which
  // gates the gateway's own public endpoint below.
  const internalToken = randomBytes(32).toString("hex");

  const children = spawnChildren(accounts, {
    appDir: opts.appDir,
    dataRoot: opts.dataRoot,
    internalToken,
    logger: opts.waLogger,
  });

  const clients = new Map<string, AccountClient>();
  const accountNames = new Set(accounts.map((a) => a.name));
  function getClient(account: string): AccountClient {
    if (!accountNames.has(account)) {
      throw new Error(
        `unknown account "${account}" — configured accounts: ${[...accountNames].join(", ") || "(none)"}`,
      );
    }
    let client = clients.get(account);
    if (!client) {
      const config = accounts.find((a) => a.name === account);
      if (!config) throw new Error(`unknown account "${account}"`);
      client = new AccountClient({ mcpPort: config.mcpPort, internalToken });
      clients.set(account, client);
    }
    return client;
  }

  const server = new FastMCP({
    name: "whatsapp-gateway",
    version: "1.0.0",
    instructions: SERVER_INSTRUCTIONS,
    authenticate: createBearerAuthenticate(
      process.env.MCP_AUTH_TOKEN,
      opts.mcpLogger,
      "MCP_AUTH_TOKEN not set — the gateway's HTTP endpoint will accept unauthenticated requests.",
    ),
  });

  const deps: ToolDeps = { mcpLogger: opts.mcpLogger, waLogger: opts.waLogger };
  const registrar = new ProxyRegistrar(server, getClient);
  registerConnectionTools(registrar, deps);
  registerContactsTools(registrar, deps);
  registerMessagesTools(registrar, deps);
  registerMonitoringTools(registrar, deps);
  registerChatsTools(registrar, deps);
  registerGroupsTools(registrar, deps);
  registerSendingTools(registrar, deps);
  registerActionsTools(registrar, deps);
  registerMediaTools(registrar, deps);
  registerWebhooksTools(registrar, deps);
  registerListAccounts(server, accounts);

  const mcpPort = Number(process.env.MCP_PORT ?? 39090);
  const mcpHost = process.env.MCP_HOST ?? "127.0.0.1";
  await server.start({
    transportType: "httpStream",
    httpStream: { port: mcpPort, host: mcpHost, endpoint: "/mcp" },
  });
  opts.mcpLogger.info({ host: mcpHost, port: mcpPort }, "gateway MCP server listening");

  const qrPort = Number(process.env.QR_SERVER_PORT ?? 39091);
  const qrHost = process.env.QR_SERVER_HOST ?? "127.0.0.1";
  const accountPorts = new Map(accounts.map((a) => [a.name, a.qrPort]));
  const qrProxy = createQrProxy({ accountPorts, logger: opts.waLogger });
  qrProxy.listen(qrPort, qrHost, () => {
    opts.mcpLogger.info(
      { host: qrHost, port: qrPort },
      "gateway QR proxy listening (/qr/<account>)",
    );
  });

  return {
    children,
    async stop() {
      for (const child of children) child.stop();
      await new Promise<void>((resolve) => qrProxy.close(() => resolve()));
      await server.stop();
    },
  };
}
