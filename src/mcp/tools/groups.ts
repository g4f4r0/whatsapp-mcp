import { executeGetGroupInfo } from "../../actions.ts";
import { getGroupInfoContract } from "./contracts.ts";
import type { ToolDeps, ToolRegistrar } from "./types.ts";

export function registerGroupsTools(server: ToolRegistrar, deps: ToolDeps): void {
  const { mcpLogger } = deps;

  server.addTool({
    ...getGroupInfoContract,
    execute: async ({ group_jid }) => {
      mcpLogger.info(`[MCP Tool] Executing get_group_info for ${group_jid}`);
      return executeGetGroupInfo({ group_jid });
    },
  });
}
