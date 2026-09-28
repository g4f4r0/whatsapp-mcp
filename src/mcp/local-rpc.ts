/**
 * Lightweight internal-only tool transport for gateway-spawned children.
 * Not real MCP protocol — just `POST /tool/<name>` with a JSON body of args,
 * `Authorization: Bearer <token>`, and a JSON `{content, isError?}` response
 * mirroring the shape a real MCP `tools/call` result would have (so
 * gateway/proxy-registrar.ts's handling doesn't need to know which
 * transport it's talking to). Only ever called by the gateway
 * (gateway/mcp-client.ts) over loopback — never exposed, never speaks to an
 * external MCP client — so it doesn't need FastMCP's request validation,
 * SSE, session negotiation, or any of what a real spec-compliant server
 * provides. That's the whole point: it's what makes a gateway-spawned child
 * dramatically lighter than running a second full MCP server.
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Logger } from "pino";
import type { CollectedTool, CollectingRegistrar } from "./collecting-registrar.ts";

type ContentBlock = Record<string, unknown>;

/** Same normalization FastMCP applies to a tool's return value. */
function normalizeResult(result: unknown): ContentBlock[] {
  if (typeof result === "string") return [{ type: "text", text: result }];
  if (result && typeof result === "object" && "content" in result) {
    return (result as { content: ContentBlock[] }).content;
  }
  return [{ type: "text", text: String(result) }];
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

async function handleToolCall(
  tool: CollectedTool,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const rawBody = await readBody(req);
  const args = rawBody ? JSON.parse(rawBody) : {};
  // Args already passed the gateway's own (contract + account) zod validation
  // before this call was forwarded — no need to parse them a second time.
  const noopContext = { reportProgress: async () => {}, log: {} } as unknown as Parameters<
    CollectedTool["execute"]
  >[1];
  const result = await tool.execute(args, noopContext);
  sendJson(res, 200, { content: normalizeResult(result) });
}

export interface LocalRpcOptions {
  port: number;
  host: string;
  authToken?: string;
}

export function startLocalRpcServer(
  registrar: CollectingRegistrar,
  logger: Logger,
  opts: LocalRpcOptions,
): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        if (opts.authToken) {
          const raw = req.headers.authorization;
          if (raw !== `Bearer ${opts.authToken}`) {
            sendJson(res, 401, {
              isError: true,
              content: [{ type: "text", text: "unauthorized" }],
            });
            return;
          }
        }

        const path = (req.url ?? "").split("?")[0];
        const match = req.method === "POST" && /^\/tool\/([^/]+)$/.exec(path);
        if (!match) {
          sendJson(res, 404, { isError: true, content: [{ type: "text", text: "not found" }] });
          return;
        }

        const name = decodeURIComponent(match[1]);
        const tool = registrar.tools.get(name);
        if (!tool) {
          sendJson(res, 404, {
            isError: true,
            content: [{ type: "text", text: `unknown tool "${name}"` }],
          });
          return;
        }

        await handleToolCall(tool, req, res);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn({ err }, "local-rpc tool call failed");
        sendJson(res, 200, { isError: true, content: [{ type: "text", text: message }] });
      }
    })();
  });

  // wait_for_messages can hold a call open for minutes — never time out the
  // connection out from under it. Loopback-only, no reverse proxy in between.
  server.requestTimeout = 0;
  server.headersTimeout = 0;

  return new Promise((resolve) => {
    server.listen(opts.port, opts.host, () => {
      logger.info({ host: opts.host, port: opts.port }, "local-rpc tool server listening");
      resolve(server);
    });
  });
}
