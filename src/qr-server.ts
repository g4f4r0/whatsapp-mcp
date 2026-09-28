import http, { type Server } from "node:http";
import type { ConnectionState, ConnectionStatus } from "@amiticia/baileys-client";
import type { Logger } from "pino";
import QRCode from "qrcode";
import { readNonNegativeNumber } from "./env-config.ts";
import { createRouter, type Route } from "./http-router.ts";

/**
 * Statuses in which the WhatsApp socket is actually usable. Anything else is
 * reported as `degraded`, whatever the HTTP status ends up being.
 */
const LIVE_STATUSES = new Set<ConnectionStatus>(["connected", "syncing"]);

/**
 * Statuses that reset the degradation clock.
 *
 * `qr_pending` is deliberately included even though it is *not* live: it means
 * the server is waiting on a human to scan, which no container restart can fix
 * — a restart would destroy the very QR code the operator is looking at. So a
 * pairing-needed container reports `degraded` with HTTP 200, forever, and the
 * clock only starts once pairing moves on.
 *
 * `connecting` is deliberately *excluded*. The 2026-07-28 outage sat wedged for
 * ~21h while `/health` answered 200; a reconnect loop that flaps
 * disconnected→connecting→disconnected must accumulate downtime, or the grace
 * window can never elapse and the container stays "healthy" through a wedge.
 */
const CLOCK_RESETTING_STATUSES = new Set<ConnectionStatus>([...LIVE_STATUSES, "qr_pending"]);

function readGraceSeconds(): number {
  return readNonNegativeNumber(process.env.HEALTH_DISCONNECTED_GRACE_S, 300);
}

export type QrServerOptions = {
  /** Injectable clock in epoch milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /**
   * Seconds the socket may stay non-live before `/health` answers 503.
   * Defaults to `HEALTH_DISCONNECTED_GRACE_S` (300). `0` disables the 503
   * entirely, so an operator can stop a restart loop without a redeploy.
   */
  disconnectedGraceS?: number;
};

/**
 * Less is more: the pairing page shows only the QR code while waiting, and
 * only a plain success card once paired — nothing else (no status text, no
 * re-pair button). The success card matches how BB itself renders an MCP
 * OAuth success (apps/app/src/views/AuthCallbackView.tsx): a small bordered
 * card, a checkmark, a title, one line of muted subtext.
 */
function renderHtml(state: ConnectionState): string {
  const { status, qrCode } = state;

  const refreshing = status !== "connected";
  let body: string;
  if (status === "connected") {
    body = `
      <div class="card">
        <div class="row">
          <svg class="check" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.2 14.6-4.2-4.2 1.4-1.4 2.8 2.8 5.8-5.8 1.4 1.4-7.2 7.2Z" fill="currentColor"/></svg>
          <h1>WhatsApp connected</h1>
        </div>
        <p>You can close this window.</p>
      </div>`;
  } else if (status === "qr_pending" && qrCode) {
    body = `<img src="/qr.png" width="320" height="320" alt="WhatsApp QR" />`;
  } else {
    body = `<p class="muted">${escapeHtml(status)}&hellip;</p>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
${refreshing ? '<meta http-equiv="refresh" content="3" />' : ""}
<title>WhatsApp</title>
<style>
body { font-family: system-ui, sans-serif; display: flex; justify-content: center; padding: 3rem 1rem 0; background: #fff; color: #0a0a0a; }
img { display: block; border: 1px solid #eee; padding: 0.5rem; background: #fff; }
.muted { color: #71717a; font-size: 0.875rem; }
.card { width: 100%; max-width: 24rem; border: 1px solid #e4e4e7; border-radius: 0.5rem; padding: 0.75rem 1rem; }
.row { display: flex; align-items: center; gap: 0.5rem; }
.check { flex-shrink: 0; }
h1 { font-size: 0.875rem; font-weight: 600; margin: 0; }
.card p { margin: 0.25rem 0 0; font-size: 0.75rem; color: #71717a; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return c;
    }
  });
}

export function createQrServer(
  logger: Logger,
  getState: () => ConnectionState,
  onRepair?: () => Promise<void>,
  options: QrServerOptions = {},
): Server {
  const now = options.now ?? (() => Date.now());
  const graceS = options.disconnectedGraceS ?? readGraceSeconds();

  /**
   * When the socket was last observed in a clock-resetting status. Sampled on
   * each `/health` request — the endpoint Docker polls every 30s — rather than
   * pushed from the connection hooks, because `connectionState` is an object
   * owned and mutated by baileys-client, so there is no transition callback to
   * hang a timestamp off. Sampling makes the reported downtime lag reality by
   * at most one poll interval, and it lags in the safe direction: the last
   * *observed* good moment is never later than the real one.
   */
  let lastLiveAt = now();

  const routes: Route[] = [
    {
      method: "GET",
      path: "/health",
      handler: async (_req, res) => {
        const state = getState();
        if (CLOCK_RESETTING_STATUSES.has(state.status)) lastLiveAt = now();

        const disconnectedForS = Math.max(0, Math.floor((now() - lastLiveAt) / 1000));
        const wedged = graceS > 0 && disconnectedForS > graceS;

        const body = JSON.stringify({
          // `status` stays the WhatsApp connection status — the deploy runbook
          // and existing tests read it. The ok/degraded verdict is `health`.
          status: state.status,
          health: LIVE_STATUSES.has(state.status) ? "ok" : "degraded",
          user: state.user,
          syncProgress: state.syncProgress,
          disconnected_for_s: disconnectedForS,
          grace_s: graceS,
        });
        // 503 is what makes the Docker healthcheck fail, so the container is
        // finally restarted instead of sitting "healthy" with a dead socket.
        res.writeHead(wedged ? 503 : 200, {
          "content-type": "application/json; charset=utf-8",
        });
        res.end(body);
      },
    },
    {
      method: "GET",
      path: "/qr.png",
      handler: async (_req, res) => {
        const state = getState();
        if (state.status !== "qr_pending" || !state.qrCode) {
          res.writeHead(404, { "content-type": "text/plain" });
          res.end("no QR pending");
          return;
        }
        const png = await QRCode.toBuffer(state.qrCode, {
          errorCorrectionLevel: "M",
          width: 512,
          margin: 2,
        });
        res.writeHead(200, {
          "content-type": "image/png",
          "cache-control": "no-store",
        });
        res.end(png);
      },
    },
    {
      method: "GET",
      path: "/",
      handler: async (_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderHtml(getState()));
      },
    },
    {
      method: "GET",
      path: "/index.html",
      handler: async (_req, res) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderHtml(getState()));
      },
    },
    {
      method: "POST",
      path: "/repair",
      handler: async (_req, res) => {
        if (!onRepair) {
          res.writeHead(204);
          res.end();
          return;
        }
        await onRepair();
        res.writeHead(302, { location: "/" });
        res.end();
      },
    },
  ];

  return http.createServer(createRouter(routes, { logger }));
}
