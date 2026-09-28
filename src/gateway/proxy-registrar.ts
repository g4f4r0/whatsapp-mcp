/**
 * Builds the gateway's account-routed tool set straight from the tool
 * contracts (src/mcp/tools/contracts.ts — zod only, no other imports):
 * same name, description and parameters plus a required `account`, but
 * `execute` forwards the call to that account's child over its own loopback
 * MCP endpoint instead of running the tool's logic in this process.
 *
 * Deliberately does NOT import src/mcp/tools/index.ts (the real
 * register*Tools functions) — those statically import actions.ts,
 * database.ts, whatsapp.ts, storage.ts and friends, pulling the entire
 * single-account stack (baileys-client, drizzle, minio) into the gateway
 * process for logic it never runs. See contracts.ts's own docblock.
 */

import type { ContentResult, FastMCP } from "fastmcp";
import { z } from "zod";
import { TOOL_CONTRACTS } from "../mcp/tools/contracts.ts";
import type { AccountClient } from "./mcp-client.ts";

export function registerProxiedTools(
  server: FastMCP,
  getClient: (account: string) => AccountClient,
): void {
  for (const contract of TOOL_CONTRACTS) {
    const parameters = contract.parameters.extend({
      account: z
        .string()
        .describe("Which WhatsApp account to use — see list_accounts for the available names."),
    });

    server.addTool({
      ...contract,
      parameters,
      execute: async (args) => {
        const { account, ...rest } = args as Record<string, unknown> & { account: string };
        const client = getClient(account);
        const result = await client.callTool(contract.name, rest);
        if (result.isError) {
          const text =
            result.content
              ?.map((c) => ("text" in c ? c.text : ""))
              .filter(Boolean)
              .join("\n") || `${contract.name} failed on account "${account}".`;
          throw new Error(text);
        }
        // The child already shaped these blocks correctly (text/image/audio/
        // resource_link) — TS just can't see that through the wire's JSON type.
        return { content: result.content } as ContentResult;
      },
    });
  }
}
