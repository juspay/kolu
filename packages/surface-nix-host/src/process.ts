/** One-shot fire-and-collect subprocess helpers. The semantics worth
 *  centralising: use `"close"` (not `"exit"`) so the last stdio chunk
 *  is guaranteed to drain before the promise settles. Hand-rolling
 *  that against `node:child_process.spawn` and getting the event
 *  selection wrong is the failure mode these helpers exist to prevent.
 *
 *  Out of scope: the long-lived bidirectional spawn in `hostSession.ts`
 *  — that subprocess outlives a single round-trip, retains its
 *  `ChildProcess` handle for SIGTERM teardown, and uses different
 *  stdio + exit-event semantics. It is a distinct activity, not a
 *  fourth user of these helpers.
 *
 *  New fire-and-collect callers should reach for `runCapture`/
 *  `runProgress` rather than open-coding a fresh `spawn` dance. */

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
 *  cares about is progress chatter on stderr. Pass no callback for
 *  silent-stderr behaviour (e.g. probe commands where there's no
 *  progress channel to forward into).
 *
 *  `env`, when given, is *merged onto* the parent environment (not a
 *  replacement) — the `nix copy` caller uses it to inject `NIX_SSHOPTS`
 *  so the ssh that copy forks internally inherits the same dead-peer
 *  keepalive as the ssh we spawn directly. */
export function runProgress(
  cmd: string,
  args: readonly string[],
  onProgress: (line: string) => void = () => {},
  env?: Readonly<Record<string, string>>,
): Promise<ExitResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, [...args], {
      stdio: ["ignore", "ignore", "pipe"],
      ...(env && { env: { ...process.env, ...env } }),
    });
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
 *  and `nix-instantiate --eval` (system identifier on stdout). Pass no
 *  callback for silent-stderr behaviour. */
export function runCapture(
  cmd: string,
  args: readonly string[],
  onProgress: (line: string) => void = () => {},
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
