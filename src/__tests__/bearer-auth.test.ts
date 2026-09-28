import type { IncomingMessage } from "node:http";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { createBearerAuthenticate } from "../mcp/bearer-auth.ts";

function fakeRequest(authorization?: string): IncomingMessage {
  return { headers: { authorization } } as IncomingMessage;
}

describe("createBearerAuthenticate", () => {
  it("warns immediately when no token is configured", () => {
    const logger = pino({ level: "silent" });
    const warn = vi.spyOn(logger, "warn");
    createBearerAuthenticate(undefined, logger, "no token set");
    expect(warn).toHaveBeenCalledWith("no token set");
  });

  it("trusts a request with no token configured, without checking headers", async () => {
    const authenticate = createBearerAuthenticate(undefined, pino({ level: "silent" }), "warn");
    await expect(authenticate(fakeRequest())).resolves.toEqual({});
  });

  it("trusts stdio transport (undefined request) even with a token configured", async () => {
    const authenticate = createBearerAuthenticate("secret", pino({ level: "silent" }), "warn");
    await expect(authenticate(undefined)).resolves.toEqual({});
  });

  it("accepts a matching Bearer token", async () => {
    const authenticate = createBearerAuthenticate("secret", pino({ level: "silent" }), "warn");
    await expect(authenticate(fakeRequest("Bearer secret"))).resolves.toEqual({});
  });

  it("rejects a missing Authorization header", async () => {
    const authenticate = createBearerAuthenticate("secret", pino({ level: "silent" }), "warn");
    await expect(authenticate(fakeRequest())).rejects.toBeInstanceOf(Response);
  });

  it("rejects a non-Bearer scheme", async () => {
    const authenticate = createBearerAuthenticate("secret", pino({ level: "silent" }), "warn");
    await expect(authenticate(fakeRequest("Basic secret"))).rejects.toBeInstanceOf(Response);
  });

  it("rejects a wrong token", async () => {
    const authenticate = createBearerAuthenticate("secret", pino({ level: "silent" }), "warn");
    await expect(authenticate(fakeRequest("Bearer wrong"))).rejects.toBeInstanceOf(Response);
  });
});
