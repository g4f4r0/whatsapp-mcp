import { getChat, getChats } from "../../database.ts";
import { formatDbChatForJson } from "../../formatters.ts";
import { getChatContract, listChatsContract } from "./contracts.ts";
import type { ToolDeps, ToolRegistrar } from "./types.ts";

export function registerChatsTools(server: ToolRegistrar, deps: ToolDeps): void {
  const { mcpLogger } = deps;

  server.addTool({
    ...listChatsContract,
    execute: async ({ limit, page, sort_by, query, include_last_message }) => {
      mcpLogger.info(
        `[MCP Tool] Executing list_chats: limit=${limit}, page=${page}, sort=${sort_by}, query=${query}`,
      );
      const chats = getChats(limit, page, sort_by, query ?? null, include_last_message);
      if (!chats.length) {
        const matching = query ? ` matching "${query}"` : "";
        return page === 0
          ? `No chats found${matching}.`
          : `No more chats found on page ${page}${matching}.`;
      }
      return JSON.stringify(chats.map(formatDbChatForJson), null, 2);
    },
  });

  server.addTool({
    ...getChatContract,
    execute: async ({ chat_jid, include_last_message }) => {
      mcpLogger.info(`[MCP Tool] Executing get_chat for ${chat_jid}`);
      const chat = getChat(chat_jid, include_last_message);
      if (!chat) {
        throw new Error(`Chat with JID ${chat_jid} not found.`);
      }
      return JSON.stringify(formatDbChatForJson(chat), null, 2);
    },
  });
}
