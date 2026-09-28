import { getContacts, searchDbForContacts } from "../../database.ts";
import { listContactsContract, searchContactsContract } from "./contracts.ts";
import type { ToolDeps, ToolRegistrar } from "./types.ts";

export function registerContactsTools(server: ToolRegistrar, deps: ToolDeps): void {
  const { mcpLogger } = deps;

  server.addTool({
    ...searchContactsContract,
    execute: async ({ query }) => {
      mcpLogger.info(`[MCP Tool] Executing search_contacts with query: "${query}"`);
      const contacts = searchDbForContacts(query, 20);
      return JSON.stringify(
        contacts.map((c) => ({
          jid: c.jid,
          name: c.name ?? c.jid.split("@")[0],
        })),
        null,
        2,
      );
    },
  });

  server.addTool({
    ...listContactsContract,
    execute: async ({ query, limit }) => {
      mcpLogger.info(`[MCP Tool] Executing list_contacts, query="${query ?? ""}", limit=${limit}`);
      const contacts = getContacts(query ?? undefined, limit);
      if (!contacts.length) {
        return query ? `No contacts found matching "${query}".` : "No contacts found.";
      }
      return JSON.stringify(contacts, null, 2);
    },
  });
}
