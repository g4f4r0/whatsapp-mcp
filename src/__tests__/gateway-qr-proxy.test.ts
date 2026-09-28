import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createQrProxy } from "../gateway/qr-proxy.ts";

function listen(server: Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

describe("gateway/qr-proxy", () => {
  let upstream: Server;
  let upstreamPort: number;
  let proxy: Server;
  let proxyPort: number;

  beforeEach(async () => {
    upstream = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/html", "x-upstream-path": req.url ?? "" });
      res.end("<html>upstream body</html>");
    });
    upstreamPort = await listen(upstream);

    proxy = createQrProxy({
      accountPorts: new Map([["business", upstreamPort]]),
      logger: pino({ level: "silent" }),
    });
    proxyPort = await listen(proxy);
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  it("proxies /qr/<account> to that account's root (following the redirect below)", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/qr/business`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-upstream-path")).toBe("/");
    expect(await res.text()).toContain("upstream body");
  });

  it("redirects the bare /qr/<account> (no trailing slash) to /qr/<account>/", async () => {
    // So the page's relative "qr.png" image src resolves under the account
    // prefix instead of the gateway's own root — see qr-server.ts.
    const res = await fetch(`http://127.0.0.1:${proxyPort}/qr/business`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/qr/business/");
  });

  it("does not redirect /qr/<account>/ — it's already proxied straight through", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/qr/business/`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-upstream-path")).toBe("/");
  });

  it("proxies /qr/<account>/qr.png to the account's /qr.png", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/qr/business/qr.png`);
    expect(res.headers.get("x-upstream-path")).toBe("/qr.png");
  });

  it("404s for an unknown account", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/qr/nosuchaccount`);
    expect(res.status).toBe(404);
  });

  it("404s for a path that isn't /qr/<account>", async () => {
    const res = await fetch(`http://127.0.0.1:${proxyPort}/health`);
    expect(res.status).toBe(404);
  });

  it("returns 502 when the account's QR server isn't reachable", async () => {
    const deadProxy = createQrProxy({
      accountPorts: new Map([["ghost", 1]]), // port 1: nothing listens there
      logger: pino({ level: "silent" }),
    });
    const deadPort = await listen(deadProxy);
    try {
      const res = await fetch(`http://127.0.0.1:${deadPort}/qr/ghost`);
      expect(res.status).toBe(502);
    } finally {
      await new Promise<void>((resolve) => deadProxy.close(() => resolve()));
    }
  });
});
