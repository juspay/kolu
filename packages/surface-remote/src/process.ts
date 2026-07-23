/** One-shot fire-and-collect subprocess helpers that OWN their child's
 *  lifetime. Two semantics worth centralising:
 *
 *  1. Drain-before-settle. Use `"close"` (not `"exit"`) so the last stdio
 *     chunk is guaranteed to drain before the promise settles — EXCEPT on a
 *     policy/abort kill, where we settle AT the kill and never depend on a
 *     `close` that may never fire (see below).
 *
 *  2. Lifetime ownership (#1908). Every caller MUST pass a {@link LifetimePolicy}
 *     — an unowned child is unspellable. The field incident: a `nix-store
 *     --realise` ssh child wedged ~10 minutes because nothing killed it when its
 *     remote channel died silently. The nix child forks its OWN ssh grandchild
 *     that inherits the stderr pipe, so killing only the direct child can leave
 *     `close` unfired — the eternal await would just relocate one process deeper.
 *     So we spawn DETACHED (the child gets its own process group) and, on policy
 *     expiry or a user abort, kill the whole GROUP (`-pid`, `SIGTERM` → grace →
 *     `SIGKILL`) and settle the promise at THAT moment, never waiting for the
 *     child's own `close`.
 *
 *  Why hand-rolled and not a library (`execa`, `tree-kill`): none delivers this exact
 *  shape. Node's own `spawn({ signal, timeout, killSignal })` and `execa` kill only the
 *  DIRECT child — they leave the ssh grandchild (the relocated wedge) alive. `tree-kill`
 *  DOES reach descendants, but by shelling out to `ps`/`pgrep` and matching a process
 *  TREE — a pattern-match kill this lane's law forbids (exact recorded PIDs only, no
 *  pattern kills). A detached process GROUP + `process.kill(-pid)` is the exact, no-`ps`
 *  primitive that reaps the grandchild; and the settle-AT-expiry, the distinct
 *  `lifetime-expired`/`aborted` arms, and the progress-liveness policy are ours regardless
 *  of who spawns. So the ~90 lines below are irreducible, not an un-surveyed hand-roll.
 *
 *  Out of scope: the long-lived bidirectional agent spawn in `sshConnector.ts`
 *  — that subprocess outlives a single round-trip and is owned by `makeSession`
 *  (teardown + watchdogs). It is a distinct activity, not a user of these
 *  helpers.
 *
 *  New fire-and-collect callers should reach for `runCapture`/`runProgress`
 *  rather than open-coding a fresh `spawn` dance. */

import { spawn } from "node:child_process";
import { forEachLine } from "./host";

/** The lifetime policy every fire-and-collect spawn MUST carry (#1908 D1b) — a
 *  CLOSED union that carves a real joint (the gate PROVED it; do not collapse it):
 *
 *   - `deadline`          — a HARD seconds-scale bound for a genuinely quick child
 *                           (an arch probe, the warm `check-validity`, the pin).
 *                           Killed unconditionally `ms` after spawn.
 *   - `progress-liveness` — UNBOUNDED-but-ALIVE for a child that legitimately runs
 *                           for minutes (the `nix copy` transfer, the `nix build`
 *                           realise): killed only if it produces NO output
 *                           (stdout OR stderr) for `silenceMs`. A responsive-but-slow
 *                           build keeps its output flowing and is never capped; only a
 *                           genuinely silent (wedged) child trips it. The CALLER owns
 *                           the doubling / kill-budget across retries (R4) — this seam
 *                           enforces exactly the one `silenceMs` it is handed. */
export type LifetimePolicy =
  | { kind: "deadline"; ms: number }
  | { kind: "progress-liveness"; silenceMs: number };

