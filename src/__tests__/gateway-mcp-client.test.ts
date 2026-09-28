import { FastMCP } from "fastmcp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AccountClient } from "../gateway/mcp-client.ts";

describe("gateway/AccountClient", () => {
  let server: FastMCP;
  let port: number;

  beforeEach(async () => {
    server = new FastMCP({
      name: "fake-child",
      version: "1.0.0",
      authenticate: async (request) => {
        if (!request) return {};
        const header = request.headers.authorization;
        const raw = Array.isArray(header) ? header[0] : header;
        if (raw !== "Bearer internal-secret") {
          throw new Response(null, { status: 401 });
        }
        return {};
      },
    });
    server.addTool({
      name: "echo",
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => `echo: ${text}`,
    });
    server.addTool({
      name: "boom",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("refused: cold contact");
      },
    });

    port = 30000 + Math.floor(Math.random() * 9000);
    await server.start({
      transportType: "httpStream",
      httpStream: { port, host: "127.0.0.1", endpoint: "/mcp" },
    });
  });

  afterEach(async () => {
    await server.stop();
  });

  it("calls a tool on the child and returns its content", async () => {
    const client = new AccountClient({ mcpPort: port, internalToken: "internal-secret" });
    const result = await client.callTool("echo", { text: "hi" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: "echo: hi" }]);
  });

  it("reuses the connection across calls", async () => {
    const client = new AccountClient({ mcpPort: port, internalToken: "internal-secret" });
    await client.callTool("echo", { text: "one" });
    const second = await client.callTool("echo", { text: "two" });
    expect(second.content).toEqual([{ type: "text", text: "echo: two" }]);
  });

  it("surfaces a thrown tool error as an isError result", async () => {
    const client = new AccountClient({ mcpPort: port, internalToken: "internal-secret" });
    const result = await client.callTool("boom", {});
    expect(result.isError).toBe(true);
  });

  it("rejects with the wrong internal token", async () => {
    const client = new AccountClient({ mcpPort: port, internalToken: "wrong-token" });
    await expect(client.callTool("echo", { text: "hi" })).rejects.toBeTruthy();
  });
});
