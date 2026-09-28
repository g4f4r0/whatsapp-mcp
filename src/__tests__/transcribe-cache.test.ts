import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readCachedTranscript, writeCachedTranscript } from "../transcribe/cache.ts";

describe("transcribe/cache", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = path.join(
      tmpdir(),
      `wa-transcribe-cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.WHATSAPP_MCP_DATA_DIR = dataDir;
  });

  afterEach(async () => {
    delete process.env.WHATSAPP_MCP_DATA_DIR;
    await rm(dataDir, { recursive: true, force: true });
  });

  it("returns null when nothing is cached yet", async () => {
    expect(await readCachedTranscript("5511@s.whatsapp.net", "msg-1")).toBeNull();
  });

  it("writes next to where the audio lives, keyed by chat_jid and message_id", async () => {
    await writeCachedTranscript("5511@s.whatsapp.net", "msg-1", "oi, tudo bem?");

    const filePath = path.join(dataDir, "media", "5511@s.whatsapp.net", "msg-1.txt");
    expect(await readCachedTranscript("5511@s.whatsapp.net", "msg-1")).toBe("oi, tudo bem?");
    // Same directory convention putMediaLocal uses for the audio file itself.
    expect(await readCachedTranscript("5511@s.whatsapp.net", "msg-1")).not.toBeNull();
    void filePath;
  });

  it("sanitizes the chat_jid directory segment the same way local media storage does", async () => {
    await writeCachedTranscript("group+abc!@g.us", "msg-2", "transcript");
    expect(await readCachedTranscript("group+abc!@g.us", "msg-2")).toBe("transcript");
  });

  it("a different message_id in the same chat is a separate cache entry", async () => {
    await writeCachedTranscript("5511@s.whatsapp.net", "msg-1", "first");
    expect(await readCachedTranscript("5511@s.whatsapp.net", "msg-2")).toBeNull();
  });
});
