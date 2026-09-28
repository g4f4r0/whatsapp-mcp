/**
 * Transcript sidecar cache for `download_media`: `<message_id>.txt` next to the
 * downloaded audio file (`<data dir>/media/<chat_jid>/`), so a voice note is only
 * ever transcribed once regardless of provider.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveDataDir } from "../env-config.ts";
import { sanitizeJidSegment } from "../storage.ts";

function sidecarPath(chatJid: string, messageId: string): string {
  return path.join(resolveDataDir(), "media", sanitizeJidSegment(chatJid), `${messageId}.txt`);
}

/** Returns the cached transcript, or null if none is saved yet. */
export async function readCachedTranscript(
  chatJid: string,
  messageId: string,
): Promise<string | null> {
  try {
    const text = (await readFile(sidecarPath(chatJid, messageId), "utf8")).trim();
    return text || null;
  } catch {
    return null;
  }
}

export async function writeCachedTranscript(
  chatJid: string,
  messageId: string,
  text: string,
): Promise<void> {
  const filePath = sidecarPath(chatJid, messageId);
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, text, { mode: 0o600 });
}
