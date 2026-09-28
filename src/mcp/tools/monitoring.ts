import { formatDbMessageForJson } from "../../formatters.ts";
import { getNewMessagesCore, waitForMessagesCore } from "../../monitoring.ts";
import { executeFollowChat, resolveStreamBaseUrl } from "../../stream/follow.ts";
import { streamTokens } from "../../stream/token.ts";
import {
  followChatContract,
  getNewMessagesContract,
  waitForMessagesContract,
} from "./contracts.ts";
import type { ToolDeps, ToolRegistrar } from "./types.ts";

const HEARTBEAT_MS = 20_000;

export function registerMonitoringTools(server: ToolRegistrar, deps: ToolDeps): void {
  const { mcpLogger } = deps;

  server.addTool({
    ...getNewMessagesContract,
    execute: async ({ chat_jids, since, limit, include_from_me }) => {
      mcpLogger.info(
        `[MCP Tool] get_new_messages since=${since ?? "(now)"} chats=${chat_jids?.length ?? "all"}`,
      );
      const result = getNewMessagesCore({
        chatJids: chat_jids,
        since,
        limit,
        includeFromMe: include_from_me,
      });
      return JSON.stringify(
        { messages: result.messages.map(formatDbMessageForJson), next_since: result.next_since },
        null,
        2,
      );
    },
  });

  server.addTool({
    ...waitForMessagesContract,
    execute: async ({ chat_jids, since, timeout_seconds, include_from_me }, { reportProgress }) => {
      mcpLogger.info(
        `[MCP Tool] wait_for_messages timeout=${timeout_seconds}s chats=${chat_jids?.length ?? "all"}`,
      );
      let beats = 0;
      const result = await waitForMessagesCore({
        chatJids: chat_jids,
        since,
        includeFromMe: include_from_me,
        timeoutMs: timeout_seconds * 1000,
        heartbeatMs: HEARTBEAT_MS,
        // Keep the proxied HTTP connection warm during a long block.
        onHeartbeat: () => {
          void reportProgress?.({
            progress: ++beats,
            total: Math.ceil((timeout_seconds * 1000) / HEARTBEAT_MS),
          });
        },
      });
      return JSON.stringify(
        { messages: result.messages.map(formatDbMessageForJson), next_since: result.next_since },
        null,
        2,
      );
    },
  });

  server.addTool({
    ...followChatContract,
    execute: async ({ chat_jids, include_from_me, transcribe }) => {
      mcpLogger.info(
        `[MCP Tool] follow_chat chats=${chat_jids?.length ?? "all"} include_from_me=${include_from_me}`,
      );
      const result = executeFollowChat(
        { chatJids: chat_jids, includeFromMe: include_from_me, transcribe },
        { tokens: streamTokens, baseUrl: resolveStreamBaseUrl() },
      );
      return JSON.stringify(result, null, 2);
    },
  });
}
