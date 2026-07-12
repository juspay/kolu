/**
 * The daemon skeleton every surface daemon repeats: **gate → serve → teardown**.
 *
 * `daemonMain` is the mechanism; the *policy* arrives as parameters — the scope
 * key (`gatePath`), where to listen (`socketPath`), what to serve (`router`,
 * any `@kolu/surface` router), and how long to live (`lifetime`). kaval picks
 * `{ kind: "forever" }` — an idle PTY daemon still holds your terminals;
 * `odu serve` will pick `idleTimeout` — a quiet CI coordinator may exit. Same
 * skeleton, opposite policies, which is the evidence the mechanism is real and
 * not one program's internals wearing a package name.
 *
 * It never calls `process.exit`: it returns a `DaemonExit` the bin maps to a
 * code. That keeps the whole lifecycle drivable in-process from a test — the
 * gate-race choreography and the idle-timeout path run under vitest with no
 * real signals and no forked children.
 */

import {
  serveOverUnixSocket,
  type UnixSocketServeOutcome,
} from "@kolu/surface/unix-socket";
import type { Router } from "@orpc/server";
import type { Logger } from "./logger.ts";
import {
  acquirePidGate,
  type GateAcquisition,
  isHolderLive,
} from "./pidGate.ts";

/** How long the daemon stays up once serving. `forever` waits for a signal or
 *  an external abort only; `idleTimeout` additionally shuts down after `ms` of
 *  continuous idleness (the daemon defines "idle" via `isIdle`); `boundToPid`
 *  additionally shuts down cleanly once the watched `pid` is gone — the daemon's
 *  reason to exist is the RUN that spawned it, so it dies with that run rather
 *  than outliving it (the test/smoke leak fix — a daemon detached+unref'd for
 *  survival must still die when its harness is gone). These are three honest
 *  constructors, not `forever` plus flags: a caller picks exactly one. The pid is
 *  watched by a portable `kill(pid, 0)` poll; a pid-reuse in the poll window is a
 *  documented residual, not engineered around (a fresh process inheriting the
 *  same pid would keep the daemon alive one extra run — vanishingly rare, and the
 *  cost is a single leaked run, not a class). */
export type DaemonLifetime =
  | { kind: "forever" }
  | { kind: "idleTimeout"; ms: number; isIdle: () => boolean }
  | { kind: "boundToPid"; pid: number; pollMs?: number };

/** Why `daemonMain` returned, for the bin to turn into an exit code.
 *  `already-running` is a *success* (another live daemon serves this scope —
 *  exit 0); `serve-failed` is the one real error. */
export type DaemonExit =
  | { kind: "already-running"; pid: number }
  | { kind: "shutdown"; reason: "signal" | "abort" | "idle" | "pid-gone" }
  | { kind: "serve-failed"; detail: UnixSocketServeOutcome["kind"] };

/** The env var that binds a spawned daemon to the RUN that spawned it: when set
 *  to a live pid, {@link daemonLifetimeFromEnv} selects the `boundToPid` lifetime
 *  so the daemon dies with that pid; ABSENCE selects the caller's production
 *  `fallback` (there is deliberately no way to *weaken* a production daemon — only
 *  a test harness / smoke script opts a spawned daemon into dying with it). Threaded
 *  harness → server → padi → kaval exactly as `KOLU_KAVAL_SPAWN` flows. */
export const DAEMON_BIND_PID_ENV = "KOLU_DAEMON_BIND_PID";

/** Resolve the lifetime from {@link DAEMON_BIND_PID_ENV}: a live-pid value selects
 *  `boundToPid`; ABSENCE (unset or empty) selects the caller's production `fallback`
 *  (`forever` for kaval/padi). This is the ONE place the "absence = production"
 *  policy lives, so both daemon twins can't drift on it. A malformed value crashes
 *  loudly (fail-fast) rather than silently degrading to the fallback — a set-but-
 *  garbage bind pid is a harness bug, not a reason to leak the daemon it meant to
 *  bind. */
