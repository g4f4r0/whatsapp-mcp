/**
 * Tool contracts: name, description, parameters (and timeoutMs where set) for
 * every tool — zod only, no other imports. Deliberately separate from the
 * register*Tools functions in this directory, which bind these contracts to
 * real implementations (actions.ts, database.ts, whatsapp.ts, ...).
 *
 * The gateway needs the contracts (to build its own proxied tool list) but
 * never the implementations — every tool call is forwarded to an account's
 * child instead of run here. Importing register*Tools directly would pull in
 * the whole single-account stack (baileys-client, drizzle, minio, ffmpeg
 * paths) into the gateway process for nothing: none of it is ever used
 * there. Keeping contracts import-clean is what makes the gateway light.
 */

import { z } from "zod";

const ALLOW_COLD_DESCRIPTION =
  "Send even though this contact has never messaged this account (a cold first contact). " +
  "Cold reach-outs are what get a WhatsApp account restricted, so use this ONLY when the " +
  "person explicitly asked to be contacted — never to work around the refusal in bulk. " +
  "On an instance configured with SEND_COLD_OVERRIDE=deny this parameter is IGNORED and " +
  "the send is still refused; the refusal says so. Default false.";

const chatJidsParam = z
  .array(z.string())
  .optional()
  .describe('Chats to watch (person/group JIDs). Omit or use ["*"] for all chats.');

const sinceParam = z
  .string()
  .optional()
  .describe(
    "Opaque cursor: pass the previous call's `next_since` verbatim to get only messages after it (exclusive, monotonic — never re-delivers the last one). Omit on the first call to start from now. An ISO-8601 timestamp is also accepted to backfill recent history (inclusive from that time).",
  );

const includeFromMeParam = z
  .boolean()
  .optional()
  .default(false)
  .describe(
    "Include YOUR OWN (is_from_me) messages. Default false — the agent's own replies are always excluded regardless.",
  );

// Long-poll caps for wait_for_messages — see monitoring.ts's register function.
const DEFAULT_TIMEOUT_S = 60;
const MAX_TIMEOUT_S = 240;

// ── actions.ts ──────────────────────────────────────────────────────

export const reactToMessageContract = {
  name: "react_to_message",
  description: "React to a message with an emoji",
  parameters: z.object({
    chat_jid: z.string().describe("The chat JID where the message is"),
    message_id: z.string().describe("The ID of the message to react to"),
    emoji: z
      .string()
      .describe(
        "The emoji to react with (e.g., '👍', '❤️', '😂'). Use empty string to remove reaction.",
      ),
    from_me: z
      .boolean()
      .optional()
      .default(false)
      .describe("Whether the target message was sent by you"),
  }),
} as const;

export const deleteMessageContract = {
  name: "delete_message",
  description: "Delete (revoke) a message you sent",
  parameters: z.object({
    chat_jid: z.string().describe("The chat JID where the message is"),
    message_id: z.string().describe("The ID of the message to delete"),
    from_me: z
      .boolean()
      .optional()
      .default(true)
      .describe("Whether the message was sent by you (default true)"),
  }),
} as const;

export const markChatReadContract = {
  name: "mark_chat_read",
  description: "Mark all messages in a chat as read",
  parameters: z.object({
    chat_jid: z.string().describe("The chat JID to mark as read"),
  }),
} as const;

// ── chats.ts ────────────────────────────────────────────────────────

export const listChatsContract = {
  name: "list_chats",
  description: "List WhatsApp chats with metadata and filtering",
  parameters: z.object({
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(20)
      .describe("Max chats per page (default 20)"),
    page: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .default(0)
      .describe("Page number (0-indexed, default 0)"),
    sort_by: z
      .enum(["last_active", "name"])
      .optional()
      .default("last_active")
      .describe("Sort order: 'last_active' (default) or 'name'"),
    query: z.string().optional().describe("Optional filter by chat name or JID"),
    include_last_message: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include last message details (default true)"),
  }),
} as const;

export const getChatContract = {
  name: "get_chat",
  description: "Get detailed information about a specific chat",
  parameters: z.object({
    chat_jid: z.string().describe("The JID of the chat to retrieve"),
    include_last_message: z
      .boolean()
      .optional()
      .default(true)
      .describe("Include last message details (default true)"),
  }),
} as const;

// ── connection.ts ───────────────────────────────────────────────────

export const getConnectionStatusContract = {
  name: "get_connection_status",
  description: "Get current WhatsApp connection status and QR code if pending",
  parameters: z.object({}),
} as const;

