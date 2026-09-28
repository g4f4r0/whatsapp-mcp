import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountConfig } from "../gateway/accounts.ts";
import { spawnChild } from "../gateway/children.ts";

describe("gateway/children", () => {
  let appDir: string;
  let dataRoot: string;
  const account: AccountConfig = {
    name: "business",
    expectedWaNumber: "5511999999999",
    mcpPort: 39001,
    qrPort: 39002,
    streamPort: 39004,
  };

  beforeEach(async () => {
    appDir = await mkdtemp(path.join(tmpdir(), "wa-children-app-"));
    dataRoot = await mkdtemp(path.join(tmpdir(), "wa-children-data-"));
    await mkdir(path.join(appDir, "src"), { recursive: true });
    // Stand-in for src/main.ts (spawnChild always runs "src/main.ts" under appDir):
    // prints the env it cares about and exits.
    await writeFile(
      path.join(appDir, "src", "main.ts"),
      [
        "process.stdout.write(JSON.stringify({",
        "  dataDir: process.env.WHATSAPP_MCP_DATA_DIR,",
        "  expectedWaNumber: process.env.EXPECTED_WA_NUMBER,",
        "  mcpPort: process.env.MCP_PORT,",
        "  authToken: process.env.MCP_AUTH_TOKEN,",
        "  coldOverride: process.env.SEND_COLD_OVERRIDE,",
        "  rateLimit: process.env.SEND_RATE_LIMIT_PER_HOUR,",
        '}) + "\\n");',
        "process.exit(0);",
      ].join("\n"),
    );
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
    await rm(dataRoot, { recursive: true, force: true });
    vi.useRealTimers();
  });

  function daemonLogPath(): string {
    return path.join(dataRoot, "business", "daemon.log");
  }

  function readDaemonLog(): Promise<string> {
    return readFile(daemonLogPath(), "utf8");
  }

  function spawn(internalToken: string, restartDelayMs: number) {
    return spawnChild(account, {
      appDir,
      dataRoot,
      internalToken,
      logger: pino({ level: "silent" }),
      restartDelayMs,
    });
  }

  it("spawns the child with the account's env and the internal token, not the real one", async () => {
    // Long delay: the test's single exit must not respawn mid-assertion.
    const handle = spawn("internal-secret", 60_000);

    await vi.waitFor(async () => expect(await readDaemonLog()).toContain("exited"));
    handle.stop();

    const jsonLine = (await readDaemonLog()).split("\n").find((l) => l.startsWith("{"));
    expect(jsonLine).toBeDefined();
    expect(JSON.parse(jsonLine!)).toEqual({
      dataDir: path.join(dataRoot, "business"),
      expectedWaNumber: "5511999999999",
      mcpPort: "39001",
      authToken: "internal-secret",
      coldOverride: "deny",
      rateLimit: "20",
    });
  });

  it("respawns after the child exits, within restartDelayMs", async () => {
    const handle = spawn("t", 50);

    await vi.waitFor(
      async () => {
        const starts = (await readDaemonLog())
          .split("\n")
          .filter((l) => l.includes("starting child")).length;
        expect(starts).toBeGreaterThanOrEqual(2);
      },
      { timeout: 5000 },
    );
    handle.stop();
  });

  it("stop() prevents further respawns", async () => {
    const handle = spawn("t", 50);

    await vi.waitFor(async () => expect(await readDaemonLog()).toContain("exited"));
    handle.stop();

    const before = (await readDaemonLog()).length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect((await readDaemonLog()).length).toBe(before);
  });
});
