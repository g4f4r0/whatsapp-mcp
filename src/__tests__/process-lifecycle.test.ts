import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installLifecycle } from "../process-lifecycle.ts";

function silentLogger() {
  const logger = pino({ level: "silent" });
  return Object.assign(logger, { flush: vi.fn() });
}

describe("installLifecycle", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
  });

  it("exits 1 and flushes logs when main() rejects", async () => {
    const waLogger = silentLogger();
    const mcpLogger = silentLogger();

    installLifecycle({
      waLogger,
      mcpLogger,
      onShutdown: vi.fn(),
      main: Promise.reject(new Error("boom")),
      label: "test",
    });

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(1));
    expect(waLogger.flush).toHaveBeenCalled();
    expect(mcpLogger.flush).toHaveBeenCalled();
  });

  it("runs onShutdown and exits 0 on SIGTERM", async () => {
    const waLogger = silentLogger();
    const mcpLogger = silentLogger();
    const onShutdown = vi.fn().mockResolvedValue(undefined);

    installLifecycle({
      waLogger,
      mcpLogger,
      onShutdown,
      main: new Promise(() => {}), // never resolves — the process is "running"
      label: "test",
    });

    process.emit("SIGTERM");

    await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
    expect(onShutdown).toHaveBeenCalledWith("SIGTERM");
    expect(waLogger.flush).toHaveBeenCalled();
  });
});
