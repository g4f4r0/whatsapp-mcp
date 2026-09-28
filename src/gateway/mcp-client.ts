/**
 * One client per account, talking to that account's child over its own
 * loopback local-rpc endpoint (src/mcp/local-rpc.ts — not real MCP protocol,
 * see that module's docblock for why). Plain `fetch`, no session or
 * reconnect state to hold: local-rpc is stateless request/response, so
 * there's nothing to "reconnect" the way a stateful MCP session would need.
 */

export interface CallToolResult {
  content: Array<Record<string, unknown>>;
  isError?: boolean;
}

export interface AccountClientOptions {
  mcpPort: number;
  internalToken: string;
}

export class AccountClient {
  private readonly opts: AccountClientOptions;

  // Not a parameter-property shorthand: Node's --experimental-strip-types
  // (strip-only mode, no real TS transform) does not support that syntax —
  // see src/__tests__/strip-types.contract.test.ts.
  constructor(opts: AccountClientOptions) {
    this.opts = opts;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const res = await fetch(
      `http://127.0.0.1:${this.opts.mcpPort}/tool/${encodeURIComponent(name)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.opts.internalToken}`,
        },
        body: JSON.stringify(args),
      },
    );
    const body = (await res.json()) as CallToolResult;
    if (!res.ok && !body.isError) {
      return { isError: true, content: [{ type: "text", text: `HTTP ${res.status}` }] };
    }
    return body;
  }
}
