import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CollectingRegistrar } from "../mcp/collecting-registrar.ts";
import { startLocalRpcServer } from "../mcp/local-rpc.ts";

describe("mcp/local-rpc", () => {
  let server: Server;
  let baseUrl: string;
  let registrar: CollectingRegistrar;

  beforeEach(async () => {
    registrar = new CollectingRegistrar();
    server = await startLocalRpcServer(registrar, pino({ level: "silent" }), {
      port: 0,
      host: "127.0.0.1",
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("wraps a plain string return value in a text content block", async () => {
    registrar.addTool({ name: "greet", parameters: z.object({}), execute: async () => "hello" });
    const res = await fetch(`${baseUrl}/tool/greet`, { method: "POST", body: "{}" });
    expect(await res.json()).toEqual({ content: [{ type: "text", text: "hello" }] });
  });

  it("passes a {content:[...]} return value through unchanged", async () => {
    registrar.addTool({
      name: "media",
      parameters: z.object({}),
      execute: async () => ({ content: [{ type: "image", data: "abc", mimeType: "image/png" }] }),
    });
    const res = await fetch(`${baseUrl}/tool/media`, { method: "POST", body: "{}" });
    expect(await res.json()).toEqual({
      content: [{ type: "image", data: "abc", mimeType: "image/png" }],
    });
  });

  it("passes the parsed JSON body as args to execute", async () => {
    registrar.addTool({
      name: "echo",
      parameters: z.object({ text: z.string() }),
      execute: async (args) => `got: ${(args as { text: string }).text}`,
    });
    const res = await fetch(`${baseUrl}/tool/echo`, {
      method: "POST",
      body: JSON.stringify({ text: "hi" }),
    });
    expect(await res.json()).toEqual({ content: [{ type: "text", text: "got: hi" }] });
  });

  it("allows unauthenticated calls when no authToken is configured", async () => {
    registrar.addTool({ name: "open", parameters: z.object({}), execute: async () => "ok" });
    const res = await fetch(`${baseUrl}/tool/open`, { method: "POST", body: "{}" });
    expect(res.status).toBe(200);
  });

  it("404s GET requests — only POST /tool/<name> is served", async () => {
    registrar.addTool({ name: "open", parameters: z.object({}), execute: async () => "ok" });
    const res = await fetch(`${baseUrl}/tool/open`);
    expect(res.status).toBe(404);
  });

  it("disables request/header timeouts, since wait_for_messages can block for minutes", () => {
    expect(server.requestTimeout).toBe(0);
    expect(server.headersTimeout).toBe(0);
  });
});
