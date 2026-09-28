import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "./env-config.ts";

export interface MediaStorageClient {
  putObject(
    bucket: string,
    key: string,
    data: Buffer,
    size?: number,
    metadata?: Record<string, string>,
  ): Promise<unknown>;
  bucketExists(bucket: string): Promise<boolean>;
  makeBucket(bucket: string, region?: string): Promise<void>;
  setBucketPolicy(bucket: string, policy: string): Promise<void>;
  getObject(bucket: string, key: string): Promise<NodeJS.ReadableStream>;
}

/** Returns true when the env var is set to the string "true" (case-insensitive). */
function parseBoolEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  return value.toLowerCase() === "true";
}

let _client: MediaStorageClient | null = null;

export function setStorageClient(client: MediaStorageClient): void {
  _client = client;
}

export function resetStorageClient(): void {
  _client = null;
}

function getBucket(): string {
  return process.env.S3_BUCKET ?? "amiticia-media";
}

/**
 * `MEDIA_STORAGE` picks where downloaded media lands. Default `local`: no S3/RustFS
 * sidecar needed, media stays on the account's own data dir. `s3` opts back into the
 * MinIO-compatible plane below (still gated by `S3_ENABLED` in main.ts for the bucket
 * setup). Anything else reads as the default, same convention as env-config.ts.
 */
function mediaStorageMode(): "local" | "s3" {
  return process.env.MEDIA_STORAGE?.trim().toLowerCase() === "s3" ? "s3" : "local";
}

/**
 * Same JID sanitization `putMedia` has always used for its S3 key, reused as a
 * path segment for local media (and, via transcribe/cache.ts, for the transcript
 * sidecar file that lives next to it).
 */
export function sanitizeJidSegment(jid: string): string {
  return jid.replace(/[^a-zA-Z0-9@._-]/g, "_");
}

function localMediaPath(chatJid: string, messageId: string, ext: string): string {
  return path.join(resolveDataDir(), "media", sanitizeJidSegment(chatJid), `${messageId}.${ext}`);
}

/** Writes owner-only (0700 dirs, 0600 files) under `<data dir>/media/<chat_jid>/<message_id>.<ext>`. */
async function putMediaLocal(params: {
  chatJid: string;
  messageId: string;
  ext: string;
  buffer: Buffer;
}): Promise<{ key: string; url: string }> {
  const filePath = localMediaPath(params.chatJid, params.messageId, params.ext);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.promises.writeFile(filePath, params.buffer, { mode: 0o600 });
  return { key: filePath, url: `file://${filePath}` };
}

/**
 * `minio` (~40 MB resident once loaded) is dynamic-imported here instead of at
 * module scope, so an instance running the default `MEDIA_STORAGE=local` never
 * pays for it — this module loads at startup regardless of mode (storage.ts is
 * a static import of actions.ts), but the S3 client library only loads if an
 * S3 call actually happens.
 */
async function getClient(): Promise<MediaStorageClient> {
  if (_client) return _client;
  const Minio = await import("minio");
  _client = new Minio.Client({
    endPoint: process.env.S3_ENDPOINT ?? "localhost",
    port: Number(process.env.S3_PORT ?? 9000),
    useSSL: parseBoolEnv(process.env.S3_USE_SSL, false),
    accessKey: process.env.S3_ACCESS_KEY ?? "minioadmin",
    secretKey: process.env.S3_SECRET_KEY ?? "minioadmin",
  });
  return _client;
}

export function publicUrlFor(key: string): string {
  // Local keys are absolute filesystem paths (see putMediaLocal); S3 keys are
  // relative object keys like `t/default/...`. The leading "/" disambiguates,
  // so this routes correctly regardless of the *current* MEDIA_STORAGE value
  // (e.g. a key written under the old mode, looked up after a config change).
  if (key.startsWith("/")) {
    return `file://${key}`;
  }
  const bucket = getBucket();
  const base = (process.env.MEDIA_PUBLIC_BASE_URL ?? `http://localhost:9000/${bucket}`).replace(
    /\/$/,
    "",
  );
  return `${base}/${key}`;
}

export async function putMedia(params: {
  tenantId?: string;
  chatJid: string;
  messageId: string;
  ext: string;
  mimetype: string;
  buffer: Buffer;
}): Promise<{ key: string; url: string }> {
  const { chatJid, messageId, ext, mimetype, buffer } = params;

  if (mediaStorageMode() === "local") {
    return putMediaLocal({ chatJid, messageId, ext, buffer });
  }

  const tenantId = params.tenantId ?? process.env.TENANT_ID ?? "default";
  const sanitizedJid = sanitizeJidSegment(chatJid);
  const key = `t/${tenantId}/${sanitizedJid}/${messageId}.${ext}`;

  return putS3Object(key, buffer, mimetype);
}

async function putS3Object(
  key: string,
  buffer: Buffer,
  mimetype: string,
): Promise<{ key: string; url: string }> {
  const client = await getClient();
  await client.putObject(getBucket(), key, buffer, buffer.length, { "Content-Type": mimetype });
  return { key, url: publicUrlFor(key) };
}

/**
 * Stores agent-supplied bytes under `t/{tenantId}/uploads/{uuid}.{ext}` so they
 * can be referenced by `send_file` as a public URL. Used by the upload HTTP
 * endpoint to bridge the host-disk → remote-MCP gap: the MCP container can't
 * read the agent's filesystem, and base64 data URLs blow up the context window
 * for any non-tiny file.
 */
export async function putUpload(params: {
  tenantId?: string;
  buffer: Buffer;
  mimetype: string;
  ext: string;
}): Promise<{ key: string; url: string }> {
  const { buffer, mimetype, ext } = params;
  const tenantId = params.tenantId ?? process.env.TENANT_ID ?? "default";
  const key = `t/${tenantId}/uploads/${randomUUID()}.${ext}`;

  return putS3Object(key, buffer, mimetype);
}

/**
 * Fetch raw bytes for an existing media object. Used by transcribe/describe
 * paths that need to feed the bytes to an external API; we already uploaded
 * the file when first downloading from WhatsApp.
 */
export async function getMediaBytes(key: string): Promise<Buffer> {
  if (key.startsWith("/")) {
    return fs.promises.readFile(key);
  }
  const bucket = getBucket();
  const client = await getClient();
  const stream = await client.getObject(bucket, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export async function ensureBucketReady(): Promise<void> {
  const client = await getClient();
  const bucket = getBucket();
  const region = process.env.S3_REGION ?? "us-east-1";
  const skipPolicy = parseBoolEnv(process.env.S3_SKIP_POLICY, false);

  const exists = await client.bucketExists(bucket);
  if (!exists) {
    await client.makeBucket(bucket, region);
  }

  if (!skipPolicy) {
    const policy = JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: "*",
          Action: "s3:GetObject",
          Resource: `arn:aws:s3:::${bucket}/*`,
        },
      ],
    });
    await client.setBucketPolicy(bucket, policy);
  }
}
