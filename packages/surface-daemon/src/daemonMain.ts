/**
 * The daemon skeleton every surface daemon repeats: **gate → serve → teardown**.
 *
 * `daemonMain` is the mechanism; the *policy* arrives as parameters — the
 * on-disk {@link DaemonHomePaths} (`home`: gate + socket co-located under
 * `dir`), what to serve (`group` + `handlers`, any `@kolu/surface` runtime),
 * how long to live (`lifetime`), and what the daemon's existence is anchored to
 * (`anchor` — the required self-reap invariant: a daemon whose identity
 * directory is proven gone shuts itself down rather than leaking forever,
 * juspay/kolu#2010). kaval picks
 * `{ kind: "forever" }` — an idle PTY daemon still holds your terminals;
 * `odu serve` will pick `idleTimeout` — a quiet CI coordinator may exit. Same
 * skeleton, opposite policies, which is the evidence the mechanism is real and
 * not one program's internals wearing a package name.
 *
 * It never calls `process.exit`: it returns a `DaemonExit` that
 * `daemonProcessMain` (tenure.ts, the bin half) maps to a code. That keeps the
 * whole lifecycle drivable in-process from a test — the gate-race choreography
 * and the idle-timeout path run under vitest with no real signals and no
 * forked children.
 */

import { lstatSync } from "node:fs";
import type { SurfaceHandlers } from "@kolu/surface/server";
import {
  serveOverUnixSocket,
  type UnixSocketServeOutcome,
} from "@kolu/surface/unix-socket";
import type { Rpc, RpcGroup } from "effect/unstable/rpc";
import type { DaemonHomePaths } from "./daemonHome.ts";
import type { Logger } from "./logger.ts";
import {
  claimPidGate,
  type GateAcquisition,
  isHolderLive,
  type ProcessIdentity,
  type ReadProcessIdentity,
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

/** The serializable projection of a {@link DaemonLifetime} — the same three
 *  kinds with the non-wire members dropped (`idleTimeout`'s `isIdle` closure,
 *  `boundToPid`'s test-only `pollMs`). This is what a daemon publishes about
 *  itself so a UI can show which lifetime it is running under (`forever` in
 *  production; `boundToPid` under a test/smoke run). Kept here, beside the union
 *  it projects, so the two can't drift; the wire schema is declared downstream
 *  in each surface's browser-safe vocab, `satisfies`-pinned to this. */
export type DaemonLifetimeInfo =
  | { kind: "forever" }
  | { kind: "idleTimeout"; ms: number }
  | { kind: "boundToPid"; pid: number };

/** Project a live {@link DaemonLifetime} to its serializable {@link
 *  DaemonLifetimeInfo} — drops the `isIdle` closure and the test-only `pollMs`,
 *  keeping only what a consumer can read off the wire. Exhaustive over the union
 *  (a new arm is a compile error here), so the projection can't silently omit a
 *  future lifetime. */
export function lifetimeInfo(lifetime: DaemonLifetime): DaemonLifetimeInfo {
  switch (lifetime.kind) {
    case "forever":
      return { kind: "forever" };
    case "idleTimeout":
      return { kind: "idleTimeout", ms: lifetime.ms };
    case "boundToPid":
      return { kind: "boundToPid", pid: lifetime.pid };
  }
  // Exhaustiveness fence, the file's own idiom (mirrors `daemonExitCode` and
  // `waitForShutdown`): a new `DaemonLifetime` kind compile-fails here (`lifetime
  // satisfies never`) until it joins a case above — so the projection can't
  // silently omit a future lifetime, without pulling a dispatch library into this
  // deliberately minimal-dependency spine.
  lifetime satisfies never;
}

/** Why a daemon's tenure ended — every trigger `waitForShutdown` can fire.
 *  Single-sourced here so the trigger sites, `DaemonExit`, and the resolve
 *  type can't drift on the union. `anchor-gone` is the self-reap: the daemon's
 *  {@link DaemonSpec.anchor} directory stopped existing, so its reason to exist
 *  is gone. `runtime-fault` is the ONE unhappy reason — the served surface
 *  runtime's `done` rejected ({@link DaemonSpec.faultSignal}) — and the only one
 *  {@link daemonExitCode} scores non-zero. */
export type DaemonShutdownReason =
  | "signal"
  | "abort"
  | "idle"
  | "pid-gone"
  | "anchor-gone"
  | "runtime-fault";

/** Why `daemonMain` returned, for the bin to turn into an exit code.
 *  `already-running` is a *success* (another live daemon serves this scope —
 *  exit 0); `serve-failed` is the one real error. */
export type DaemonExit =
  | { kind: "already-running"; pid: number }
  | { kind: "shutdown"; reason: DaemonShutdownReason }
  | { kind: "serve-failed"; detail: UnixSocketServeOutcome["kind"] };

/** The env var that binds a spawned daemon to the RUN that spawned it: when set
 *  to a valid pid, {@link daemonLifetimeFromEnv} selects the `boundToPid` lifetime
 *  so the daemon dies with that pid; ABSENCE selects the caller's production
 *  `fallback` (there is deliberately no way to *weaken* a production daemon — only
 *  a test harness / smoke script opts a spawned daemon into dying with it). Threaded
 *  harness → server → padi → kaval exactly as `KOLU_KAVAL_SPAWN` flows. */
export const DAEMON_BIND_PID_ENV = "KOLU_DAEMON_BIND_PID";

/** The largest value `kill(2)` accepts as a *single-process* pid: POSIX `pid_t`
 *  is a signed 32-bit int, so a real pid never exceeds this. Above it Node throws
 *  `ERR_OUT_OF_RANGE`; a value `<= 0` selects a process GROUP, not one process
 *  (`kill(0,…)` = my group, `kill(-g,…)` = group g) — never an identity we can
 *  watch. */
const MAX_PID = 2 ** 31 - 1;

/** Does `pid` identify a single OS process we can liveness-probe — a positive
 *  integer within `pid_t` range? A fractional, non-positive, or out-of-range value
 *  is not a pid: probing it would throw or, worse, address a process GROUP, so we
 *  reject it up front rather than let it slip into `kill(pid, 0)`. */
function isSingleProcessPid(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0 && pid <= MAX_PID;
}

/** Resolve the lifetime from {@link DAEMON_BIND_PID_ENV}: a valid pid value selects
 *  `boundToPid`; true ABSENCE (the var is UNSET, `raw === undefined`) selects the
 *  caller's production `fallback` (`forever` for kaval/padi). This is the ONE place
 *  the "absence = production" policy lives, so both daemon twins can't drift on it.
 *  Any PRESENT-but-invalid value crashes loudly (fail-fast) rather than silently
 *  degrading to the fallback — a set-but-garbage bind pid is a harness bug, not a
 *  reason to leak the daemon it meant to bind. That includes the empty string: in
 *  Node an unset var is `undefined`, but `""` is a value that is *present and
 *  invalid* (typically a broken harness/systemd expansion of `$SOMEPID`), and
 *  silently treating it as absence is exactly how the leak this daemon prevents
 *  would creep back. So only `raw === undefined` is absence; `""` throws with every
 *  other malformed spelling. "Malformed" is otherwise strict: a real pid stringifies
 *  to plain canonical decimal, so anything else (`1e3`, `0x10`, ` 10 `, `010`,
 *  `12.5`, or a value past {@link MAX_PID}) is a corrupted forward we throw on,
 *  never silently coerce via `Number()`. The forwarders (padiBinding / localDriver)
 *  match this: they forward every DEFINED value, so a broken empty expansion
 *  propagates the whole chain and crashes at the daemon rather than being dropped
 *  mid-hop and silently reverting to `forever`. */
export function daemonLifetimeFromEnv(
  fallback: DaemonLifetime,
): DaemonLifetime {
  const raw = process.env[DAEMON_BIND_PID_ENV];
  if (raw === undefined) return fallback;
  const pid = Number(raw);
  // Canonical decimal ONLY (`^[1-9][0-9]*$`), then a single-process pid in range:
  // `Number()` alone would accept `1e3`/`0x10`/padded whitespace and coerce them to
  // a pid the harness never meant, quietly binding to the wrong process.
  if (!/^[1-9][0-9]*$/.test(raw) || !isSingleProcessPid(pid)) {
    throw new Error(
      `${DAEMON_BIND_PID_ENV} must be a canonical positive-integer pid within pid_t range; got ${JSON.stringify(raw)}`,
    );
  }
  return { kind: "boundToPid", pid };
}

/** The process exit code for a `DaemonExit` — the success/failure classification
 *  lives with the type, not re-decided in each bin's ternary. `already-running`
 *  and `shutdown` are success (a second launch yielding to the live daemon must
 *  exit 0, not look like a crash); `serve-failed` is the one real error. A new
 *  `DaemonExit` variant fails this switch's exhaustiveness check, forcing the
 *  classification update here at the type's home.
 *
 *  The ONE shutdown that is NOT success is `runtime-fault`: the daemon tore down
 *  ORDERLY (that is why it is a `shutdown` at all — socket closed, gate released,
 *  last rites run) but it did so because its surface runtime died structurally.
 *  A supervisor must be able to tell that from a graceful stop, and the exit code
 *  is the only channel it reads (juspay/kolu#2101 G2). */
export function daemonExitCode(exit: DaemonExit): number {
  switch (exit.kind) {
    case "already-running":
      return 0;
    case "shutdown":
      return exit.reason === "runtime-fault" ? 1 : 0;
    case "serve-failed":
      return 1;
  }
  // Exhaustiveness fence: a new `DaemonExit` kind compile-fails here (`exit
  // satisfies never`) until it joins one of the cases above — the
  // classification update is forced at the type's home, not in each bin.
  exit satisfies never;
  return 1;
}

/** How often the daemon's {@link DaemonSpec.anchor} is re-evaluated. Fixed, not
 *  a knob — a vanished anchor is permanent, so a lazy cadence reaps the zombie
 *  without busy-watching. (Tests inject a small value via
 *  {@link DaemonSpec.anchorPollMs}.) */
const ANCHOR_POLL_MS = 5_000;

/** Consecutive PROVEN-gone polls before the daemon reaps itself. A single miss
 *  could be a transient (a brief unmount); a real deletion stays gone, so a
 *  second confirm costs one interval and rules the transient out. */
const ANCHOR_MISSES_TO_EXIT = 2;

/** Is `path` PROVEN absent — `lstat` failed with ENOENT? Reaping requires
 *  proof, and only ENOENT is proof: any other failure (EACCES, EIO, ENOTDIR)
 *  means "I could not read whether it exists", which is the opposite of proof
 *  and must never count toward a self-reap. Exported for the supervisor side
 *  (kolu-server's padi binder) so both ends of the anchor invariant share one
 *  definition of "gone" and can't drift.
 *
 *  SYNC on the serving loop is deliberate (the
 *  `no-sync-blocking-on-the-serving-loop` carve-out, same shape as the padi
 *  binder's `processAlive` gate read): one `lstat` of a single dirent, fired
 *  once per {@link ANCHOR_POLL_MS} tick inside a daemon and once per
 *  (boot/reconnect) dial in the binder — never per request — and identical in
 *  cost to the `existsSync` kaval's #1713 watcher ran on the same cadence in
 *  production. Promoting the anchor thunk to `Promise` for that read would
 *  spread async through every trigger site for no observable gain. */
export function anchorGone(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ENOENT";
  }
}

