import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CollectingRegistrar } from "../mcp/collecting-registrar.ts";

describe("mcp/CollectingRegistrar", () => {
  it("stores a tool by name without instantiating anything else", () => {
    const registrar = new CollectingRegistrar();
    const execute = async () => "ok";
    registrar.addTool({ name: "ping", parameters: z.object({}), execute });

    expect(registrar.tools.size).toBe(1);
    expect(registrar.tools.get("ping")).toMatchObject({ name: "ping", execute });
  });

  it("keeps every tool addTool is called with, by name", () => {
    const registrar = new CollectingRegistrar();
    registrar.addTool({ name: "a", parameters: z.object({}), execute: async () => "a" });
    registrar.addTool({ name: "b", parameters: z.object({}), execute: async () => "b" });

    expect([...registrar.tools.keys()].sort()).toEqual(["a", "b"]);
  });

  it("a later addTool with the same name replaces the earlier one", () => {
    const registrar = new CollectingRegistrar();
    registrar.addTool({ name: "x", parameters: z.object({}), execute: async () => "first" });
    registrar.addTool({ name: "x", parameters: z.object({}), execute: async () => "second" });

    expect(registrar.tools.size).toBe(1);
  });
});
