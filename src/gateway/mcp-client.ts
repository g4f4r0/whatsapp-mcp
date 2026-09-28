/**
 * One MCP client per account, talking to that account's child over its own
 * loopback MCP endpoint (started by src/main.ts, unchanged). Connects lazily on
 * first call and reconnects on the next call after a failure — a child that's
 * mid-restart just makes the next tool call retry the connection.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface AccountClientOptions {
  mcpPort: number;
  internalToken: string;
}

export class AccountClient {
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;
  private readonly opts: AccountClientOptions;

  // Not a parameter-property shorthand: Node's --experimental-strip-types
  // (strip-only mode, no real TS transform) does not support that syntax —
  // see src/__tests__/strip-types.contract.test.ts.
  constructor(opts: AccountClientOptions) {
    this.opts = opts;
  }

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;

    this.connecting = (async () => {
      const client = new Client({ name: "whatsapp-gateway", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${this.opts.mcpPort}/mcp`),
        { requestInit: { headers: { Authorization: `Bearer ${this.opts.internalToken}` } } },
      );
      await client.connect(transport);
      this.client = client;
      return client;
    })();

    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    try {
      const client = await this.connect();
      return (await client.callTool({ name, arguments: args })) as CallToolResult;
    } catch (err) {
      // Drop the (possibly dead) connection so the next call reconnects fresh —
      // the account's child restarts on its own within ~15s after a crash.
      this.client = null;
      throw err;
    }
  }
}