export interface DaemonSpec {
  /**
   * On-disk home — the spine primitive. Gate and socket are taken only from
   * here (never as loose path strings). Build with {@link resolveDaemonHome} /
   * {@link daemonHome}; overrides (CLI `--socket`) are absorbed into that
   * construction.
   */
  home: DaemonHomePaths;
  /**
   * Resolve the directory this daemon's EXISTENCE is anchored to — its
   * identity/state root, the path whose deletion makes the daemon garbage.
   * When that directory has been PROVEN gone ({@link anchorGone}, ENOENT-only)
   * for {@link ANCHOR_MISSES_TO_EXIT} consecutive polls, the daemon reaps
   * itself (`reason: "anchor-gone"`) through the normal teardown.
   *
   * **Default (when omitted): `() => home.dir`** — gate, socket, and anchor
   * all ride the home, matching the hello-world contract. Override only when
   * the on-disk identity is not the rendezvous home itself (kaval's anchor is
   * its padi's state-root, learned from a manifest beside the socket).
   * `() => undefined` is the honest spelling for a daemon with no on-disk
   * identity (never reaped). Re-evaluated every poll tick.
   */
  anchor?: () => string | undefined;
  /** Anchor poll period override, in ms. A TEST seam — production omits it and
   *  uses {@link ANCHOR_POLL_MS} (mirrors `boundToPid`'s `pollMs`). */
  anchorPollMs?: number;
  /** The served surface's flat `RpcGroup` — `runtime.group`. Paired with
   *  {@link DaemonSpec.handlers}, and spelled as the same two fields
   *  `serveOverUnixSocket` takes, so the spine forwards what it is handed
   *  rather than inventing a wrapper the caller has to learn. The element type
   *  is deliberately erased (`Rpc.Any`): a group assembled by `defineSurface`'s
   *  runtime spec walk carries no type information a caller could trust
   *  (review #16), and the route-set identity between group and handlers is
   *  asserted at `implementSurface` time, not here. */
  group: RpcGroup.RpcGroup<Rpc.Any>;
  /** Every bound member handler keyed by wire tag — `runtime.handlers`. Shared
   *  across every connection. */
  handlers: SurfaceHandlers;
  /** Lifetime policy — the one knob that differs across daemons. */
  lifetime: DaemonLifetime;
  log: Logger;
  /** An external stop signal (tests; a parent that wants to tear the daemon
   *  down without a real OS signal). Aborting it ends the daemon via
   *  `reason: "abort"`. */
  signal?: AbortSignal;
  /** The OWNED-FAULT stop signal — a SECOND abort arm, separate from
   *  {@link DaemonSpec.signal} because the two mean opposite things: `signal` is
   *  a graceful stop (exit 0), this is the served surface runtime's `done`
   *  rejecting, i.e. structural wiring death (`reason: "runtime-fault"`, exit
   *  NON-ZERO — see {@link daemonExitCode}).
   *
   *  Routing the fault through the SAME shutdown machinery rather than a bare
   *  `process.exit` is the point: the socket closes, the gate is released, and
   *  the daemon's own last rites run before the process ends, so the supervisor's
   *  respawn finds a clean rendezvous instead of a stale socket + held gate.
   *  {@link armRuntimeFaultExit} builds the observer that aborts this.
   *
   *  Omit it and a runtime fault has nowhere to go — which is exactly the zombie
   *  the #2101 deploy-#2 incident produced (process alive, gate held, socket
   *  answering, runtime dead). */
  faultSignal?: AbortSignal;
  /** Fired once, after the gate is held and the socket is listening — the boot
   *  log's hook and the readiness point a test awaits before connecting. */
  onReady?: (info: { socketPath: string; pid: number }) => void;
  /** A gate the caller ALREADY claimed (the `acquired` arm only). Hand this in
   *  when the single-instance gate must be claimed BEFORE the caller's own boot
   *  side effects — padi claims it first so a daemon that lost the race never
   *  runs the legacy import, recycles the shared kaval, or writes the state
   *  manifests. `daemonMain` then serves under this gate and releases it on
   *  teardown, exactly as if it had claimed it. Omitted → `daemonMain` claims
   *  via {@link claimPidGate} (kaval's path). */
  gate?: Extract<GateAcquisition, { kind: "acquired" }>;
  /**
   * This daemon's OS identity, supplied by the composition root. **Always
   * required** so the inject can never be forgotten when the gate is pre-claimed
   * today and the spine claims tomorrow. Consumed by the spine only when it
   * claims (`gate` omitted → {@link claimPidGate}); pre-claimed callers still
   * pass identity so the requirement is uniform. The spine never reads platform
   * process state itself.
   */
  processIdentity: ProcessIdentity;
  /** Resolve a PID to its current start-qualified identity. Injected — never
   *  defaulted. Always required (same uniformity as {@link processIdentity}). */
  readProcessIdentity: ReadProcessIdentity;
}

