import { executeDeleteMessage, executeMarkChatRead, executeReactToMessage } from "../../actions.ts";
import {
  deleteMessageContract,
  markChatReadContract,
  reactToMessageContract,
} from "./contracts.ts";
import type { ToolDeps, ToolRegistrar } from "./types.ts";

export function registerActionsTools(server: ToolRegistrar, deps: ToolDeps): void {
  const { mcpLogger } = deps;

  server.addTool({
    ...reactToMessageContract,
    execute: async ({ chat_jid, message_id, emoji, from_me }) => {
      mcpLogger.info(
        `[MCP Tool] Executing react_to_message: ${emoji} on ${message_id} in ${chat_jid}`,
      );
      return executeReactToMessage({ chat_jid, message_id, emoji, from_me });
    },
  });

  server.addTool({
    ...deleteMessageContract,
    execute: async ({ chat_jid, message_id, from_me }) => {
      mcpLogger.info(`[MCP Tool] Executing delete_message: ${message_id} in ${chat_jid}`);
      return executeDeleteMessage({ chat_jid, message_id, from_me });
    },
  });

  server.addTool({
    ...markChatReadContract,
    execute: executeMarkChatRead.bind(null, mcpLogger),
  });
}
