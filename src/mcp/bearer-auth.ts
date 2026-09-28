/**
 * Bearer-token `authenticate` callback shared by the single-account server
 * (mcp.ts) and the gateway (gateway/server.ts) — both gate their public
 * FastMCP httpStream endpoint the same way.
 */

import type { IncomingMessage } from "node:http";
import type { Logger } from "pino";

export function createBearerAuthenticate(
  token: string | undefined,
  logger: Logger,
  unsetTokenWarning: string,
) {
  if (!token) logger.warn(unsetTokenWarning);

  return async (request: IncomingMessage | undefined): Promise<Record<string, never>> => {
    // stdio transport passes undefined — trust local invocation.
    if (!request) return {};
    if (!token) return {};

    const header = request.headers.authorization;
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw?.startsWith("Bearer ") || raw.slice(7) !== token) {
      throw new Response(null, { status: 401, statusText: "Invalid or missing token" });
    }
    return {};
  };
}