/** Run the daemon: take the gate, serve the surface's handlers over the socket, then wait
 *  for the configured lifetime to end. Resolves with a `DaemonExit`; cleans up
 *  the socket and releases the gate on every non-`already-running` path. */
export async function daemonMain(spec: DaemonSpec): Promise<DaemonExit> {
  const { home, group, handlers, lifetime, log, signal } = spec;
  const { gatePath, socketPath } = home;
  // Default anchor is the home dir — gate/socket/anchor derived from `home`.
  const anchor = spec.anchor ?? (() => home.dir);

  // The caller may have claimed the gate already (padi, to fence its boot side
  // effects behind it); otherwise claim it here (kaval) via the one named
  // sequence — acquire + one-field socket confirm.
  const claimed =
    spec.gate ??
    (await claimPidGate(
      gatePath,
      socketPath,
      spec.processIdentity,
      spec.readProcessIdentity,
    ));
  if (claimed.kind === "held") {
    log.info(
      { gatePath, pid: claimed.pid },
      "daemon already running; yielding to the live instance",
    );
    return { kind: "already-running", pid: claimed.pid };
  }
  if (claimed.kind === "dir-not-private") {
    // The gate's parent dir is not owner-only — another local user could have
    // pre-created it (the stable `/tmp/<app>-$UID` fallback) and seeded a gate.
    // Refuse rather than honor a gate we can't trust; the socket-side privacy
    // check would refuse the same dir, so report it as a serve failure.
    log.error(
      { gatePath, dir: claimed.dir },
      "daemon gate directory is not private (owner-only); refusing to start",
    );
    return { kind: "serve-failed", detail: "dir-not-private" };
  }
  const gate = claimed;

  // The listener narrates its OWN lifetime through the daemon's logger (#2101
  // N3): bound, post-listen fault, closed. That sink is required, not optional —
  // the incident it was restored for was a listening socket that went comatose
  // and wrote not one error line for the rest of the process's life.
  const listener = await serveOverUnixSocket({
    socketPath,
    group,
    handlers,
    log,
  });
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
  // it an `onReady` throw or a `waitForShutdown` throw (the boundToPid pid
  // guard) would leak a stale socket and a held gate, blocking the next launch.
  try {
    // Shutdown triggers BEFORE the readiness announcement: `waitForShutdown`
    // installs the SIGTERM/SIGINT handlers synchronously, and a supervisor
    // that reacts to `onReady` (or the "daemon listening" line) by signaling
    // must find the daemon already signal-safe — announced-then-armed leaves
    // a kernel-default-disposition window where that signal KILLS the
    // process instead of draining it (caught live by the tenure pins: a
    // warm test harness SIGTERM-raced the gap deterministically). This also
    // means an invalid `boundToPid` pid (the guard throw) crashes BEFORE
    // ready is ever announced — a daemon that cannot arm its lifetime must
    // not claim to be up.
    const { shutdown, disarm, alreadyOver } = waitForShutdown({
      lifetime,
      anchor,
      anchorPollMs: spec.anchorPollMs,
      external: signal,
      fault: spec.faultSignal,
      log,
    });

    // The armed lifetime must never outlive this frame: `finish()` already
    // disarms on every resolving path and `disarm` is idempotent, so the
    // `finally` is a no-op there — it exists for the THROWING paths (an
    // `onReady` throw today, any statement inserted here tomorrow), where
    // leaked signal handlers and poll timers would otherwise accumulate
    // across a test running many daemons (the exact leak `waitForShutdown`'s
    // cleanup discipline exists to prevent). Structural, not per-statement.
    try {
      // Shutdown can win DURING arming (an already-aborted external signal,
      // an already-dead bound pid): the daemon was never meaningfully up, so
      // it must not claim to be — skip the announcement and fall through to
      // the ordinary teardown. Announcing here would advertise an UNARMED
      // process (`finish` already stood the triggers down): an
      // announcement-triggered SIGTERM would meet the kernel's default
      // disposition and kill the process before the wrapper release stages
      // (observed as exit 143).
      if (!alreadyOver) {
        log.info(
          { socketPath, gatePath, pid: process.pid },
          "daemon listening",
        );
        spec.onReady?.({ socketPath, pid: process.pid });
      }

      const reason = await shutdown;

      log.info({ reason }, "daemon shutting down");
      return { kind: "shutdown", reason };
    } finally {
      disarm();
    }
  } finally {
    listener.close();
    gate.release();
  }
}

