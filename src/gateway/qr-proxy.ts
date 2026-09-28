/**
 * Serves every account's pairing page under one port: `/qr/<account>` proxies
 * to that account's own QR server (src/qr-server.ts, unchanged, bound to
 * 127.0.0.1). Plain byte-for-byte reverse proxy — the QR page itself already
 * renders the minimal "just the QR, then a plain success card" UI.
 */

import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Logger } from "pino";

export interface QrProxyOptions {
  /** account name -> internal QR server port */
  accountPorts: Map<string, number>;
  logger: Logger;
}

function notFound(res: ServerResponse, message: string): void {
  res.writeHead(404, { "content-type": "text/plain" });
  res.end(message);
}

export function createQrProxy(opts: QrProxyOptions): Server {
  return http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const match = /^\/qr\/([a-z0-9]+)(\/.*)?$/.exec(url);
    if (!match) {
      notFound(res, "expected /qr/<account>");
      return;
    }
    const [, account, rest] = match;
    const port = opts.accountPorts.get(account);
    if (!port) {
      notFound(res, `unknown account "${account}"`);
      return;
    }

    const upstreamPath = rest && rest !== "/" ? rest : "/";
    const upstream = http.request(
      { host: "127.0.0.1", port, method: req.method, path: upstreamPath, headers: req.headers },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", (err) => {
      opts.logger.warn({ err, account }, "qr-proxy: upstream request failed");
      if (!res.headersSent) {
        res.writeHead(502, { "content-type": "text/plain" });
      }
      res.end("account's QR server is not reachable — it may still be starting");
    });
    req.pipe(upstream);
  });
}
