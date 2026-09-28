import type { FastMCP } from "fastmcp";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AccountClient } from "../gateway/mcp-client.ts";
import { ProxyRegistrar } from "../gateway/proxy-registrar.ts";

interface RegisteredTool {
  name: string;
  parameters: z.ZodTypeAny;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

function makeFakeServer() {
  const tools = new Map<string, RegisteredTool>();
  const server = { addTool: vi.fn((def: RegisteredTool) => tools.set(def.name, def)) };
  return { tools, server: server as unknown as FastMCP };
}

function fakeClient(callTool: AccountClient["callTool"]): () => AccountClient {
  return () => ({ callTool }) as unknown as AccountClient;
}

describe("gateway/ProxyRegistrar", () => {
  it("extends the tool's own parameters with a required account field", () => {
    const { server, tools } = makeFakeServer();
    const registrar = new ProxyRegistrar(server, fakeClient(vi.fn()));

    registrar.addTool({
      name: "get_chat",
      parameters: z.object({ chat_jid: z.string() }),
      execute: async () => "unused",
    });

    const registered = tools.get("get_chat")!;
    const parsed = registered.parameters.parse({ chat_jid: "x@g.us", account: "business" });
    expect(parsed).toEqual({ chat_jid: "x@g.us", account: "business" });
    expect(() => registered.parameters.parse({ chat_jid: "x@g.us" })).toThrow();
  });

  it("forwards the call to the resolved account's client, stripping account from the args", async () => {
    const { server, tools } = makeFakeServer();
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const getClient = vi.fn(fakeClient(callTool));
    const registrar = new ProxyRegistrar(server, getClient);

    registrar.addTool({
      name: "get_chat",
      parameters: z.object({ chat_jid: z.string() }),
      execute: async () => "unused",
    });

    const result = await tools
      .get("get_chat")!
      .execute({ chat_jid: "x@g.us", account: "business" });

    expect(getClient).toHaveBeenCalledWith("business");
    expect(callTool).toHaveBeenCalledWith("get_chat", { chat_jid: "x@g.us" });
    expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
  });

  it("throws with the child's error text when the child reports isError", async () => {
    const { server, tools } = makeFakeServer();
    const callTool = vi.fn().mockResolvedValue({
      isError: true,
      content: [{ type: "text", text: "Chat with JID x@g.us not found." }],
    });
    const registrar = new ProxyRegistrar(server, fakeClient(callTool));

    registrar.addTool({
      name: "get_chat",
      parameters: z.object({ chat_jid: z.string() }),
      execute: async () => "unused",
    });

    await expect(
      tools.get("get_chat")!.execute({ chat_jid: "x@g.us", account: "business" }),
    ).rejects.toThrow("Chat with JID x@g.us not found.");
  });

  it("rejects a tool whose parameters aren't a z.object()", () => {
    const { server } = makeFakeServer();
    const registrar = new ProxyRegistrar(server, fakeClient(vi.fn()));

    expect(() =>
      registrar.addTool({
        name: "weird",
        parameters: z.string(),
        execute: async () => "unused",
      }),
    ).toThrow(/must be a z.object/);
  });
});