/** How a fire-and-collect child settled — a CLOSED union over the ways a run ends,
 *  so each cause has ONE honest shape (no magic exit-code sentinel, no both-null
 *  overload):
 *
 *   - `exit`             — the child ran and exited with a numeric `code` (`ok` iff 0).
 *   - `signal`           — the OS killed the child (`close` with `code === null` + a
 *                           `signal`), NOT by us: an external kill / OOM `SIGKILL`.
 *                           Stays terminal-classified — its meaning is unchanged.
 *   - `spawn-error`      — the child never started (`error` event: bad exe, EACCES).
 *   - `lifetime-expired` — OUR {@link LifetimePolicy} killed it (deadline hit, or
 *                           progress-silence past the bound). Its OWN arm — never
 *                           `signal` — so `nixCopy`'s `causeFor` can classify it
 *                           RETRYABLE without misreading an external OOM kill as ours
 *                           (or permanently failing a host after five liveness kills).
 *                           Carries the `policy` that fired and the `signal` we sent.
 *   - `aborted`          — a USER verb (recheck's abort-in-flight, #1908 R6b) killed
 *                           it. Its own arm so it never narrates as a policy expiry and
 *                           NEVER counts toward the give-up / kill budgets (C3).
 *
 *  `ok` is the success gate; the other fields carry the honest WHY (see
 *  {@link describeExit}). */
export type ExitResult =
  | { ok: boolean; kind: "exit"; code: number }
  | { ok: false; kind: "signal"; signal: NodeJS.Signals }
  | { ok: false; kind: "spawn-error"; message: string }
  | {
      ok: false;
      kind: "lifetime-expired";
      policy: LifetimePolicy;
      signal: NodeJS.Signals;
    }
  | { ok: false; kind: "aborted" };

/** An {@link ExitResult} that also buffered stdout (from `runCapture`). */
export type CaptureResult = ExitResult & { stdout: string };

/** Shared options for both helpers: an optional progress sink for stderr lines, the
 *  REQUIRED lifetime policy, and an optional user-abort signal (recheck's
 *  abort-in-flight, #1908 R6b). */
export interface RunOptions {
  onProgress?: (line: string) => void;
  /** REQUIRED — a caller cannot spawn without deciding who kills a stuck child. */
  policy: LifetimePolicy;
  /** Aborting this settles the run as `{ kind: "aborted" }` and group-kills the child
   *  (and its ssh grandchild). Threaded from the connector's per-dial abort. */
  signal?: AbortSignal;
}

/** `runProgress` additionally merges `env` onto the parent environment — the `nix
 *  copy` caller injects `NIX_SSHOPTS` so the ssh it forks inherits the keepalive. */
export interface RunProgressOptions extends RunOptions {
  env?: Readonly<Record<string, string>>;
}

/** How long a group waits after `SIGTERM` before we escalate to `SIGKILL` — a child
 *  that IGNORES `SIGTERM` (or whose ssh grandchild does) is still reaped. */
const TERM_GRACE_MS = 2000;

/** A human-readable tail describing how a run ended — honest across every
 *  {@link ExitResult} arm (never "code null" for a signal/spawn/policy/abort case). */
export function describeExit(res: ExitResult): string {
  switch (res.kind) {
    case "exit":
      return `exited with code ${res.code}`;
    case "signal":
      return `killed by signal ${res.signal}`;
    case "spawn-error":
      return `failed to spawn: ${res.message}`;
    case "lifetime-expired":
      return res.policy.kind === "deadline"
        ? `lifetime deadline (${res.policy.ms}ms) expired — killed by ${res.signal}`
        : `no output for ${res.policy.silenceMs}ms — killed by ${res.signal}`;
    case "aborted":
      return "aborted by the caller";
  }
}

/** Map a `close` event's `(code, signal)` onto the honest {@link ExitResult} arm.
 *  Node guarantees EXACTLY ONE of the pair is non-null on `close`: a non-null
 *  `signal` means the OS killed the child (no exit code), otherwise it exited with
 *  `code`. Shared by both helpers so the demux lives in one place. NB a policy/abort
 *  kill settles BEFORE this runs (the `settled` guard makes the later `close` inert),
 *  so a `signal` here is always an EXTERNAL kill, honestly `kind: "signal"`. */
