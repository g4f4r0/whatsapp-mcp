import { normalizeJid } from "@amiticia/baileys-client";
import { assertSocketActive } from "../../actions.ts";
import { resolveRecipient } from "../../recipient.ts";
import { assertSendAccepted, getSendAckWaitMs, isPresendCheckEnabled } from "../../send-guard.ts";
import { applySendPolicy } from "../../send-policy.ts";
import { sendWhatsAppMedia, sendWhatsAppMessage } from "../../whatsapp.ts";
import { sendFileContract, sendMessageContract } from "./contracts.ts";
import type { ToolDeps, ToolRegistrar } from "./types.ts";

/**
 * The account's own JIDs — phone-number (`user.id`) and LID (`user.lid`).
 *
 * Same source `whatsapp.ts` uses to detect the self-chat on the inbound side.
 * Here it keeps the cold-contact guard from refusing a reply into your own
 * self-chat, which by construction has no inbound history.
 */
function ownJidsOf(socket: ReturnType<typeof assertSocketActive>): string[] {
  const user = socket.user as { id?: string; lid?: string } | undefined;
  return [user?.id, user?.lid].filter((jid): jid is string => Boolean(jid)).map(normalizeJid);
}

export function registerSendingTools(server: ToolRegistrar, deps: ToolDeps): void {
  const { mcpLogger, waLogger } = deps;

  /**
   * Verify the recipient exists and upgrade it to its canonical LID.
   *
   * Runs before every send so a mistyped number fails without spending a
   * reach-out — see `recipient.ts` for why that matters.
   */
  async function resolveTarget(socket: ReturnType<typeof assertSocketActive>, jid: string) {
    if (!isPresendCheckEnabled()) return jid;
    return resolveRecipient(socket, jid, waLogger);
  }

  server.addTool({
    ...sendMessageContract,
    execute: async ({ recipient, message, allow_cold_contact }) => {
      mcpLogger.info(`[MCP Tool] Executing send_message to ${recipient}`);
      const socket = assertSocketActive();

      const normalizedRecipient = normalizeJid(recipient);
      if (!normalizedRecipient.includes("@")) {
        throw new Error(`Invalid recipient format: "${recipient}". JID must contain "@".`);
      }

      const target = await resolveTarget(socket, normalizedRecipient);
      await applySendPolicy({
        socket,
        jid: target,
        logger: waLogger,
        isText: true,
        text: message,
        allowCold: allow_cold_contact,
        ownJids: ownJidsOf(socket),
      });

      const result = await sendWhatsAppMessage(waLogger, target, message);

      if (result?.key?.id) {
        // sendMessage() resolving only means "written to the socket". Wait for a
        // possible refusal so we never report a phantom delivery.
        await assertSendAccepted(result.key.id, target, getSendAckWaitMs());
        return `Message sent successfully to ${target} (ID: ${result.key.id}).`;
      } else {
        throw new Error(`Failed to send message to ${target}.`);
      }
    },
  });

  server.addTool({
    ...sendFileContract,
    execute: async ({ recipient, file_path, caption, type, allow_cold_contact }) => {
      mcpLogger.info(`[MCP Tool] Executing send_file to ${recipient}: ${file_path}`);
      const socket = assertSocketActive();

      const normalizedRecipient = normalizeJid(recipient);
      const target = await resolveTarget(socket, normalizedRecipient);
      // isText: false — media has no plausible typing indicator, so none is faked.
      await applySendPolicy({
        socket,
        jid: target,
        logger: waLogger,
        isText: false,
        allowCold: allow_cold_contact,
        ownJids: ownJidsOf(socket),
      });

      let result: Awaited<ReturnType<typeof sendWhatsAppMedia>>;
      try {
        result = await sendWhatsAppMedia(waLogger, target, file_path, caption, type);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to send ${type} to ${target}: ${reason}`);
      }

      if (result?.key?.id) {
        await assertSendAccepted(result.key.id, target, getSendAckWaitMs());
        return `${type.charAt(0).toUpperCase() + type.slice(1)} sent successfully to ${target} (ID: ${result.key.id}).`;
      } else {
        throw new Error(
          `Failed to send ${type} to ${target} (no message ID returned — socket may be disconnected)`,
        );
      }
    },
  });
}
