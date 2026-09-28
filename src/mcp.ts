import { FastMCP } from "fastmcp";
import type { Logger } from "pino";

import { createBearerAuthenticate } from "./mcp/bearer-auth.ts";
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
} from "./mcp/tools/index.ts";

/**
 * Server-level routing hint surfaced to clients under "MCP Server Instructions".
 * Prime real estate every agent reads before choosing a tool — the three-lifetime
 * table steers "monitor / watch / follow / act as me" to the right reactive tool
 * instead of the blocking long-poll. See docs/agent-presence-stream-recipe.md.
 */
const SERVER_INSTRUCTIONS = `
WhatsApp as an MCP server: read/search history, send messages & media, and react to
inbound messages.

REACTING TO INCOMING MESSAGES — pick by how long you must stay reactive:

| Lifetime | Situation | Tool |
|---|---|---|
| Seconds–minutes | "I just sent something, await the reply and have nothing else to do meanwhile" | wait_for_messages (bounded block) |
| Session-length | "Be PRESENT in this chat — monitor / watch / follow a group, act as the user's persona, chat with people over minutes-to-hours while doing other work" | follow_chat (returns a stream URL you attach to your harness's background monitor, e.g. Monitor({ws:{url}}); woken per message, never occupies a turn) |
| Deployment-length | A deployed, headless service that owns its own HTTPS endpoint (server, n8n, cloud function) | register_webhook |

Do NOT loop wait_for_messages to "stay present" — each empty return wastes a turn and
blocks all other work. For standing presence use follow_chat.
`.trim();

export async function startMcpServer(mcpLogger: Logger, waLogger: Logger): Promise<void> {
  mcpLogger.info("Initializing FastMCP server...");

  const server = new FastMCP({
    name: "whatsapp-baileys-ts",
    version: "0.3.0",
    instructions: SERVER_INSTRUCTIONS,
    authenticate: createBearerAuthenticate(
      process.env.MCP_AUTH_TOKEN,
      mcpLogger,
      "MCP_AUTH_TOKEN not set — HTTP MCP endpoint will accept unauthenticated requests. OK for stdio/local, DO NOT run like this in production.",
    ),
  });

  const deps: ToolDeps = { mcpLogger, waLogger };

  // Per-domain tool registries. Each registry owns the tools listed in its
  // CLAUDE.md section: name, schema, execute body — nothing more.
  registerConnectionTools(server, deps);
  registerContactsTools(server, deps);
  registerMessagesTools(server, deps);
  registerMonitoringTools(server, deps);
  registerChatsTools(server, deps);
  registerGroupsTools(server, deps);
  registerSendingTools(server, deps);
  registerActionsTools(server, deps);
  registerMediaTools(server, deps);
  registerWebhooksTools(server, deps);

  // ── Resource ──────────────────────────────────────────────────────

  server.addResource({
    uri: "schema://whatsapp/main",
    name: "Database Schema",
    description: "The SQLite schema for WhatsApp data",
    async load() {
      return {
        text: `
TABLE chats (jid TEXT PK, name TEXT, last_message_time TEXT)
TABLE messages (
  id TEXT, chat_jid TEXT, sender TEXT, content TEXT, timestamp TEXT, is_from_me INTEGER,
  media_type TEXT, mimetype TEXT, media_key TEXT, direct_path TEXT, media_url TEXT,
  file_length INTEGER, file_sha256 TEXT, file_enc_sha256 TEXT, media_object_key TEXT,
  PK(id, chat_jid), FK(chat_jid) REFERENCES chats(jid) ON DELETE CASCADE
)
TABLE contacts (jid TEXT PK, name TEXT, notify TEXT, phone_number TEXT)
TABLE webhook_subscriptions (
  id TEXT PK, tenant_id TEXT, target_url TEXT, secret TEXT, auth_mode TEXT,
  allowed_jids TEXT, transcribe INTEGER, include_from_me INTEGER, label TEXT, active INTEGER,
  created_at TEXT, updated_at TEXT
)
        `.trim(),
      };
    },
  });

  const transport = (process.env.MCP_TRANSPORT ?? "stdio").toLowerCase();
  if (transport === "stdio") {
    mcpLogger.info("FastMCP server configured. Starting (stdio)...");
    await server.start();
    return;
  }
  if (transport === "httpstream" || transport === "http" || transport === "sse") {
    const port = Number(process.env.MCP_PORT ?? 3001);
    const host = process.env.MCP_HOST ?? "127.0.0.1";
    const endpoint = (process.env.MCP_ENDPOINT ?? "/mcp") as `/${string}`;
    mcpLogger.info({ port, host, endpoint }, "FastMCP server configured. Starting (httpStream)...");
    await server.start({
      transportType: "httpStream",
      httpStream: { port, host, endpoint },
    });
    return;
  }
  throw new Error(`Invalid MCP_TRANSPORT: "${transport}". Expected "stdio" or "httpStream".`);
}
