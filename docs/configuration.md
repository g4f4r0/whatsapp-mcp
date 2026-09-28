# Configuration

All configuration is environment variables. The production values live in `deploy/.env`
(template: [`deploy/.env.example`](../deploy/.env.example)).

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WHATSAPP_MCP_DATA_DIR` | `.` | Base directory for `auth_info/`, `data/`, and pino log files |
| `LOG_LEVEL` | `info` | Pino log level |
| `MCP_TRANSPORT` | `stdio` | `stdio`, `httpstream` (the Docker image sets `httpstream`), or `local-rpc` — a lightweight internal-only tool endpoint with no FastMCP/MCP-protocol overhead, used by the gateway for its own children (see [Multi-account gateway](#multi-account-gateway)). Never set this by hand for a standalone instance. |
| `MCP_HOST` | `127.0.0.1` | Bind host when `MCP_TRANSPORT=httpstream` |
| `MCP_PORT` | `3001` | Bind port when `MCP_TRANSPORT=httpstream` (the Docker image sets `39001`) |
| `MCP_ENDPOINT` | `/mcp` | HTTP path for MCP when `MCP_TRANSPORT=httpstream` |
| `MCP_AUTH_TOKEN` | _(unset)_ | If set, HTTP MCP requires `Authorization: Bearer <token>`. If unset, endpoint accepts unauthenticated requests (stdio/local dev only — never run like this in prod). |
| `QR_SERVER_HOST` | `127.0.0.1` | Bind host for the public QR web page |
| `QR_SERVER_PORT` | `39002` | Bind port for the QR web page |
| `UPLOAD_SERVER_HOST` | `127.0.0.1` | Bind host for the host-disk upload endpoint (only started when `S3_ENABLED=true`) |
| `UPLOAD_SERVER_PORT` | `39003` | Bind port for the upload endpoint. Exposed publicly via Traefik at `mcp.example.com/upload`. Reuses `MCP_AUTH_TOKEN` for Bearer auth. |
| `STREAM_SERVER_HOST` | `127.0.0.1` | Bind host for the `follow_chat` WebSocket presence stream. |
| `STREAM_SERVER_PORT` | `39004` | Bind port for the stream server. Must be exposed publicly via Traefik at `mcp.example.com/stream` (WebSocket upgrade). |
| `STREAM_PUBLIC_URL` | _(derived: `ws://<host>:<port>/stream`)_ | Public base URL `follow_chat` embeds in the returned `ws_url`. Prod: `wss://mcp.example.com/stream`. |
| `STREAM_TOKEN_TTL_S` | `1800` | Lifetime (seconds) of a `follow_chat` stream token. In-memory only; scoped to the requested jids + flags; treated as a bearer secret. |
| `PUBLIC_QR_URL` | _(derived: `http://<QR_SERVER_HOST>:<QR_SERVER_PORT>/`, `localhost` for a wildcard bind)_ | URL sent in ntfy `Click` header and message text so tapping the push opens the QR page. Set it to the public QR page (e.g. `https://wa.example.com/`) in any deployment you pair from a phone |
| `NTFY_TOPIC_URL` | _(unset)_ | ntfy.sh topic URL; unset = notifications disabled |
| `NTFY_TOKEN` | _(unset)_ | Bearer token for protected ntfy topics |
| `EXPECTED_WA_NUMBER` | _(unset)_ | If set, only pairings whose JID starts with this prefix are accepted. A mismatch triggers `socket.logout()`, purges `auth_info/`, and fires an ntfy alert. Critical when the QR page is publicly reachable. |
| `MEDIA_STORAGE` | `local` | Where `download_media` stores bytes: `local` (default — `<WHATSAPP_MCP_DATA_DIR>/media/<chat_jid>/<message_id>.<ext>`, owner-only permissions) or `s3` (the plane below). |
| `S3_ENABLED` | `false` | Set to `true` to enable the S3-compatible media plane (also requires `MEDIA_STORAGE=s3`). Prod uses RustFS running as a sidecar in the same compose stack — no managed cloud, no extra bill. |
| `S3_ENDPOINT` | `localhost` | S3 endpoint hostname (dev/prod: `minio` (runs RustFS; service name kept for DNS compat) — service name on the docker network). |
| `S3_PORT` | `9000` | Port for the S3 endpoint. Always `9000` for the RustFS sidecar. |
| `S3_USE_SSL` | `false` | Always `false` — Traefik terminates TLS in front of RustFS; the app talks to RustFS in-cluster over HTTP. |
| `S3_ACCESS_KEY` | `minioadmin` | S3 access key. Prod: same value as `MINIO_ROOT_USER`. |
| `S3_SECRET_KEY` | `minioadmin` | S3 secret key. Prod: same value as `MINIO_ROOT_PASSWORD`. |
| `S3_BUCKET` | `amiticia-media` | Bucket name. The `mc` init sidecar creates it on first boot. |
| `S3_REGION` | `us-east-1` | Bucket region (cosmetic for RustFS; SDK still requires it). |
| `S3_SKIP_POLICY` | `false` | Keep `false` — RustFS accepts `setBucketPolicy`, so the app sets the public-read policy at boot. |
| `MEDIA_PUBLIC_BASE_URL` | _(derived from endpoint)_ | Public base URL prefix for media. Dev: `http://localhost:9000/amiticia-media`. Prod: `https://mcp.example.com/media` (Traefik path-based route, see `deploy/docker-compose.yaml`). |
| `TENANT_ID` | `default` | Object key prefix: `t/{tenantId}/…`. One WhatsApp account per instance, so one tenant. |
| `MEDIA_INLINE_MAX_BYTES` | `5242880` | Max file size (bytes) for inline `imageContent`/`audioContent` in tool response. |
| `SEND_ACK_WAIT_MS` | `3000` | How long `send_message` / `send_file` wait for a server rejection ack before declaring the send accepted. Observed ack latency is ~40 ms, so the default carries ~75× headroom. `0` disables the wait (restores fire-and-forget: a refused send reports success again). |
| `SEND_PRESEND_CHECK` | `true` | Verify the recipient exists via `onWhatsApp()` before sending, and upgrade a phone JID to its canonical `@lid`. Set `false` to send to exactly the JID given, unverified. |
| `SEND_BLOCKLIST_ENABLED`, `SEND_COLD_CONTACT_GUARD`, `SEND_COLD_OVERRIDE`, `SEND_COLD_ALLOWED_JIDS`, `SEND_RATE_LIMIT_*`, `SEND_SIMULATE_TYPING`, `SEND_TYPING_MAX_MS` | see doc | The anti-ban guard chain. Defaults, effects and the per-instance policy: **[`account-restrictions.md`](./account-restrictions.md)**. These are risk-owner settings — don't change one to make a send go through. |
| `HEALTH_DISCONNECTED_GRACE_S` | `300` | How long the WhatsApp socket may be disconnected before `/health` returns 503. Guards against the failure where the container reported `healthy` through a 21-hour outage. |
| `OPENROUTER_API_KEY` | _(unset)_ | Enables `download_media`'s `transcribe` (Whisper `openai/whisper-large-v3`, the default audio route) and `describe` (vision model) flags. |
| `AUDIO_PROVIDER` | `openrouter` | Transcription route: `openrouter` \| `groq` \| `openai` \| `bb`. Rollback lanes kept deliberately; an unknown value throws rather than silently guessing. **Routing is never by key presence** — a leftover `GROQ_API_KEY` must not quietly keep traffic on a closed account. |
| `BB_BIN_PATH` | _(unset)_ | Path to the `bb` CLI. Required when `AUDIO_PROVIDER=bb`: transcribes through `bb voice transcribe` instead of an HTTP Whisper provider, so no provider API key needs to reach this process. Skips the FLAC/16kHz preprocessing step. The transcript is cached next to the audio (`<message_id>.txt`) so a voice note is only ever transcribed once. |
| `GROQ_API_KEY` | _(unset)_ | Only used when `AUDIO_PROVIDER=groq` (rollback; `whisper-large-v3`). |
| `OPENAI_API_KEY` | _(unset)_ | Only used when `AUDIO_PROVIDER=openai` (rollback; `whisper-1`). |
| `WHISPER_MODEL` | _(per-route default)_ | Override the Whisper model on whichever route is active (`openrouter`/`groq`/`openai` only). |
| `VISION_MODEL` | `openai/gpt-6-luna` | OpenRouter model id used by `download_media`'s `describe` flag. Any image-input model works. |
| `FFMPEG_BIN` | `ffmpeg` | Path to the ffmpeg binary used for audio preprocessing before Whisper. |