export function daemonLifetimeFromEnv(
  fallback: DaemonLifetime,
): DaemonLifetime {
  const raw = process.env[DAEMON_BIND_PID_ENV];
  if (raw === undefined || raw === "") return fallback;
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(
      `${DAEMON_BIND_PID_ENV} must be a positive integer pid; got ${JSON.stringify(raw)}`,
    );
  }
  return { kind: "boundToPid", pid };
}

/** The process exit code for a `DaemonExit` — the success/failure classification
 *  lives with the type, not re-decided in each bin's ternary. `already-running`
 *  and `shutdown` are success (a second launch yielding to the live daemon must
 *  exit 0, not look like a crash); `serve-failed` is the one real error. A new
 *  `DaemonExit` variant fails this switch's exhaustiveness check, forcing the
 *  classification update here at the type's home. */
export function daemonExitCode(exit: DaemonExit): number {
  switch (exit.kind) {
    case "already-running":
    case "shutdown":
      return 0;
    case "serve-failed":
      return 1;
  }
  // Exhaustiveness fence: a new `DaemonExit` kind compile-fails here (`exit
  // satisfies never`) until it joins one of the cases above — the
  // classification update is forced at the type's home, not in each bin.
  exit satisfies never;
  return 1;
}

export interface DaemonSpec {
  /** The single-instance gate path — the scope key (per-user for kaval, per-repo
   *  for `odu serve`). */
  gatePath: string;
  /** Where to bind the unix socket clients dial. */
  socketPath: string;
  /** The surface router to serve. Shared across every connection.  */
  // biome-ignore lint/suspicious/noExplicitAny: a top-level oRPC router, mirroring serveOverUnixSocket's own `Router<any, any>` param.
  router: Router<any, any>;
  /** Lifetime policy — the one knob that differs across daemons. */
  lifetime: DaemonLifetime;
  log: Logger;
  /** An external stop signal (tests; a parent that wants to tear the daemon
   *  down without a real OS signal). Aborting it ends the daemon via
   *  `reason: "abort"`. */
  signal?: AbortSignal;
  /** Fired once, after the gate is held and the socket is listening — the boot
   *  log's hook and the readiness point a test awaits before connecting. */
  onReady?: (info: { socketPath: string; pid: number }) => void;
  /** A gate the caller ALREADY acquired. Hand this in when the single-instance
   *  gate must be claimed BEFORE the caller's own boot side effects — padi claims
   *  it first so a daemon that lost the race never runs the legacy import, recycles
   *  the shared kaval, or writes the state manifests. `daemonMain` then serves under
   *  this gate and releases it on teardown, exactly as if it had acquired it.
   *  Omitted → `daemonMain` acquires the gate itself (kaval's path). */
  gate?: GateAcquisition;
}

/** Run the daemon: take the gate, serve the router over the socket, then wait
 *  for the configured lifetime to end. Resolves with a `DaemonExit`; cleans up
 *  the socket and releases the gate on every non-`already-running` path. */
export async function daemonMain(spec: DaemonSpec): Promise<DaemonExit> {
  const { gatePath, socketPath, router, lifetime, log, signal } = spec;

  // The caller may have claimed the gate already (padi, to fence its boot side
  // effects behind it); otherwise acquire it here (kaval).
  const gate = spec.gate ?? acquirePidGate(gatePath);
  if (gate.kind === "held") {
    log.info(
      { gatePath, pid: gate.pid },
      "daemon already running; yielding to the live instance",
    );
    return { kind: "already-running", pid: gate.pid };
  }
  if (gate.kind === "dir-not-private") {
    // The gate's parent dir is not owner-only — another local user could have
    // pre-created it (the stable `/tmp/<app>-$UID` fallback) and seeded a gate.
    // Refuse rather than honor a gate we can't trust; the socket-side privacy
    // check would refuse the same dir, so report it as a serve failure.
    log.error(
      { gatePath, dir: gate.dir },
      "daemon gate directory is not private (owner-only); refusing to start",
    );
    return { kind: "serve-failed", detail: "dir-not-private" };
  }

  const listener = await serveOverUnixSocket({ socketPath, router, log });
  if (listener.outcome.kind !== "listening") {
    // A daemon whose socket won't bind has no reason to exist — release the
    // gate so a retry isn't blocked, and report the refusal verbatim.
    gate.release();
    log.error(
      { socketPath, outcome: listener.outcome.kind },
      "daemon could not bind its socket; exiting",
    );
    return { kind: "serve-failed", detail: listener.outcome.kind };
  }

  // Once the socket is listening, the socket file and the held gate are real
  // side effects — a `finally` guarantees they are torn down on EVERY exit from
  // the lifetime block, not just the clean `waitForShutdown` resolve. Without
  // it an `onReady` throw, an `isIdle` throw, or a `waitForShutdown` rejection
  // would leak a stale socket and a held gate, blocking the next launch.
  try {
    log.info({ socketPath, gatePath, pid: process.pid }, "daemon listening");
    spec.onReady?.({ socketPath, pid: process.pid });

    const reason = await waitForShutdown(lifetime, signal);

    log.info({ reason }, "daemon shutting down");
    return { kind: "shutdown", reason };
  } finally {
    listener.close();
    gate.release();
  }
}

