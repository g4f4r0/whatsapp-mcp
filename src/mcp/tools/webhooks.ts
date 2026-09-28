import {
  executeDeregisterWebhook,
  executeListWebhooks,
  executeRegisterWebhook,
} from "../../webhooks/actions.ts";
import {
  deregisterWebhookContract,
  listWebhooksContract,
  registerWebhookContract,
} from "./contracts.ts";
import type { ToolDeps, ToolRegistrar } from "./types.ts";

export function registerWebhooksTools(server: ToolRegistrar, deps: ToolDeps): void {
  const { mcpLogger } = deps;

  server.addTool({
    ...registerWebhookContract,
    execute: async ({
      target_url,
      allowed_jids,
      secret,
      auth_mode,
      transcribe,
      include_from_me,
      label,
    }) => {
      // Redact any user:pass@ embedded in the URL before logging.
      const safeUrl = target_url.replace(/\/\/[^/@]*@/, "//[redacted]@");
      mcpLogger.info(
        `[MCP Tool] Executing register_webhook for ${safeUrl} (${allowed_jids.length} jid(s), include_from_me=${include_from_me})`,
      );
      const result = executeRegisterWebhook({
        target_url,
        allowed_jids,
        secret,
        auth_mode,
        transcribe,
        include_from_me,
        label,
      });
      return JSON.stringify(result, null, 2);
    },
  });

  server.addTool({
    ...deregisterWebhookContract,
    execute: async ({ id }) => {
      mcpLogger.info(`[MCP Tool] Executing deregister_webhook for ${id}`);
      return JSON.stringify(executeDeregisterWebhook(id), null, 2);
    },
  });

  server.addTool({
    ...listWebhooksContract,
    execute: async () => {
      mcpLogger.info("[MCP Tool] Executing list_webhooks");
      return JSON.stringify(executeListWebhooks(), null, 2);
    },
  });
}
