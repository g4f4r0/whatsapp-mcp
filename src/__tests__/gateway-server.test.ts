import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type GatewayHandle, startGateway } from "../gateway/server.ts";

// No accounts configured — the important thing under test is the gateway's own
// wiring (server start/stop, list_accounts, ProxyRegistrar error paths, the QR
// proxy), not any real WhatsApp connection, so spawning zero children keeps
// this fast and deterministic.
describe("gateway/server (no accounts configured)", () => {
  let accountsDir: string;
  let handle: GatewayHandle;
  const mcpPort = 41000 + Math.floor(Math.random() * 900);
  const qrPort = mcpPort + 1;

  async function connectClient(): Promise<Client> {
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${mcpPort}/mcp`)),
    );
    return client;
  }

  beforeEach(async () => {
    accountsDir = await mkdtemp(path.join(tmpdir(), "wa-gateway-server-test-"));
    delete process.env.MCP_AUTH_TOKEN;
    process.env.MCP_PORT = String(mcpPort);
    process.env.QR_SERVER_PORT = String(qrPort);

    handle = await startGateway({
      appDir: accountsDir, // never used to spawn — there are no accounts
      dataRoot: accountsDir,
      accountsDir,
      mcpLogger: pino({ level: "silent" }),
      waLogger: pino({ level: "silent" }),
    });
  });

  afterEach(async () => {
    await handle.stop();
    delete process.env.MCP_PORT;
    delete process.env.QR_SERVER_PORT;
    await rm(accountsDir, { recursive: true, force: true });
  });

  it("starts with zero children when no accounts are configured", () => {
    expect(handle.children).toEqual([]);
  });

  it("list_accounts returns an empty list", async () => {
    const client = await connectClient();
    const result = await client.callTool({ name: "list_accounts", arguments: {} });
    expect(JSON.parse((result.content as [{ text: string }])[0].text)).toEqual([]);
  });

  it("a proxied tool call for an unknown account fails cleanly, without a real account", async () => {
    const client = await connectClient();
    const result = await client.callTool({
      name: "get_chat",
      arguments: { chat_jid: "x@g.us", account: "ghost" },
    });
    expect(result.isError).toBe(true);
  });

  it("the QR proxy 404s for /qr/<unknown account>", async () => {
    const res = await fetch(`http://127.0.0.1:${qrPort}/qr/ghost`);
    expect(res.status).toBe(404);
  });
});
