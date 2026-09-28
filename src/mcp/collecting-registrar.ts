/**
 * A `ToolRegistrar` that just stores what it's given — no FastMCP instance.
 * Used by the "local-rpc" transport (mcp/local-rpc.ts): a gateway-spawned
 * child never speaks real MCP protocol to anything (only the gateway ever
 * calls it, over its own lightweight internal wire format), so there's no
 * reason to load and instantiate a full FastMCP server just to hold the
 * same register*Tools calls mcp.ts already makes.
 */

import type { FastMCP, FastMCPSessionAuth, Tool, ToolParameters } from "fastmcp";
import type { ToolRegistrar } from "./tools/types.ts";

export type CollectedTool = Tool<FastMCPSessionAuth, ToolParameters>;

export class CollectingRegistrar implements ToolRegistrar {
  readonly tools = new Map<string, CollectedTool>();

  addTool: FastMCP["addTool"] = (def) => {
    this.tools.set(def.name, def as CollectedTool);
  };
}
