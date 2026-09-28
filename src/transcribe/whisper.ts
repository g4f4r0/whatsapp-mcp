/**
 * Whisper transcription via OpenRouter, with Groq/OpenAI kept as rollback lanes.
 *
 * Takes raw bytes (already preprocessed to 16 kHz mono FLAC by `preprocess.ts`)
 * rather than a file path, and is tuned for pt-BR.
 *
 * MIGRATED 2026-08-24. This used the `groq-sdk` and `openai` SDKs and picked
 * between them by which key happened to be set. Both are gone:
 *
 *   - All three vendors expose the SAME OpenAI-shaped multipart
 *     `POST {baseUrl}/audio/transcriptions`, so one plain `fetch` serves every
 *     route and two SDKs no longer need to be in the image for one endpoint.
 *     (Another client of ours claimed OpenRouter needs a JSON+base64 body
 *     instead. That is wrong — OpenRouter documents both shapes, and multipart
 *     was verified end-to-end against a real voice note on 2026-07-31. That
 *     client's tests mocked `fetch`, so they never exercised the claim.)
 *
 *   - The route is chosen by `AUDIO_PROVIDER`, never by key presence. Choosing
 *     by key presence is how a leftover `GROQ_API_KEY` silently keeps traffic
 *     on the old vendor while the migration is reported as done — which matters
 *     here because the Groq account is being closed.
 *
 * Ported from an internal sibling project's transcription client.
 *
 * Cookbook: the 25 MB provider ceiling is sidestepped by preprocessing
 * upstream; the guard here just raises a clearer error if the FLAC still
 * exceeds 24 MB after preprocess.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { type ProcessResult, ProcessSpawnError, runProcess } from "../process-run.ts";

const TWENTY_FOUR_MB = 24 * 1024 * 1024;

/**
 * Where each provider lives and what it calls Whisper Large v3. Only these
 * three values differ between routes; the request below serves all of them.
 *
 * `openai/whisper-large-v3` is the same Whisper this used to hit on Groq, and
 * OpenRouter may even route it back to Groq upstream. We simply no longer hold
 * a Groq account.
 *
 * CORRECTION 2026-08-24: an earlier version of this comment claimed OpenRouter
 * has no `-turbo` build. Wrong — `openai/whisper-large-v3-turbo` has been
 * available since 2026-05-01, is ~6x faster (4 decoder layers vs 32) and is
 * cheaper on every provider. Staying on large-v3 is a deliberate call, not a
 * lack of options: the vendor concedes "minor quality degradation" and no
 * pt-BR WER comparison exists to size it. `WHISPER_MODEL` trials it with no
 * code change.
 */
const AUDIO_ROUTES = {
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/whisper-large-v3",
    keyName: "OPENROUTER_API_KEY",
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3",
    keyName: "GROQ_API_KEY",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "whisper-1",
    keyName: "OPENAI_API_KEY",
  },
} as const;

/**
 * `bb` is a fourth route, handled separately from `AUDIO_ROUTES` below: it shells
 * out to `bb voice transcribe` instead of hitting an HTTP endpoint with an API
 * key, so no provider key needs to reach this process. See `transcribeViaBb`.
 */
export type AudioProvider = keyof typeof AUDIO_ROUTES | "bb";

export interface TranscribeResult {
  text: string;
  model: string;
  provider: AudioProvider;
  duration_s?: number;
}

export interface TranscribeOptions {
  buffer: Buffer;
  filename?: string;
  language?: string;
  logger?: Logger;
}

export class TranscribeError extends Error {
  override cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "TranscribeError";
    this.cause = cause;
  }
}

export function resolveProvider(): AudioProvider {
  const raw = process.env.AUDIO_PROVIDER?.trim().toLowerCase();
  if (!raw) return "openrouter";
  if (raw === "bb") return "bb";
  if (raw in AUDIO_ROUTES) return raw as AudioProvider;
  throw new TranscribeError(
    `AUDIO_PROVIDER="${raw}" is not a known route (bb, ${Object.keys(AUDIO_ROUTES).join(", ")}).`,
  );
}

/**
 * Pull the transcript out of the response body.
 *
 * A body we do not recognise THROWS rather than being passed off as speech:
 * handing `{"error":...}` to an agent as the sender's words fabricates what a
 * human said, which is worse than failing. `whatsapp.ts` already catches and
 * returns null, so a throw degrades to "no transcription", never to a lie.
 */
function readTranscript(body: string): { text: string; duration_s?: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A provider that ignored response_format and replied with the bare string.
    return { text: body.trim() };
  }
  if (typeof parsed === "object" && parsed !== null && "text" in parsed) {
    const { text, duration } = parsed as { text?: unknown; duration?: unknown };
    if (typeof text === "string") {
      return {
        text: text.trim(),
        duration_s: typeof duration === "number" ? duration : undefined,
      };
    }
  }
  throw new TranscribeError("Transcription response was not in a recognised format.");
}

/**
 * Transcribe a preprocessed audio buffer.
 *
 * Route comes from `AUDIO_PROVIDER` (default `openrouter`); `WHISPER_MODEL`
 * overrides the model on whichever route is active.
 */