/** The default `boundToPid` liveness-poll interval — frequent enough that a
 *  daemon dies within ~a couple seconds of its run, lazy enough not to busy-poll.
 *  Fixed, not a knob (tests inject a small value via the `boundToPid` arm's `pollMs`). */
const PID_WATCH_POLL_MS = 2_000;

/** Resolve when the daemon should stop: an OS signal (SIGTERM/SIGINT), the
 *  external abort, under `idleTimeout` `ms` of continuous idleness, or under
 *  `boundToPid` the moment the watched pid is gone. All handlers are removed
 *  before resolving, so a returning daemon leaves no listeners behind (a test runs
 *  many daemons in one process). */
function waitForShutdown(
  lifetime: DaemonLifetime,
  external?: AbortSignal,
): Promise<"signal" | "abort" | "idle" | "pid-gone"> {
  return new Promise((resolve) => {
    let settled = false;
    const cleanups: Array<() => void> = [];
    const finish = (reason: "signal" | "abort" | "idle" | "pid-gone"): void => {
      if (settled) return;
      settled = true;
      for (const c of cleanups) c();
      resolve(reason);
    };

    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      const handler = (): void => finish("signal");
      process.on(sig, handler);
      cleanups.push(() => {
        process.off(sig, handler);
      });
    }

    if (external) {
      if (external.aborted) {
        finish("abort");
        return;
      }
      const handler = (): void => finish("abort");
      external.addEventListener("abort", handler, { once: true });
      cleanups.push(() => external.removeEventListener("abort", handler));
    }

    if (lifetime.kind === "idleTimeout") {
      // Poll idleness; shut down once it has held continuously for `ms`. Any
      // activity resets the clock. The tick is frequent relative to `ms` but
      // capped so a long timeout doesn't busy-poll.
      let idleSince: number | undefined;
      const period = Math.max(20, Math.min(lifetime.ms, 1000));
      const timer = setInterval(() => {
        if (lifetime.isIdle()) {
          idleSince ??= Date.now();
          if (Date.now() - idleSince >= lifetime.ms) finish("idle");
        } else {
          idleSince = undefined;
        }
      }, period);
      // Don't let the poll timer keep the event loop alive on its own.
      timer.unref?.();
      cleanups.push(() => clearInterval(timer));
    }

    if (lifetime.kind === "boundToPid") {
      // The daemon's reason to exist is the run at `pid`; watch it and shut down
      // cleanly once it is gone. Registration on an ALREADY-dead pid exits
      // immediately — the run this daemon would serve is already over, so there is
      // nothing to serve (and no poll tick to wait for).
      const { pid } = lifetime;
      // Reuse the package's canonical liveness probe (`isHolderLive`, pidGate.ts) —
      // the same `kill(pid,0)` verdict the gate's stale-reap and the supervisor use,
      // single-sourced so the two can't drift on the ESRCH-gone / EPERM-alive rule.
      if (!isHolderLive(pid)) {
        finish("pid-gone");
        return;
      }
      const timer = setInterval(() => {
        if (!isHolderLive(pid)) finish("pid-gone");
      }, lifetime.pollMs ?? PID_WATCH_POLL_MS);
      // Don't let the poll timer keep the event loop alive on its own.
      timer.unref?.();
      cleanups.push(() => clearInterval(timer));
    }
  });
}
