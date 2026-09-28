/**
 * Barrel for the per-domain tool registries — both mcp.ts (single account) and
 * gateway/server.ts (multi-account, via ProxyRegistrar) register the same 21
 * tools and previously each hand-copied this same list of imports.
 */

export { registerActionsTools } from "./actions.ts";
export { registerChatsTools } from "./chats.ts";
export { registerConnectionTools } from "./connection.ts";
export { registerContactsTools } from "./contacts.ts";
export { registerGroupsTools } from "./groups.ts";
export { registerMediaTools } from "./media.ts";
export { registerMessagesTools } from "./messages.ts";
export { registerMonitoringTools } from "./monitoring.ts";
export { registerSendingTools } from "./sending.ts";
export type { ToolDeps } from "./types.ts";
export { registerWebhooksTools } from "./webhooks.ts";
