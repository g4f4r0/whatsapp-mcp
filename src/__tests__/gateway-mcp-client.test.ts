import type { Server } from "node:http";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AccountClient } from "../gateway/mcp-client.ts";
import { CollectingRegistrar } from "../mcp/collecting-registrar.ts";
import { startLocalRpcServer } from "../mcp/local-rpc.ts";

describe("gateway/AccountClient", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    const registrar = new CollectingRegistrar();
    registrar.addTool({
      name: "echo",
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }) => `echo: ${text}`,
    });
    registrar.addTool({
      name: "boom",
      parameters: z.object({}),
      execute: async () => {
        throw new Error("refused: cold contact");
      },
    });

    port = 30000 + Math.floor(Math.random() * 9000);
    server = await startLocalRpcServer(registrar, pino({ level: "silent" }), {
      port,
      host: "127.0.0.1",
      authToken: "internal-secret",
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("calls a tool on the child and returns its content", async () => {
    const client = new AccountClient({ mcpPort: port, internalToken: "internal-secret" });
    const result = await client.callTool("echo", { text: "hi" });
    expect(result.isError).toBeFalsy();
    expect(result.content).toEqual([{ type: "text", text: "echo: hi" }]);
  });

  it("surfaces a thrown tool error as an isError result", async () => {
    const client = new AccountClient({ mcpPort: port, internalToken: "internal-secret" });
    const result = await client.callTool("boom", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text", text: "refused: cold contact" });
  });

  it("rejects with the wrong internal token", async () => {
    const client = new AccountClient({ mcpPort: port, internalToken: "wrong-token" });
    const result = await client.callTool("echo", { text: "hi" });
    expect(result.isError).toBe(true);
  });

  it("404s an unknown tool as an isError result", async () => {
    const client = new AccountClient({ mcpPort: port, internalToken: "internal-secret" });
    const result = await client.callTool("nosuchtool", {});
    expect(result.isError).toBe(true);
  });
});
