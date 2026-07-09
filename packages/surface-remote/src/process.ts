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

/** How a fire-and-collect child settled — a CLOSED union over the three ways
 *  `node:child_process` ends a run, so "killed by a signal" and "never spawned"
 *  stop sharing the one `code: null` inhabitant the old flat `{ code: number |
 *  null }` gave them (Node hands `close` a `signal` alongside a null `code`; the
 *  old shape dropped it, collapsing an OOM `SIGKILL` onto a spawn failure):
 *
 *   - `exit`        — the child ran and exited with a numeric `code` (`ok` iff 0).
 *   - `signal`      — the OS killed the child (`close` fired with `code === null`
 *                     + a `signal`); there is no exit code.
 *   - `spawn-error` — the child never started (`error` event: bad exe, EACCES);
 *                     neither code nor signal exists, only a `message`.
 *
 *  `ok` is the success gate every caller reads; the `kind`/`code`/`signal`/
 *  `message` carry the honest WHY (see {@link describeExit}). */
export type ExitResult =
  | { ok: boolean; kind: "exit"; code: number }
  | { ok: false; kind: "signal"; signal: NodeJS.Signals }
  | { ok: false; kind: "spawn-error"; message: string };

/** An {@link ExitResult} that also buffered stdout (from `runCapture`). */
export type CaptureResult = ExitResult & { stdout: string };

/** A human-readable tail describing how a run ended — honest across all three
 *  {@link ExitResult} arms (never "code null" for a signal kill or a spawn
 *  failure, the cosmetic lie the old flat `code: number | null` forced). */
export function describeExit(res: ExitResult): string {
  switch (res.kind) {
    case "exit":
      return `exited with code ${res.code}`;
    case "signal":
      return `killed by signal ${res.signal}`;
    case "spawn-error":
      return `failed to spawn: ${res.message}`;
  }
}

/** Map a `close` event's `(code, signal)` onto the honest {@link ExitResult}
 *  arm. Node guarantees EXACTLY ONE of the pair is non-null on `close`: a
 *  non-null `signal` means the OS killed the child (no exit code), otherwise the
 *  child exited with `code`. Shared by both `runProgress` and `runCapture` so the
 *  code/signal demux lives in one place. */
function exitFromClose(
  code: number | null,
  signal: NodeJS.Signals | null,
): ExitResult {
  return signal !== null
    ? { ok: false, kind: "signal", signal }
    : // Node guarantees a non-null `code` here (no signal killed the child).
      { ok: code === 0, kind: "exit", code: code as number };
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
      env: env ? { ...process.env, ...env } : undefined,
    });
    proc.stderr?.setEncoding("utf-8");
    proc.stderr?.on("data", (chunk: string) => forEachLine(chunk, onProgress));
    // Use "close" (not "exit") so the last stderr chunk is guaranteed
    // flushed before we resolve — "exit" fires before stdio streams drain.
    proc.on("close", (code, signal) => resolve(exitFromClose(code, signal)));
    proc.on("error", (err) => {
      onProgress(`${cmd}: ${err.message}`);
      resolve({ ok: false, kind: "spawn-error", message: err.message });
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
    proc.on("close", (code, signal) =>
      resolve({ ...exitFromClose(code, signal), stdout }),
    );
    proc.on("error", (err) => {
      onProgress(`${cmd}: ${err.message}`);
      resolve({
        ok: false,
        kind: "spawn-error",
        message: err.message,
        stdout: "",
      });
    });
  });
}
