/**
 * Shared "spawn a binary, collect its output, resolve on exit" wiring — both
 * transcribe/preprocess.ts (ffmpeg) and transcribe/whisper.ts (bb voice
 * transcribe) need spawn + stderr capture + exit-code handling and previously
 * hand-rolled the same Promise/event-listener boilerplate independently.
 */

import { spawn } from "node:child_process";

export interface ProcessResult {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
}

/** A spawn failure that isn't a process exit — e.g. ENOENT for a missing binary. */
export class ProcessSpawnError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = "ProcessSpawnError";
    this.code = code;
  }
}

/** Runs `bin args...`, collecting stdout/stderr fully into memory. */
export function runProcess(
  bin: string,
  args: string[],
  opts: { captureStdout?: boolean } = {},
): Promise<ProcessResult> {
  const captureStdout = opts.captureStdout ?? true;
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    proc.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    proc.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    proc.on("error", (err: NodeJS.ErrnoException) => {
      reject(new ProcessSpawnError(err.message, err.code));
    });
    proc.on("close", (code) => {
      resolve({
        code,
        stdout: Buffer.concat(stdoutChunks),
        stderr: Buffer.concat(stderrChunks),
      });
    });
  });
}