## Multi-account gateway

`pnpm start` runs a single account. `pnpm start:gateway` (`src/gateway-main.ts`) instead runs
one gateway process that fronts every account configured under
`WHATSAPP_MCP_ACCOUNTS_DIR` (default `~/.config/whatsapp-mcp/accounts`, one `<account>.env`
per account — same `EXPECTED_WA_NUMBER`/`MCP_PORT`/`QR_SERVER_PORT`/`STREAM_SERVER_PORT`
format as before). Each account still runs as its own child process (this same `src/main.ts`, unchanged, just
started with `MCP_TRANSPORT=local-rpc` — see above) on its already-assigned, loopback-only port
block; the gateway is the only thing those ports are exposed to. Every tool gets a required
`account` parameter, plus a gateway-native `list_accounts` tool. Pairing pages are served at
`/qr/<account>` on one port. Additional gateway env vars: `WHATSAPP_MCP_DATA_ROOT` (default
`~/.local/share/whatsapp-mcp`, holding each account's existing `<name>/` subdir),
`WHATSAPP_MCP_GATEWAY_LOG_DIR` (default: same as the data root). `MCP_PORT`/`MCP_HOST` and
`QR_SERVER_PORT`/`QR_SERVER_HOST` on the gateway itself default to `39090`/`39091` rather than
the single-account `39001`/`39002`, since those are now taken by the first account's internal
child ports. See `src/gateway/server.ts`.

### Memory footprint

`pnpm start`/`pnpm start:gateway` (and the ops launcher) pass V8 heap flags
(`--max-old-space-size`, `--max-semi-space-size`, `--optimize-for-size`) — on this dependency
graph (drizzle-orm's import alone commits well over 100 MB of heap by default, regardless of
how little of it is actually used) V8's default heap sizing is dramatically oversized for a
single low-traffic WhatsApp account. Capping it, plus the gateway never importing the
single-account stack it doesn't run (see `mcp/tools/contracts.ts`) and children talking to the
gateway over `local-rpc` instead of a second real MCP server, brought one account's steady-state
resident memory down from roughly 390 MB (gateway + one child) to roughly 130–140 MB each —
about a 30% reduction, with an even larger cut to peak memory during connect/sync. Each
additional account adds one more child process at roughly the same per-child cost; the gateway's
own footprint is a fixed cost shared across every account.

## Data storage

Paths are relative to `WHATSAPP_MCP_DATA_DIR` (defaults to `.` when running via `pnpm start`, `/data` in the Docker image):

- `auth_info/` - WhatsApp authentication (Baileys multi-file auth state)
- `data/whatsapp.db` - SQLite database (chats, messages, contacts)
- `backups/hourly/whatsapp.db` - Rolling hourly snapshot (overwritten, WAL-safe)
- `backups/daily/whatsapp-YYYY-MM-DD.db` - Per-day snapshots (14-day retention)
- `backups/daily/auth_info-YYYY-MM-DD.tar.gz` - Per-day auth tarball
- `wa-logs.txt` - WhatsApp/Baileys logs
- `mcp-logs.txt` - MCP server logs

> **Media**: by default (`MEDIA_STORAGE=local`) downloaded media stays on disk at
> `<WHATSAPP_MCP_DATA_DIR>/media/<chat_jid>/<message_id>.<ext>` — no S3-compatible sidecar
> needed. Set `MEDIA_STORAGE=s3` (and `S3_ENABLED=true`) to opt back into a RustFS/MinIO plane:
> it's stored in the same compose stack (bind-mounted at `/storage/whatsapp-mcp/minio` in the
> production compose) and served publicly through Traefik at `https://mcp.example.com/media/<key>`.
> The legacy `data/media/` directory existed in older deployments — run `scripts/backfill-media.sh`
> inside the container to upload existing files into RustFS; the script then drops the legacy column.

