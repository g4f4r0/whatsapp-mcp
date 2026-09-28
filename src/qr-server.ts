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

/** Exact text every other BB MCP shows on OAuth success — plain, no styling. */
const SUCCESS_TEXT = "Authentication completed. You can close this window.";

function contentFor(status: string): string {
  if (status === "connected") return `<p>${SUCCESS_TEXT}</p>`;
  if (status === "qr_pending") {
    // Relative, not "/qr.png": this same markup is served standalone (where
    // the page lives at "/") and behind the gateway's proxy (where it lives
    // at "/qr/<account>/") — a root-relative src would 404 behind the proxy.
    return `<img id="qr" src="qr.png" width="320" height="320" alt="WhatsApp QR" />`;
  }
  return `<p>${escapeHtml(status)}&hellip;</p>`;
}

/**
 * Less is more: the pairing page shows only the QR code while waiting, and
 * only the plain success line once paired — no card, icon, styling or
 * status text. No full-page reloads: a few lines of inline JS poll `health`
 * (relative, same reasoning as the image src above) every 3s and swap the
 * QR image or the success text in place — the QR itself only changes server
 * side every ~20s, but re-pointing the `<img>` at a fresh URL is cheap and
 * doesn't flash the way a full page reload does.
 */
function renderHtml(state: ConnectionState): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>WhatsApp</title>
<style>
body { font-family: system-ui, sans-serif; display: flex; justify-content: center; padding: 3rem 1rem 0; background: #fff; color: #0a0a0a; }
img { display: block; border: 1px solid #eee; padding: 0.5rem; background: #fff; }
</style>
</head>
<body>
<div id="content">${contentFor(state.status)}</div>
<script>
(function () {
  var content = document.getElementById("content");
  var timer = setInterval(poll, 3000);
  function poll() {
    fetch("health", { cache: "no-store" })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.status === "qr_pending") {
          var img = document.getElementById("qr");
          if (!img) {
            content.innerHTML = '<img id="qr" width="320" height="320" alt="WhatsApp QR">';
            img = document.getElementById("qr");
          }
          img.src = "qr.png?t=" + Date.now();
        } else if (data.status === "connected") {
          content.innerHTML = "<p>${SUCCESS_TEXT}</p>";
          clearInterval(timer);
        } else {
          content.textContent = data.status + "\\u2026";
        }
      })
      .catch(function () { /* transient poll failure — try again next tick */ });
  }
})();
</script>
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
          "cache-control": "no-store",
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
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(renderHtml(getState()));
      },
    },
    {
      method: "GET",
      path: "/index.html",
      handler: async (_req, res) => {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
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
