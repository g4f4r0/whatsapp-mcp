import type { FastMCP } from "fastmcp";
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import type { AccountClient } from "../gateway/mcp-client.ts";
import { registerProxiedTools } from "../gateway/proxy-registrar.ts";
import { TOOL_CONTRACTS } from "../mcp/tools/contracts.ts";

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

describe("gateway/registerProxiedTools", () => {
  it("registers every tool contract", () => {
    const { server, tools } = makeFakeServer();
    registerProxiedTools(server, fakeClient(vi.fn()));

    expect(tools.size).toBe(TOOL_CONTRACTS.length);
    for (const contract of TOOL_CONTRACTS) {
      expect(tools.has(contract.name)).toBe(true);
    }
  });

  it("extends the tool's own parameters with a required account field", () => {
    const { server, tools } = makeFakeServer();
    registerProxiedTools(server, fakeClient(vi.fn()));

    const registered = tools.get("get_chat")!;
    const parsed = registered.parameters.parse({ chat_jid: "x@g.us", account: "business" });
    expect(parsed).toEqual({ chat_jid: "x@g.us", account: "business", include_last_message: true });
    expect(() => registered.parameters.parse({ chat_jid: "x@g.us" })).toThrow();
  });

  it("forwards the call to the resolved account's client, stripping account from the args", async () => {
    const { server, tools } = makeFakeServer();
    const callTool = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    const getClient = vi.fn(fakeClient(callTool));
    registerProxiedTools(server, getClient);

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
    registerProxiedTools(server, fakeClient(callTool));

    await expect(
      tools.get("get_chat")!.execute({ chat_jid: "x@g.us", account: "business" }),
    ).rejects.toThrow("Chat with JID x@g.us not found.");
  });

  it("carries over tool-specific options like wait_for_messages' timeoutMs", () => {
    const { server, tools } = makeFakeServer();
    registerProxiedTools(server, fakeClient(vi.fn()));

    expect((tools.get("wait_for_messages") as unknown as { timeoutMs: number }).timeoutMs).toBe(
      TOOL_CONTRACTS.find((c) => c.name === "wait_for_messages")!.timeoutMs,
    );
  });
});