All data directories are gitignored for security.

## Database schema

SQLite in WAL mode. The authoritative definitions are `src/db/schema.ts` (Drizzle types) and
`src/db/ddl.ts` (the idempotent `CREATE TABLE` / additive `ALTER TABLE` statements run at
boot). There is no migration runner, so a new table or column must be declared in **both**.

| Table | Holds |
|---|---|
| `chats` | One row per chat JID, with name and `last_message_time` |
| `messages` | Primary key `(id, chat_jid)`. Text content plus media metadata (`media_type`, `mimetype`, `media_key`, `direct_path`, `file_length`, hashes) and `media_object_key` once downloaded — a local filesystem path under `MEDIA_STORAGE=local` (default), or the S3 object key (`t/{tenantId}/{sanitizedJid}/{msgId}.{ext}`) under `MEDIA_STORAGE=s3` |
| `contacts` | JID, saved name, push name (`notify`), phone number |
| `jid_aliases` | Maps phone-number JIDs and `@lid` JIDs of the same person to one `canonical_jid`, so filters and guards cannot be bypassed by a PN/LID mismatch |
| `webhook_subscriptions` | Outbound webhook registrations — see [`webhooks.md`](./webhooks.md) |
| `send_blocklist` | Recipients WhatsApp refused with a 463 while cold. Durable across sessions; clearing an entry is a manual SQL delete, deliberately |
| `schema_meta` | Internal key/value markers for one-off data migrations |
