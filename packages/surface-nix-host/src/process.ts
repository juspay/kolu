/** Subprocess helpers shared by `provisionAgent` (which runs `nix copy`
 *  / `nix-store --realise`) and `resolveSystem` (which runs `uname -ms`
 *  locally or over ssh). Extracted from `nixCopy.ts` so both consumers
 *  inherit the same close-event-flush semantics — using `"close"`
 *  rather than `"exit"` so the last stdio chunk is guaranteed to drain
 *  before the promise settles.
 *
 *  This module is the only place in the package that calls
 *  `child_process.spawn`. Adding a new subprocess use-case should reuse
 *  one of these helpers, not hand-roll a fourth event-wiring dance. */

import { spawn } from "node:child_process";
import { forEachLine } from "./host";

export interface ExitResult {
  ok: boolean;
  code: number | null;
}

export interface CaptureResult extends ExitResult {
  stdout: string;
}

/** Run a child process with stdout ignored; forward stderr lines to
 *  `onProgress`. Used for `nix copy` where the only output the parent
 *  cares about is progress chatter on stderr. */
export function runProgress(
  cmd: string,
  args: readonly string[],
  onProgress: (line: string) => void,
): Promise<ExitResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, [...args], { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr?.setEncoding("utf-8");
    proc.stderr?.on("data", (chunk: string) => forEachLine(chunk, onProgress));
    // Use "close" (not "exit") so the last stderr chunk is guaranteed
    // flushed before we resolve — "exit" fires before stdio streams drain.
    proc.on("close", (code) => resolve({ ok: code === 0, code }));
    proc.on("error", (err) => {
      onProgress(`${cmd}: ${err.message}`);
      resolve({ ok: false, code: null });
    });
  });
}

/** Run a child process and buffer its stdout; forward stderr lines to
 *  `onProgress`. Used for `nix-store --realise` (output path on stdout)
 *  and `uname -ms` (system identifier on stdout). */
export function runCapture(
  cmd: string,
  args: readonly string[],
  onProgress: (line: string) => void,
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, [...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    proc.stdout?.setEncoding("utf-8");
    proc.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    proc.stderr?.setEncoding("utf-8");
    proc.stderr?.on("data", (chunk: string) => forEachLine(chunk, onProgress));
    // Use "close" (not "exit") so stdout/stderr are fully drained first.
    proc.on("close", (code) => resolve({ ok: code === 0, code, stdout }));
    proc.on("error", (err) => {
      onProgress(`${cmd}: ${err.message}`);
      resolve({ ok: false, code: null, stdout: "" });
    });
  });
}
