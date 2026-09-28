import { getMessagesAround, getMessagesWithDateFilter, searchMessages } from "../../database.ts";
import { formatDbMessageForJson } from "../../formatters.ts";
import {
  getMessageContextContract,
  getMessagesTodayContract,
  listMessagesContract,
  searchMessagesContract,
} from "./contracts.ts";
import type { ToolDeps, ToolRegistrar } from "./types.ts";

export function registerMessagesTools(server: ToolRegistrar, deps: ToolDeps): void {
  const { mcpLogger } = deps;

  server.addTool({
    ...listMessagesContract,
    execute: async ({ chat_jid, limit, page, from_date, to_date }) => {
      mcpLogger.info(
        `[MCP Tool] Executing list_messages for chat ${chat_jid}, limit=${limit}, page=${page}, from=${from_date}, to=${to_date}`,
      );

      const messages = getMessagesWithDateFilter(chat_jid, from_date, to_date, limit, page);

      if (!messages.length) {
        return page === 0
          ? `No messages found for chat ${chat_jid}.`
          : `No more messages found on page ${page} for chat ${chat_jid}.`;
      }
      return JSON.stringify(messages.map(formatDbMessageForJson), null, 2);
    },
  });

  server.addTool({
    ...getMessagesTodayContract,
    execute: async ({ chat_jid, limit }) => {
      mcpLogger.info(`[MCP Tool] Executing get_messages_today, chat=${chat_jid}`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const fromDate = today.toISOString();

      const messages = getMessagesWithDateFilter(chat_jid, fromDate, null, limit, 0);

      if (!messages.length) {
        const scope = chat_jid ? ` in chat ${chat_jid}` : "";
        return `No messages found for today${scope}.`;
      }
      return JSON.stringify(messages.map(formatDbMessageForJson), null, 2);
    },
  });

  server.addTool({
    ...searchMessagesContract,
    execute: async ({ chat_jid, query, from_date, to_date, limit, page }) => {
      mcpLogger.info(
        `[MCP Tool] Executing search_messages, query="${query}", from=${from_date}, to=${to_date}`,
      );
      const messages = searchMessages(query, chat_jid, from_date, to_date, limit, page);

      if (!messages.length) {
        const scope = chat_jid ? `in chat ${chat_jid}` : "across all chats";
        return page === 0
          ? `No messages found containing "${query}" ${scope}.`
          : `No more messages found on page ${page}.`;
      }

      return JSON.stringify(messages.map(formatDbMessageForJson), null, 2);
    },
  });

  server.addTool({
    ...getMessageContextContract,
    execute: async ({ chat_jid, message_id, before, after }) => {
      mcpLogger.info(
        `[MCP Tool] Executing get_message_context for msg ${message_id} in ${chat_jid}`,
      );
      const context = getMessagesAround(message_id, chat_jid, before, after);
      if (!context.target) {
        throw new Error(`Message with ID ${message_id} not found in chat ${chat_jid}.`);
      }
      return JSON.stringify(
        {
          target: formatDbMessageForJson(context.target),
          before: context.before.map(formatDbMessageForJson),
          after: context.after.map(formatDbMessageForJson),
        },
        null,
        2,
      );
    },
  });
}