export async function transcribeAudio(opts: TranscribeOptions): Promise<TranscribeResult> {
  const { buffer, filename = "audio.flac", language = "pt", logger } = opts;

  if (buffer.length > TWENTY_FOUR_MB) {
    throw new TranscribeError(
      `Preprocessed audio is ${(buffer.length / 1024 / 1024).toFixed(1)} MB — exceeds 24 MB safe ceiling. Chunking not yet implemented; split the source audio before retrying.`,
    );
  }

  const provider = resolveProvider();
  if (provider === "bb") {
    throw new TranscribeError(
      "AUDIO_PROVIDER=bb routes through transcribeViaBb, not transcribeAudio.",
    );
  }
  const route = AUDIO_ROUTES[provider];
  const apiKey = process.env[route.keyName];
  if (!apiKey) {
    throw new TranscribeError(
      `${route.keyName} is not set — cannot transcribe audio via ${provider}.`,
    );
  }
  const model = process.env.WHISPER_MODEL?.trim() || route.model;

  logger?.debug({ provider, model, bytes: buffer.length }, "whisper.transcribe start");

  const form = new FormData();
  form.append("file", new File([new Uint8Array(buffer)], filename));
  form.append("model", model);
  // Fixed to Portuguese: guessing the language of a two-second voice note is
  // how a transcript comes back in Spanish.
  form.append("language", language);
  // verbose_json (not "text") because `duration` feeds the duration_s attribute
  // of the <transcription> envelope agents read. OpenRouter supports only
  // json/verbose_json; Groq and OpenAI accept verbose_json too.
  form.append("response_format", "verbose_json");

  let res: Response;
  try {
    res = await fetch(`${route.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch (err) {
    throw new TranscribeError(`${provider} Whisper request failed: ${(err as Error).message}`, err);
  }

  const body = (await res.text()).trim();
  if (!res.ok) {
    throw new TranscribeError(`${provider} Whisper request failed: HTTP ${res.status} — ${body}`);
  }

  const { text, duration_s } = readTranscript(body);
  if (!text) {
    // Returning "" would let an agent answer confidently about audio nobody heard.
    throw new TranscribeError(`${provider} Whisper returned an empty transcript.`);
  }

  logger?.debug({ provider, model, chars: text.length }, "whisper.transcribe done");
  return { text, model, provider, duration_s };
}

export interface TranscribeViaBbOptions {
  /** Original (unprocessed) audio bytes — the bb route skips FLAC preprocessing. */
  buffer: Buffer;
  /** File extension for the staged temp file bb reads, e.g. "ogg". */
  ext: string;
  /** MIME type passed to `bb voice transcribe --type`. */
  mimetype: string;
  logger?: Logger;
}

export interface TranscribeViaBbResult {
  text: string;
  model: "bb";
  provider: "bb";
}

/**
 * Transcribe via the host's own `bb voice transcribe` CLI instead of an HTTP
 * provider — no OpenRouter/Groq/OpenAI key ever reaches this process. Stages the
 * original bytes to a temp file (the CLI takes a file path, not stdin) and skips
 * the FLAC/16kHz preprocessing step: `bb voice transcribe` accepts the source
 * format directly (verified against a real WhatsApp OGG/Opus voice note).
 */
export async function transcribeViaBb(
  opts: TranscribeViaBbOptions,
): Promise<TranscribeViaBbResult> {
  const bbBin = process.env.BB_BIN_PATH?.trim();
  if (!bbBin) {
    throw new TranscribeError("BB_BIN_PATH is not set — cannot transcribe via AUDIO_PROVIDER=bb.");
  }

  const stageDir = await mkdtemp(join(tmpdir(), "wa-bb-voice-"));
  const filePath = join(stageDir, `audio.${opts.ext || "bin"}`);
  try {
    await writeFile(filePath, opts.buffer);

    opts.logger?.debug({ bbBin, mimetype: opts.mimetype }, "bb voice transcribe start");
    const stdout = await runBb(bbBin, [
      "voice",
      "transcribe",
      "--type",
      opts.mimetype,
      "--json",
      filePath,
    ]);

    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch (err) {
      throw new TranscribeError("bb voice transcribe --json did not return valid JSON.", err);
    }
    const text = (parsed as { text?: unknown } | null)?.text;
    if (typeof text !== "string" || !text.trim()) {
      // Same rule as readTranscript above: no text is a failure, not a silent "".
      throw new TranscribeError("bb voice transcribe returned no text.");
    }

    opts.logger?.debug({ chars: text.length }, "bb voice transcribe done");
    return { text: text.trim(), model: "bb", provider: "bb" };
  } finally {
    await rm(stageDir, { recursive: true, force: true }).catch(() => {
      /* best effort */
    });
  }
}

/** Runs `bin args...` via the shared process runner, returns trimmed stdout. */
async function runBb(bin: string, args: string[]): Promise<string> {
  let result: ProcessResult;
  try {
    result = await runProcess(bin, args);
  } catch (err) {
    if (err instanceof ProcessSpawnError && err.code === "ENOENT") {
      throw new TranscribeError(`bb binary not found at "${bin}". Set BB_BIN_PATH.`);
    }
    throw new TranscribeError(`bb spawn failed: ${(err as Error).message}`, err);
  }
  if (result.code !== 0) {
    throw new TranscribeError(
      `bb voice transcribe exited with code ${result.code}: ${result.stderr.toString("utf8")}`,
    );
  }
  return result.stdout.toString("utf8").trim();
}