export const logoutContract = {
  name: "logout",
  description: "Log out from WhatsApp and clear session data",
  parameters: z.object({}),
} as const;

// ── contacts.ts ─────────────────────────────────────────────────────

export const searchContactsContract = {
  name: "search_contacts",
  description: "Search for contacts by name or phone number part (JID)",
  parameters: z.object({
    query: z.string().min(1).describe("Search term for contact name or phone number part of JID"),
  }),
} as const;

export const listContactsContract = {
  name: "list_contacts",
  description: "List all contacts with optional name/number filter",
  parameters: z.object({
    query: z.string().optional().describe("Optional filter by name or phone number"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(50)
      .describe("Max contacts to return (default 50)"),
  }),
} as const;

// ── groups.ts ───────────────────────────────────────────────────────

export const getGroupInfoContract = {
  name: "get_group_info",
  description: "Get metadata for a WhatsApp group (name, description, participants, admins)",
  parameters: z.object({
    group_jid: z.string().describe("The group JID (must end with '@g.us')"),
  }),
} as const;

// ── media.ts ────────────────────────────────────────────────────────

export const downloadMediaContract = {
  name: "download_media",
  description: [
    "Download media (image, video, audio, document, sticker) from a WhatsApp message. Stored locally on the server by default (MEDIA_STORAGE=local); a repeat call for the same message reuses what's already there.",
    "",
    "For audio messages (audio/ptt), `transcribe` defaults to true: the bytes are preprocessed (16 kHz mono FLAC)",
    "and run through Whisper (`openai/whisper-large-v3` via OpenRouter). The response is an",
    "XML-wrapped <transcription> text block instead of the raw audio. Pass `transcribe: false` to get audio bytes.",
    "",
    "For image messages, `describe` is opt-in (default false). When true, the bytes are sent to a vision model via OpenRouter (default `openai/gpt-6-luna`, override with VISION_MODEL)",
    "and the response is an XML-wrapped <image_description> text block instead of the inline image.",
    "",
    "For non-audio/non-image media (documents, video, stickers), both flags are no-ops and the tool returns the",
    "standard resource_link.",
  ].join("\n"),
  parameters: z.object({
    message_id: z.string().describe("The ID of the message containing media"),
    chat_jid: z.string().describe("The JID of the chat where the message is"),
    transcribe: z
      .boolean()
      .optional()
      .describe(
        "Audio only: transcribe to text (default true for audio/ptt). Set false to receive raw audio bytes.",
      ),
    describe: z
      .boolean()
      .optional()
      .describe(
        "Image only: caption via an OpenRouter vision model (default false). Set true to receive an <image_description> text block instead of the inline image.",
      ),
  }),
} as const;

// ── messages.ts ─────────────────────────────────────────────────────

export const listMessagesContract = {
  name: "list_messages",
  description:
    "Retrieve message history for a specific chat with pagination and optional date filtering",
  parameters: z.object({
    chat_jid: z
      .string()
      .describe("The JID of the chat (e.g., '123456@s.whatsapp.net' or 'group@g.us')"),
    limit: z
      .number()
      .int()
      .positive()
      .optional()
      .default(20)
      .describe("Max messages per page (default 20)"),
    page: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .default(0)
      .describe("Page number (0-indexed, default 0)"),
    from_date: z
      .string()
      .optional()
      .describe("Filter messages from this date (ISO 8601, e.g., '2025-01-01')"),
    to_date: z
      .string()
      .optional()
      .describe("Filter messages up to this date (ISO 8601, e.g., '2025-02-01')"),
  }),
} as const;

export const getMessagesTodayContract = {
  name: "get_messages_today",
  description: "Get today's messages, optionally filtered to a specific chat",
  parameters: z.object({
    chat_jid: z.string().optional().describe("Optional: filter to a specific chat JID"),
    limit: z.number().int().positive().optional().default(50).describe("Max messages (default 50)"),
  }),
} as const;

export const searchMessagesContract = {
  name: "search_messages",
  description:
    "Search for messages across all chats or within a specific chat, with optional date filtering",
  parameters: z.object({
    query: z.string().min(1).describe("The text to search for"),
    chat_jid: z.string().optional().describe("Optional: Search within a specific chat JID"),
    from_date: z.string().optional().describe("Filter from this date (ISO 8601)"),
    to_date: z.string().optional().describe("Filter up to this date (ISO 8601)"),
    limit: z.number().int().positive().optional().default(10).describe("Max results (default 10)"),
    page: z.number().int().nonnegative().optional().default(0).describe("Page number (default 0)"),
  }),
} as const;

export const getMessageContextContract = {
  name: "get_message_context",
  description: "Retrieve messages around a specific message for context",
  parameters: z.object({
    chat_jid: z.string().describe("The JID of the chat where the message lives"),
    message_id: z.string().describe("The ID of the target message"),
    before: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .default(5)
      .describe("Messages before (default 5)"),
    after: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .default(5)
      .describe("Messages after (default 5)"),
  }),
} as const;

// ── monitoring.ts ───────────────────────────────────────────────────

export const getNewMessagesContract = {
  name: "get_new_messages",
  description:
    "Delta read: messages received since a cursor, across one or many chats — the cheap way to poll for replies instead of re-scanning each chat. Returns { messages, next_since }; pass next_since back on the next call. Excludes your own messages by default and always excludes this agent's own sends.",
  parameters: z.object({
    chat_jids: chatJidsParam,
    since: sinceParam,
    limit: z
      .number()
      .int()
      .positive()
      .max(200)
      .optional()
      .default(50)
      .describe("Max messages (default 50)"),
    include_from_me: includeFromMeParam,
  }),
} as const;

export const waitForMessagesContract = {
  name: "wait_for_messages",
  description:
    "Bounded await: block until the next matching message or timeout, then return { messages, next_since }. Returns immediately if one already arrived since the cursor. Use ONLY when you expect a reply within minutes of something you just sent and have nothing else to do meanwhile. Do NOT loop this to stay present in a chat — each empty return wastes one of your turns; for standing presence (monitor/watch/follow/act-as-persona) use `follow_chat` and attach the stream to your harness's background monitor. Excludes your own messages by default and always excludes this agent's own sends.",
  // Backstop above the tool's own cap so FastMCP never times out the call first.
  timeoutMs: (MAX_TIMEOUT_S + 30) * 1000,
  parameters: z.object({
    chat_jids: chatJidsParam,
    since: sinceParam,
    timeout_seconds: z
      .number()
      .int()
      .positive()
      .max(MAX_TIMEOUT_S)
      .optional()
      .default(DEFAULT_TIMEOUT_S)
      .describe(
        `Max seconds to block before returning (default ${DEFAULT_TIMEOUT_S}, max ${MAX_TIMEOUT_S}). Loop with next_since to cover longer waits.`,
      ),
    include_from_me: includeFromMeParam,
  }),
} as const;

export const followChatContract = {
  name: "follow_chat",
  description:
    "Become PRESENT in one or more chats: returns a stream URL that pushes each inbound message as it arrives, designed to be attached to your harness's background monitor (e.g. Claude Code Monitor({ws:{url}})) so you are woken per message while continuing other work. THIS is the tool for: monitoring a chat, watching a group, following a conversation, acting as the user's persona in a chat, chatting with people over hours. For a one-shot bounded wait for a reply you expect within minutes, use wait_for_messages. For a deployed headless service with its own HTTPS endpoint, use register_webhook.",
  parameters: z.object({
    chat_jids: chatJidsParam,
    include_from_me: z
      .boolean()
      .optional()
      .default(true)
      .describe(
        "Forward YOUR OWN (is_from_me) messages too — default true so persona mode sees replies you type from your phone and doesn't answer twice. The agent's own MCP sends are always suppressed.",
      ),
    transcribe: z
      .boolean()
      .optional()
      .default(true)
      .describe("Transcribe inbound voice notes before pushing the frame (default true)."),
  }),
} as const;

// ── sending.ts ──────────────────────────────────────────────────────

export const sendMessageContract = {
  name: "send_message",
  description:
    "Send a text message to a contact or group. The recipient is verified before sending: " +
    "a number that is not on WhatsApp is rejected outright, and a phone JID is upgraded to " +
    "its canonical @lid. If the server refuses the message, this tool THROWS rather than " +
    "reporting success — do not build phone JIDs by hand, resolve them with search_contacts. " +
    "Sends are also paced and a contact who has never messaged this account is refused, " +
    "because cold reach-outs get the number restricted.",
  parameters: z.object({
    recipient: z.string().describe("Recipient JID (e.g., 'number@s.whatsapp.net' or 'group@g.us')"),
    message: z.string().min(1).describe("The text message to send"),
    allow_cold_contact: z.boolean().optional().default(false).describe(ALLOW_COLD_DESCRIPTION),
  }),
} as const;

export const sendFileContract = {
  name: "send_file",
  description:
    "Send a file (image, video, document, audio) to a contact or group. file_path accepts: (a) http(s) URL, (b) base64 data: URL — context-heavy, only viable for tiny payloads, (c) absolute path that exists ON THE MCP SERVER (NOT your local disk — the server runs in a remote Docker container and cannot read host files). To send a host-disk file: POST raw bytes to `<MCP host>/upload` (Bearer auth = MCP_AUTH_TOKEN), receive `{url}`, then pass that URL here. Max 16 MB. For type=image the bytes must be JPEG or PNG (WebP screenshots are rejected — convert to PNG first).",
  parameters: z.object({
    recipient: z.string().describe("Recipient JID"),
    file_path: z
      .string()
      .describe(
        "http(s) URL, base64 data: URL, or server-side absolute path. To send a local host file with a remote MCP, upload it to <MCP host>/upload first and pass the returned URL. Max 16 MB.",
      ),
    caption: z.string().optional().describe("Optional caption for images/videos/documents"),
    type: z
      .enum(["image", "video", "document", "audio"])
      .optional()
      .default("image")
      .describe(
        "Type of the media. For 'image': only JPEG/PNG bytes are accepted (WebP rejected — convert to PNG first). For 'video': MP4/3GPP only. For 'audio': AAC/AMR/MP3/M4A/OGG. (default: image)",
      ),
    allow_cold_contact: z.boolean().optional().default(false).describe(ALLOW_COLD_DESCRIPTION),
  }),
} as const;

// ── webhooks/*.ts ───────────────────────────────────────────────────

export const registerWebhookContract = {
  name: "register_webhook",
  description:
    "For DEPLOYED, headless services that own an HTTPS endpoint (a server, n8n, a cloud function). An interactive agent session has no URL — for session presence use `follow_chat` instead. Subscribe a URL to inbound WhatsApp messages so an agent becomes reactive (real-time push). Only messages from chats on `allowed_jids` are forwarded; everyone else is silently ignored. Returns the subscription id.",
  parameters: z.object({
    target_url: z.string().url().describe("HTTPS endpoint that receives inbound_message events"),
    allowed_jids: z
      .array(z.string())
      .min(1)
      .describe(
        'Chats (person/group JIDs) allowed to wake this subscription. Use ["*"] for all chats.',
      ),
    secret: z
      .string()
      .optional()
      .describe("Shared secret used to sign deliveries (HMAC) or as a Bearer token. Recommended."),
    auth_mode: z
      .enum(["hmac", "bearer"])
      .optional()
      .default("hmac")
      .describe(
        "How the secret authenticates deliveries: 'hmac' signature header (default) or 'bearer' Authorization",
      ),
    transcribe: z
      .boolean()
      .optional()
      .default(true)
      .describe("Auto-transcribe forwarded voice notes before delivery (default true)"),
    include_from_me: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Forward YOUR OWN messages (is_from_me) in a chat shared with OTHERS (a group/contact). NOT needed for a self-chat (allow-listing your own number) — those auto-forward your messages so talk-to-yourself works with zero config. The agent's own replies are always suppressed to prevent loops. Default false (a customer-facing bot only sees genuine inbound).",
      ),
    label: z.string().optional().describe("Human label for managing this subscription"),
  }),
} as const;

export const deregisterWebhookContract = {
  name: "deregister_webhook",
  description: "Remove a webhook subscription by id (from register_webhook / list_webhooks).",
  parameters: z.object({
    id: z.string().describe("The subscription id to remove"),
  }),
} as const;

export const listWebhooksContract = {
  name: "list_webhooks",
  description: "List active webhook subscriptions for this tenant (secrets redacted).",
  parameters: z.object({}),
} as const;

/** Every tool contract, in no particular order — what the gateway proxies. */
export const TOOL_CONTRACTS = [
  reactToMessageContract,
  deleteMessageContract,
  markChatReadContract,
  listChatsContract,
  getChatContract,
  getConnectionStatusContract,
  logoutContract,
  searchContactsContract,
  listContactsContract,
  getGroupInfoContract,
  downloadMediaContract,
  listMessagesContract,
  getMessagesTodayContract,
  searchMessagesContract,
  getMessageContextContract,
  getNewMessagesContract,
  waitForMessagesContract,
  followChatContract,
  sendMessageContract,
  sendFileContract,
  registerWebhookContract,
  deregisterWebhookContract,
  listWebhooksContract,
] as const;
