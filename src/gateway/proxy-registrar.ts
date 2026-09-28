/**
 * A `ToolRegistrar` that turns every one of the 21 existing tool definitions
 * (src/mcp/tools/*.ts, unchanged) into an account-routed proxy: same name, same
 * description, same parameters plus a required `account`, but `execute` forwards
 * the call to that account's child over its own loopback MCP endpoint instead of
 * running the tool's logic in this process. Reusing the real registration
 * functions means the gateway never hand-copies a tool's schema.
 */

import type { FastMCP, FastMCPSessionAuth, Tool, ToolParameters } from "fastmcp";
import { z } from "zod";
import type { ToolRegistrar } from "../mcp/tools/types.ts";
import type { AccountClient } from "./mcp-client.ts";

export class ProxyRegistrar implements ToolRegistrar {
  private readonly server: FastMCP;
  private readonly getClient: (account: string) => AccountClient;

  // Not parameter-property shorthand: unsupported under Node's
  // --experimental-strip-types — see src/__tests__/strip-types.contract.test.ts.
  constructor(server: FastMCP, getClient: (account: string) => AccountClient) {
    this.server = server;
    this.getClient = getClient;
  }

  addTool<Params extends ToolParameters>(def: Tool<FastMCPSessionAuth, Params>): void {
    const baseParameters = def.parameters;
    if (!(baseParameters instanceof z.ZodObject)) {
      throw new Error(`ProxyRegistrar: tool "${def.name}" parameters must be a z.object()`);
    }
    const parameters = baseParameters.extend({
      account: z
        .string()
        .describe("Which WhatsApp account to use — see list_accounts for the available names."),
    });
    const name = def.name;
    const getClient = this.getClient;

    this.server.addTool({
      ...def,
      parameters,
      execute: async (args) => {
        const { account, ...rest } = args as Record<string, unknown> & { account: string };
        const client = getClient(account);
        const result = await client.callTool(name, rest);
        if (result.isError) {
          const text =
            result.content
              ?.map((c) => ("text" in c ? c.text : ""))
              .filter(Boolean)
              .join("\n") || `${name} failed on account "${account}".`;
          throw new Error(text);
        }
        return { content: result.content };
      },
    });
  }
}