/** The default `boundToPid` liveness-poll interval — frequent enough that a
 *  daemon dies within ~a couple seconds of its run, lazy enough not to busy-poll.
 *  Fixed, not a knob (tests inject a small value via the `boundToPid` arm's `pollMs`). */
export const PID_WATCH_POLL_MS = 2_000;

/** Arm the daemon's shutdown triggers and resolve `shutdown` when it should
 *  stop: an OS signal (SIGTERM/SIGINT), the external abort, under
 *  `idleTimeout` `ms` of continuous idleness, or under `boundToPid` the
 *  moment the watched pid is gone. All handlers are removed before resolving,
 *  so a returning daemon leaves no listeners behind (a test runs many daemons
 *  in one process). The triggers are installed SYNCHRONOUSLY at the call —
 *  that is the readiness ordering `daemonMain` load-bears on — and `disarm`
 *  removes them without resolving, for the one caller path (an `onReady`
 *  throw) where the armed promise must not outlive the daemon call. */
function waitForShutdown(opts: {
  lifetime: DaemonLifetime;
  anchor: () => string | undefined;
  anchorPollMs: number | undefined;
  external?: AbortSignal;
  /** The owned-runtime-fault arm ({@link DaemonSpec.faultSignal}) — same
   *  abort mechanics as `external`, different reason, non-zero exit code. */
  fault?: AbortSignal;
  log: Logger;
}): {
  shutdown: Promise<DaemonShutdownReason>;
  disarm: () => void;
  /** Shutdown won DURING arming (an already-aborted external signal, an
   *  already-dead bound pid): `shutdown` is already resolved and the triggers
   *  already stood down. The caller must NOT announce readiness — the daemon
   *  was never meaningfully up, and an announcement-triggered signal would
   *  meet the kernel's default disposition (observed as exit 143). */
  alreadyOver: boolean;
} {
  const { lifetime, anchor, anchorPollMs, external, fault, log } = opts;
  // Fail fast at CONSUMPTION, not only at the env boundary: a direct caller can
  // construct `{ kind: "boundToPid", pid }` with any number, and an invalid pid
  // (0, negative, fractional, out of range) would be silently reclassified — a
  // group selector or an `ERR_OUT_OF_RANGE` that `isHolderLive` swallows as `false`
  // — into a clean "pid-gone" shutdown. Throw BEFORE the promise so no signal
  // listeners are registered on the crash path (a returning-then-rejecting daemon
  // would leak them across a test's many daemons).
  if (lifetime.kind === "boundToPid" && !isSingleProcessPid(lifetime.pid)) {
    throw new Error(
      `boundToPid.pid must be a positive integer within pid_t range; got ${lifetime.pid}`,
    );
  }
  // `armed` gates BOTH enders: the first `finish` (resolve) or `disarm`
  // (cleanup-only, promise left forever-pending for the throwing-`onReady`
  // path where nothing awaits it) wins; everything after is a no-op.
  let armed = true;
  const cleanups: Array<() => void> = [];
  const disarm = (): void => {
    if (!armed) return;
    armed = false;
    for (const c of cleanups) c();
  };
  const shutdown = new Promise<DaemonShutdownReason>((resolve) => {
    const finish = (reason: DaemonShutdownReason): void => {
      if (!armed) return;
      disarm();
      resolve(reason);
    };
    // The poll-timer scaffold, single-sourced: create the interval, unref it so it
    // never keeps the event loop alive on its own, and register a clearInterval
    // cleanup. Every poll site (idleTimeout, boundToPid, the anchor trigger)
    // supplies only its period + predicate; the register/unref/cleanup idiom
    // lives here once.
    const registerPoll = (period: number, tick: () => void): void => {
      const t = setInterval(tick, period);
      t.unref?.();
      cleanups.push(() => clearInterval(t));
    };

    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      const handler = (): void => finish("signal");
      process.on(sig, handler);
      cleanups.push(() => {
        process.off(sig, handler);
      });
    }

    // The two abort arms, armed identically and differing only in the reason they
    // resolve (and so in the process's exit code). An ALREADY-aborted arm resolves
    // at arm time — that is what `alreadyOver` reports, so the caller skips the
    // readiness announcement; a runtime that faulted during boot (before the
    // daemon ever listened) takes exactly that path rather than announcing a
    // daemon whose runtime is already dead.
    const abortArm = (
      arm: AbortSignal | undefined,
      reason: DaemonShutdownReason,
    ): boolean => {
      if (!arm) return false;
      if (arm.aborted) {
        finish(reason);
        return true;
      }
      const handler = (): void => finish(reason);
      arm.addEventListener("abort", handler, { once: true });
      cleanups.push(() => arm.removeEventListener("abort", handler));
      return false;
    };
    // Fault FIRST: if both are already aborted, the fault is the truer story (a
    // graceful stop that raced a dying runtime is still a dying runtime), and the
    // exit code must say so.
    if (abortArm(fault, "runtime-fault")) return;
    if (abortArm(external, "abort")) return;

    // The ANCHOR trigger — armed under EVERY lifetime, like the signal +
    // external-abort triggers above (it is an independent axis, not a
    // lifetime arm: `forever ∧ anchored` and `boundToPid ∧ anchored` both
    // occur). Deliberately poll-only, no synchronous first check: the
    // consecutive-miss discipline can't be satisfied at arm time, and an
    // anchor already gone at boot still gets its two confirming polls (the
    // same transient tolerance a mid-life miss gets) — so this never
    // contributes to `alreadyOver`. The thunk is re-evaluated every tick:
    // an anchor learned after boot (kaval's manifest, written by its padi
    // around kaval's own boot) self-corrects, and `undefined` — "not
    // anchored right now" — resets the count rather than counting either way.
    const registerAnchorTrigger = (): void => {
      let misses = 0;
      registerPoll(anchorPollMs ?? ANCHOR_POLL_MS, () => {
        const path = anchor();
        if (path === undefined || !anchorGone(path)) {
          misses = 0;
          return;
        }
        misses += 1;
        if (misses < ANCHOR_MISSES_TO_EXIT) return;
        log.info(
          { anchor: path },
          "daemon anchor has been deleted; shutting down (its reason to exist is gone)",
        );
        finish("anchor-gone");
      });
    };
    registerAnchorTrigger();

    // Lifetime-specific shutdown trigger, dispatched EXHAUSTIVELY over the union
    // (mirroring `daemonExitCode`'s fence) — the signal + external-abort triggers
    // above apply to every kind, so `forever` adds nothing here. A future
    // `DaemonLifetime` kind compile-fails at the `satisfies never` until it wires
    // its own trigger, rather than silently inheriting `forever`'s "signal only".
    switch (lifetime.kind) {
      case "forever":
        break;
      case "idleTimeout": {
        // Poll idleness; shut down once it has held continuously for `ms`. Any
        // activity resets the clock. The tick is frequent relative to `ms` but
        // capped so a long timeout doesn't busy-poll.
        let idleSince: number | undefined;
        const period = Math.max(20, Math.min(lifetime.ms, 1000));
        registerPoll(period, () => {
          if (lifetime.isIdle()) {
            idleSince ??= Date.now();
            if (Date.now() - idleSince >= lifetime.ms) finish("idle");
          } else {
            idleSince = undefined;
          }
        });
        break;
      }
      case "boundToPid": {
        // The daemon's reason to exist is the run at `pid`; watch it and shut down
        // cleanly once it is gone. Registration on an ALREADY-dead pid exits
        // immediately — the run this daemon would serve is already over, so there is
        // nothing to serve (and no poll tick to wait for). The pid is already proven
        // a single-process pid by the guard clause above.
        const { pid } = lifetime;
        // Reuse the package's canonical liveness probe (`isHolderLive`, pidGate.ts) —
        // the same `kill(pid,0)` verdict the gate's stale-reap and the supervisor use,
        // single-sourced so the two can't drift on the ESRCH-gone / EPERM-alive rule.
        if (!isHolderLive(pid)) {
          finish("pid-gone");
          break;
        }
        registerPoll(lifetime.pollMs ?? PID_WATCH_POLL_MS, () => {
          if (!isHolderLive(pid)) finish("pid-gone");
        });
        break;
      }
      default:
        // Exhaustiveness fence: a new `DaemonLifetime` kind compile-fails here until
        // it joins a case above (`lifetime satisfies never`).
        lifetime satisfies never;
    }
  });
  // `armed` flipped during construction ⇔ a trigger fired synchronously
  // (`finish` disarms before resolving), so this read IS the already-over fact.
  return { shutdown, disarm, alreadyOver: !armed };
}
