import { executeDownloadMedia } from "../../actions.ts";
import { downloadMediaContract } from "./contracts.ts";
import type { ToolDeps, ToolRegistrar } from "./types.ts";

export function registerMediaTools(server: ToolRegistrar, deps: ToolDeps): void {
  const { waLogger } = deps;

  server.addTool({
    ...downloadMediaContract,
    execute: executeDownloadMedia.bind(null, waLogger),
  });
}
