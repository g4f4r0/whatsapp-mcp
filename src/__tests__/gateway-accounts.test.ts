import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAccounts } from "../gateway/accounts.ts";

describe("gateway/accounts", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "wa-accounts-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns [] when the accounts dir does not exist", () => {
    expect(loadAccounts(path.join(dir, "missing"))).toEqual([]);
  });

  it("parses one account file into an AccountConfig", async () => {
    await writeFile(
      path.join(dir, "business.env"),
      "# comment\nEXPECTED_WA_NUMBER=5511999999999\nMCP_PORT=39001\nQR_SERVER_PORT=39002\nSTREAM_SERVER_PORT=39004\n",
    );

    expect(loadAccounts(dir)).toEqual([
      {
        name: "business",
        expectedWaNumber: "5511999999999",
        mcpPort: 39001,
        qrPort: 39002,
        streamPort: 39004,
      },
    ]);
  });

  it("reads multiple accounts, sorted by name", async () => {
    await writeFile(
      path.join(dir, "personal.env"),
      "EXPECTED_WA_NUMBER=5511000000000\nMCP_PORT=39011\nQR_SERVER_PORT=39012\nSTREAM_SERVER_PORT=39014\n",
    );
    await writeFile(
      path.join(dir, "business.env"),
      "EXPECTED_WA_NUMBER=5511999999999\nMCP_PORT=39001\nQR_SERVER_PORT=39002\nSTREAM_SERVER_PORT=39004\n",
    );

    expect(loadAccounts(dir).map((a) => a.name)).toEqual(["business", "personal"]);
  });

  it("ignores non-.env files in the accounts dir", async () => {
    await writeFile(path.join(dir, "README.md"), "not an account");
    await writeFile(
      path.join(dir, "business.env"),
      "EXPECTED_WA_NUMBER=5511999999999\nMCP_PORT=39001\nQR_SERVER_PORT=39002\nSTREAM_SERVER_PORT=39004\n",
    );

    expect(loadAccounts(dir).map((a) => a.name)).toEqual(["business"]);
  });

  it("throws on a config missing a required field", async () => {
    await writeFile(
      path.join(dir, "broken.env"),
      "EXPECTED_WA_NUMBER=5511999999999\nMCP_PORT=39001\n",
    );
    expect(() => loadAccounts(dir)).toThrow(/invalid account config/);
  });

  it("throws on a non-numeric port", async () => {
    await writeFile(
      path.join(dir, "broken.env"),
      "EXPECTED_WA_NUMBER=5511999999999\nMCP_PORT=abc\nQR_SERVER_PORT=39002\nSTREAM_SERVER_PORT=39004\n",
    );
    expect(() => loadAccounts(dir)).toThrow(/invalid account config/);
  });
});