function exitFromClose(
  code: number | null,
  signal: NodeJS.Signals | null,
): ExitResult {
  return signal !== null
    ? { ok: false, kind: "signal", signal }
    : { ok: code === 0, kind: "exit", code: code as number };
}

interface LifetimeSpawn {
  cmd: string;
  args: readonly string[];
  /** `true` → pipe + buffer stdout (`runCapture`); `false` → ignore it (`runProgress`). */
  captureStdout: boolean;
  env?: Readonly<Record<string, string>>;
  onProgress: (line: string) => void;
  policy: LifetimePolicy;
  signal?: AbortSignal;
}

/** Spawn a child that OWNS its lifetime: forward stderr lines to `onProgress`,
 *  (optionally) buffer stdout, and enforce `policy` — killing the whole process
 *  group and settling at the kill on expiry/abort, never on a post-kill `close`.
 *  Both public helpers wrap this; they differ only in stdio + return shape. */
function runWithLifetime(
  o: LifetimeSpawn,
): Promise<{ result: ExitResult; stdout: string }> {
  return new Promise((resolve) => {
    // Already aborted before we spawn ⇒ never start the (side-effecting: `nix copy`,
    // realise, pin) child at all — a post-spawn kill can't prevent work a forked child
    // races to begin. Settle `aborted` up front. (#1908 codex-debate F2.)
    if (o.signal?.aborted) {
      resolve({ result: { ok: false, kind: "aborted" }, stdout: "" });
      return;
    }

    const proc = spawn(o.cmd, [...o.args], {
      // DETACHED so the child leads its OWN process group — a policy/abort kill then
      // targets the whole group (`-pid`), reaping the ssh grandchild that inherited
      // the stderr pipe. Without this, `process.kill(-pid)` would hit the PARENT's
      // group. (#1908 R2.)
      detached: true,
      // Always PIPE stdout: `runCapture` buffers it, `runProgress` drains it only to
      // bump progress-liveness — so the policy's "resets on ANY output" contract holds
      // for both helpers, and a stdout-only child is never killed as silent (F11).
      stdio: ["ignore", "pipe", "pipe"],
      env: o.env ? { ...process.env, ...o.env } : undefined,
    });

    let stdout = "";
    let settled = false;
    let policyTimer: ReturnType<typeof setTimeout> | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const clearPolicyTimer = (): void => {
      if (policyTimer !== null) {
        clearTimeout(policyTimer);
        policyTimer = null;
      }
    };

    const settle = (result: ExitResult): void => {
      if (settled) return;
      settled = true;
      clearPolicyTimer();
      o.signal?.removeEventListener("abort", onAbort);
      // Pair the arm with the buffered stdout — `runCapture` keeps it, `runProgress`
      // drops it (so its declared `ExitResult` carries no stray `stdout` field).
      resolve({ result, stdout });
    };

    // Is the child's process GROUP still alive? A signal-0 probe: `process.kill(-pid, 0)`
    // succeeds (does nothing) while any member survives, throws `ESRCH` once the group is
    // empty. Used to decide whether the SIGKILL escalation is still needed after the
    // leader's `close` (F1).
    const groupAlive = (pid: number): boolean => {
      try {
        process.kill(-pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    // Kill the whole group: SIGTERM now, escalate to SIGKILL after a grace so a member
    // that IGNORES SIGTERM is still reaped (C8/F1). The escalation is REF'D and fires
    // independently of `settle` (which already fired) — it must reach a TERM-ignoring ssh
    // grandchild, which a caller with no other handles would otherwise outrun. It is
    // cleared only when the whole GROUP is provably gone (see `close`), never on the
    // leader's exit alone (the leader closing proves nothing about a surviving grandchild).
    const killGroup = (): void => {
      const pid = proc.pid;
      if (pid === undefined) return;
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        /* group already gone — nothing to escalate */
        return;
      }
      killTimer = setTimeout(() => {
        killTimer = null;
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* group exited during the grace — done */
        }
      }, TERM_GRACE_MS);
    };

    function onAbort(): void {
      // A USER verb (recheck abort-in-flight): its own settle arm, exempt from every
      // budget (C3), and a group-kill of the in-flight children + ssh grandchild.
      killGroup();
      settle({ ok: false, kind: "aborted" });
    }

    const armPolicyTimer = (): void => {
      const ms =
        o.policy.kind === "deadline" ? o.policy.ms : o.policy.silenceMs;
      policyTimer = setTimeout(() => {
        // Lifetime expired: group-kill and settle NOW — never wait for `close` (which
        // may never fire while the ssh grandchild holds the pipe). Best-effort drain:
        // whatever stderr already arrived was forwarded; `stdout` is what we have.
        killGroup();
        settle({
          ok: false,
          kind: "lifetime-expired",
          policy: o.policy,
          signal: "SIGTERM",
        });
      }, ms);
    };

    // progress-liveness resets on ANY child output (stdout OR stderr) — `runCapture`'s
    // stdout never becomes a progress line, so a stderr-only reset would starve a
    // stdout-only step (C1/R4d). A `deadline` policy is fixed and never bumped.
    const bumpLiveness = (): void => {
      if (settled || o.policy.kind !== "progress-liveness") return;
      clearPolicyTimer();
      armPolicyTimer();
    };

    armPolicyTimer();

    proc.stdout?.setEncoding("utf-8");
    proc.stdout?.on("data", (chunk: string) => {
      if (o.captureStdout) stdout += chunk;
      bumpLiveness();
    });
    proc.stderr?.setEncoding("utf-8");
    proc.stderr?.on("data", (chunk: string) => {
      forEachLine(chunk, o.onProgress);
      bumpLiveness();
    });

    // The child (the group LEADER) exited. Settle from its `close`, but clear the SIGKILL
    // escalation ONLY if the whole GROUP is gone — a grandchild that ignored SIGTERM and
    // closed the inherited pipe can still be alive, and the escalation is the one thing
    // that reaps it (F1). If the group survives, leave the escalation to fire.
    proc.on("close", (code, signal) => {
      const pid = proc.pid;
      if (killTimer !== null && (pid === undefined || !groupAlive(pid))) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      settle(exitFromClose(code, signal));
    });
    proc.on("error", (err) => {
      o.onProgress(`${o.cmd}: ${err.message}`);
      settle({ ok: false, kind: "spawn-error", message: err.message });
    });

    // Wire the abort for aborts that occur AFTER launch — the already-aborted case
    // returned before `spawn` (no synchronous re-check needed: nothing between that guard
    // and here yields, so the signal can't have flipped). An abort group-kills the child
    // and settles `aborted`.
    o.signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Run a child with stdout ignored; forward stderr lines to `onProgress`. Used for
 *  `nix copy` where the only output the parent cares about is progress chatter on
 *  stderr. The lifetime `policy` is REQUIRED (see {@link LifetimePolicy}). */
export function runProgress(
  cmd: string,
  args: readonly string[],
  opts: RunProgressOptions,
): Promise<ExitResult> {
  return runWithLifetime({
    cmd,
    args,
    captureStdout: false,
    env: opts.env,
    onProgress: opts.onProgress ?? (() => {}),
    policy: opts.policy,
    signal: opts.signal,
  }).then(({ result }) => result);
}

/** Run a child and buffer its stdout; forward stderr lines to `onProgress`. Used for
 *  `nix build --print-out-paths` (output path on stdout), the GC-root pin
 *  (`nix-store --realise … --add-root`), and `nix-instantiate --eval` (system
 *  identifier on stdout). The lifetime `policy` is REQUIRED. */
export function runCapture(
  cmd: string,
  args: readonly string[],
  opts: RunOptions,
): Promise<CaptureResult> {
  return runWithLifetime({
    cmd,
    args,
    captureStdout: true,
    onProgress: opts.onProgress ?? (() => {}),
    policy: opts.policy,
    signal: opts.signal,
  }).then(({ result, stdout }) => ({ ...result, stdout }));
}
