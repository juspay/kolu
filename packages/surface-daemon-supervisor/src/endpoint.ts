/**
 * The endpoint state machine — the supervisor's view of one daemon.
 *
 * An endpoint owns the relationship between a supervising process (kolu-server;
 * the odu CLI) and one surface daemon it spawns and watches: it takes the
 * daemon from nothing to a live, handshaken connection, and reports — on every
 * transition — an honest `{ state, identity, startedAt, metadata }` the
 * supervisor's surface projects so the UI never lies about whether the daemon is
 * there.
 *
 *   connecting → connected            (spawned, socket up, handshake passed)
 *   connecting → dead                 (couldn't recycle / spawn / connect)
 *   connected  → degraded             (the daemon died mid-session)
 *
 * **Two boot policies.** `ensure()` is always-recycle (B2, "the door"): a live
 * survivor is *stopped*, then a fresh daemon is spawned — every boot exercises
 * the two-deadline reap (`reapHolder`: SIGTERM → wait → SIGKILL → wait) → spawn →
 * connect, the exact race #1034 lost, but with
 * zero sessions at stake. `adoptOrEnsure()` (B3.3) is adopt-or-recycle: a live,
 * handshake-compatible survivor is *adopted* (connected to, never killed) so the
 * PTYs it holds — and the session they carry — survive a supervisor restart;
 * only an absent / dead / skewed survivor is recycled. The B3.2 supervised
 * restart that *preserves* a session across a deliberate recycle is the composed
 * `restart` type's job, invoking the recycle path.
 *
 * The endpoint is **spine**: generic over the client `C` and the identity `I`,
 * it interprets neither. The contract handshake, the surface shape, and what
 * `identity` means all live in the injected `connect` (the program's soul). The
 * endpoint only orchestrates: gate read, kill, wait, spawn, connect, and the
 * transition reports.
 */

import {
  type DaemonHomePaths,
  identitiesMatch,
  isHolderLive,
  type Logger,
  type ProcessIdentity,
  readGateIdentity,
  type SocketServeState,
  socketServeState,
} from "@kolu/surface-daemon";
import { Effect, MutableRef, Ref, Schedule } from "effect";
import type {
  BindResult,
  BoundResidentCharacterization,
} from "./convergence/bindResult.ts";
import {
  instanceKeyFromStartedAt,
  instanceKeyTag,
} from "./convergence/instanceKey.ts";
import {
  type DrainBudgetHandle,
  createDrainBudget,
} from "./convergence/budget.ts";
import type { ConvergenceProbe } from "./convergence/converge.ts";
import type {
  ConvergencePolicy,
  DrainCapability,
} from "./convergence/policy.ts";
import {
  isUnspeakablePeerError,
  isUnspeakableProtocolError,
  unspeakableClause,
  UnspeakablePeerError,
} from "./convergence/unspeakable.ts";
// The three the DIAL LEAF owns — imported from it and re-exported below, so
// this file stays their only in-repo reader's door while `@kolu/padi-client`
// (an out-of-repo consumer's entry) reaches them WITHOUT compiling this module.
// See `daemonDial.ts`'s header for what that saved.
import {
  type ConnectedMetadata,
  type DaemonConnection,
  DaemonContractSkewError,
  dialSocket,
  isContractSkewError,
} from "./daemonDial.ts";

export {
  type ConnectedMetadata,
  type DaemonConnection,
  DaemonContractSkewError,
  dialSocket,
  isContractSkewError,
};
import type { OsfactsClientError } from "osfacts-client";
import type { DaemonDriver } from "./driver.ts";
import {
  registerEndpointPrivate,
  type TakeoverResult,
} from "./endpoint.private.ts";
import { ENDPOINT_STATES, type EndpointState } from "./endpointStates.ts";
import type {
  ReadSocketHolders,
  SocketHolder,
  SocketOccupancy,
} from "./socketHolder.ts";
import {
  REAP_KILL_CEILING_MS,
  REAP_TERM_CEILING_MS,
  type ReapOutcome,
  reapHolder,
} from "./reapHolder.ts";

// `ENDPOINT_STATES` / `EndpointState` are the single source of truth for the
// reported state set; they live in the zero-dependency `endpointStates.ts` leaf
// so a browser-shared consumer (kolu's `DaemonStatusSchema`) can derive its enum
// from them without pulling this Node-only module's transport/gate graph. The
// endpoint re-exports them so existing supervisor consumers keep their import.
export { ENDPOINT_STATES, type EndpointState };

/**
 * Supervisor inject for start-qualified process identity. Off the serving event
 * loop, so an osfacts-backed reader never blocks it — prefer
 * `processIdentityAsync(bin)`, with `bin` resolved once at the composition
 * root. Lives here — beside {@link EndpointSpec} — not in
 * `@kolu/surface-daemon` (daemon-binary half; stale-key boundary).
 * Canonical {@link ProcessIdentity} still comes from the daemon package.
 *
 * **An Effect, like every other seam on the spec.** This ask used to be
 * Promise-shaped, and the reason written here was that its answering reader —
 * `processIdentityAsync`, beside `osfactsSocketHolders` in `osfacts-client` —
 * lived in a workspace outside `packages/` that declared no `effect`
 * dependency. That is no longer true: `osfacts-client` takes `effect` as its
 * one runtime dependency and its spawning verbs hand back Effects, so the
 * lift this seam existed to contain has nothing left to contain. The endpoint
 * `yield*`s the inject directly.
 *
 * The error channel is `osfacts-client`'s own union — the same choice, for the
 * same reason, as {@link ReadSocketHolders}. It matters here beyond tidiness:
 * a failed identity read is a failure this endpoint HAS an answer for (report
 * `dead`, then propagate — R3-5), and a declared error channel is what keeps it
 * a failure rather than a defect that sails past the emit and strands the UI at
 * `connecting`. The old `Effect.tryPromise` argued for that by hand at the call
 * site; the type states it now.
 *
 * `Async` stays in the name to keep it apart from `@kolu/surface-daemon`'s
 * synchronous `ReadProcessIdentity`, which the sync gate-claim paths still use.
 */
export type ReadProcessIdentityAsync = (
  pid: number,
) => Effect.Effect<ProcessIdentity | undefined, OsfactsClientError>;

export type ConnectedEndpointStatus<I, M = undefined> = {
  state: "connected";
  /** The daemon's self-declared identity. */
  identity: I;
  /** The daemon's boot time (ms epoch), for uptime. */
  startedAt: number;
  daemonVersion?: never;
  requiredVersion?: never;
} & ConnectedMetadata<M>;

/** The PROVEN-skew arm (SK4) — the one non-connected state that carries a
 *  payload: both contract versions, read structurally off the
 *  `DaemonContractSkewError` fields (never re-parsed from prose), so every
 *  downstream surface can state "the daemon speaks X, this build needs Y". */
export type IncompatibleEndpointStatus = {
  state: "incompatible";
  /** The contract version the daemon actually speaks. */
  daemonVersion: string;
  /** The contract version this supervisor's build requires. */
  requiredVersion: string;
  identity?: never;
  startedAt?: never;
  metadata?: never;
};

export type EndpointStatus<I, M = undefined> =
  | ConnectedEndpointStatus<I, M>
  | IncompatibleEndpointStatus
  | {
      state: Exclude<EndpointState, "connected" | "incompatible">;
      identity?: never;
      startedAt?: never;
      metadata?: never;
      daemonVersion?: never;
      requiredVersion?: never;
    };

/** Thrown by the gate-less-squatter recovery when the process holding the
 *  rendezvous socket does **not** speak kaval — a genuinely foreign process (or a
 *  non-conforming speaker whose handshake failed schema validation, e.g. a version
 *  response missing the required `pid` field). It is the ONE outcome of the
 *  recovery that is a loud refusal rather than a recycle: we never SIGTERM a
 *  process we could not prove is our own daemon, so we surface exactly who is
 *  squatting (pid + command) and let the boot fail honestly. Brand-checked like
 *  {@link isContractSkewError} so it narrows across realm boundaries. */
export class SocketSquatterForeignError extends Error {
  readonly isSocketSquatterForeign = true as const;
  /** The rendezvous socket path a foreign process was found holding. */
  readonly socketPath: string;
  /** Every pid the OS reported holding the socket, each with a readable command
   *  — named so an operator can identify (and deal with) the squatter by hand. */
  readonly holders: readonly SocketHolder[];
  /** What the OS said INSTEAD of a name, when `holders` is empty — the
   *  `unattributed` arm's `detail`. The whole point of the three-way answer is
   *  that a nameless holder is still an explained one ("the socket is bound,
   *  but its holder is not ours to inspect"; "the holder search could not
   *  complete (darwin_proc_fds: BLIND_OR_EMPTY)"), and on darwin that is the
   *  NORMAL path — a descriptor walk denied another user's processes. Dropping
   *  it here and rendering "an unidentifiable process" would put the exact
   *  message this feature deleted back in front of the operator. */
  readonly detail: string | undefined;
  constructor(
    socketPath: string,
    holders: readonly SocketHolder[],
    detail?: string,
  ) {
    const who = holders.length
      ? holders
          .map((h) => `pid ${h.pid} (${h.command ?? "name unavailable"})`)
          .join(", ")
      : (detail ?? "an unidentifiable process");
    super(
      `rendezvous socket ${socketPath} is held by ${who}, which did not complete the daemon handshake — refusing to kill a process that is not a verified daemon of this endpoint`,
    );
    this.name = "SocketSquatterForeignError";
    this.socketPath = socketPath;
    this.holders = holders;
    this.detail = detail;
  }
}

/** True iff `err` is a {@link SocketSquatterForeignError}. Brand-checked (not
 *  `instanceof`) so it holds across module-instance / realm boundaries — and, like
 *  {@link isContractSkewError}, it attests EVERY field its narrowed type promises
 *  (`socketPath`, the optional `detail`, and `holders` as `{ pid, command }`
 *  records), so a foreign
 *  brand-carrier without the payload cannot narrow to a type whose fields a
 *  consumer would then dereference. */
export function isSocketSquatterForeignError(
  err: unknown,
): err is SocketSquatterForeignError {
  const e = err as {
    isSocketSquatterForeign?: unknown;
    socketPath?: unknown;
    holders?: unknown;
    detail?: unknown;
  };
  return (
    typeof err === "object" &&
    err !== null &&
    e.isSocketSquatterForeign === true &&
    typeof e.socketPath === "string" &&
    // `detail` is optional but attested: the narrowed type promises a string
    // when present, and a consumer renders it into an operator-facing message.
    (typeof e.detail === "string" || e.detail === undefined) &&
    Array.isArray(e.holders) &&
    e.holders.every(
      (h) =>
        typeof h === "object" &&
        h !== null &&
        Number.isInteger((h as { pid?: unknown }).pid) &&
        // `command` is OPTIONAL — absent when the identity read lost the race.
        // The brand attests the shape it promises, and an absent name is part
        // of that shape rather than a violation of it.
        (typeof (h as { command?: unknown }).command === "string" ||
          (h as { command?: unknown }).command === undefined),
    )
  );
}

/**
 * A one-shot socket connect probe timed out (`SocketServeState` =
 * `"indeterminate"`). That is NOT proof the holder is free or dead — under load
 * a live listener can leave connect pending. The endpoint must never kill,
 * unlink, or spawn on this outcome; the caller/human (or convergeAdmit's
 * budget) decides the next move. Carries the gate observation so the refusal
 * names who we refused to disturb.
 */
export class SocketProbeIndeterminateError extends Error {
  readonly isSocketProbeIndeterminate = true as const;
  readonly gatePath: string;
  readonly socketPath: string;
  /** Live gate pid from the observation that made us probe, if any. */
  readonly gatePid?: number;
  constructor(rv: { gatePath: string; socketPath: string }, gatePid?: number) {
    const who =
      gatePid !== undefined
        ? `gate names live pid ${gatePid}`
        : "no gate holder named";
    super(
      `socket probe indeterminate at ${rv.socketPath} (${who}) — refusing to kill, unlink, or spawn`,
    );
    this.name = "SocketProbeIndeterminateError";
    this.gatePath = rv.gatePath;
    this.socketPath = rv.socketPath;
    this.gatePid = gatePid;
  }
}

export function isSocketProbeIndeterminateError(
  err: unknown,
): err is SocketProbeIndeterminateError {
  // Fence first — the public type is `unknown`, so null/undefined/primitives
  // must return false, never throw on field access (R6-1).
  if (typeof err !== "object" || err === null) return false;

  const e = err as {
    isSocketProbeIndeterminate?: unknown;
    gatePath?: unknown;
    socketPath?: unknown;
    gatePid?: unknown;
  };
  // Attest every field the narrowed type promises — including optional
  // gatePid (absent/undefined, or a finite positive integer pid). A branded
  // carrier with gatePid: "not-a-pid" must not narrow (R5-2).
  const gatePidOk =
    e.gatePid === undefined ||
    (typeof e.gatePid === "number" &&
      Number.isFinite(e.gatePid) &&
      Number.isInteger(e.gatePid) &&
      e.gatePid > 0);
  return (
    e.isSocketProbeIndeterminate === true &&
    typeof e.gatePath === "string" &&
    typeof e.socketPath === "string" &&
    gatePidOk
  );
}

/** What a boot policy does with a gate-less SKEWED squatter — the one disposition
 *  that differs by boot mode, mirroring the caller's `onSkew` for a gate-recorded
 *  skew. `recycle` (kaval / always-recycle) SIGTERMs the verified orphan and spawns
 *  fresh; `refuse` (the padi binder — #1313) leaves it standing and reports
 *  incompatible, never killing a running daemon. The compatible-adopt and
 *  foreign-refusal arms are identical across both. */
type GatelessSkewPolicy = "recycle" | "refuse";

export interface EndpointSpec<
  C,
  I,
  M = undefined,
  Cap extends DrainCapability = DrainCapability,
> {
  /** Which host this endpoint is for. The status is reported per-host so the
   *  shapes stay host-count-agnostic (one local host today; ssh hosts at R-2). */
  hostId: string;
  /**
   * On-disk home — the spine primitive. Gate and socket are taken only from
   * here (the same home the daemon's `daemonMain` holds), never as loose path
   * strings. Build with `resolveDaemonHome` / `daemonHome`.
   */
  home: DaemonHomePaths;
  /**
   * The consumer's entire convergence surface — who I am + how I converge —
   * stated once here. `converge(endpoint)` is the only public boot verb; the
   * boot-method trio is internal (chosen by this policy). Cap-gates the drain
   * arms and `drainBudget` (unspellable on not-drainable).
   */
  policy: ConvergencePolicy<Cap>;
  /**
   * Read the running daemon's identity over a version-agnostic channel (Pin 3),
   * or `null` if none answers. The framework hands the primary socket path.
   * Bound into `converge(endpoint)` — never re-threaded at the call site.
   */
  probe: (
    socketPath: string,
  ) => Effect.Effect<ConvergenceProbe<Cap> | null, Error>;
  /**
   * Resolve a PID to its current start-qualified identity. Required — the
   * endpoint never performs platform process traversal itself. Off the serving
   * event loop, so an osfacts-backed reader does not block it: prefer
   * `processIdentityAsync(bin)` over the sync twin, with `bin` resolved ONCE at
   * the composition root (`bakedOsFactsBin(…)`) rather than per call.
   *
   * Effect-shaped — see {@link ReadProcessIdentityAsync}.
   */
  readProcessIdentity: ReadProcessIdentityAsync;
  /**
   * Ask the OS which processes hold a unix socket PATH — the gate-less-squatter
   * recovery's only witness once the gate file is gone. Required, and injected
   * for the same reason as `readProcessIdentity`: the endpoint performs no
   * platform traversal itself, and the osfacts binary's path is baked under a
   * name only the composing program knows (`osfactsSocketHolders(bakedOsFactsBin(…))`).
   *
   * Effect-shaped for the same reason — see {@link ReadSocketHolders}.
   */
  readSocketHolders: ReadSocketHolders;
  /** Spawns the daemon so it outlives us (the survivable-spawn driver). */
  driver: DaemonDriver;
  /**
   * Dial + handshake. The framework hands the socket path (from `home` or the
   * held rendezvous) — callers never re-thread it: `connect: (socketPath) =>
   * connectPulse(socketPath)`. On a genuine contract skew reject with
   * `DaemonContractSkewError` (the ONE signal `adoptOrEnsure` trusts to recycle
   * a live survivor). Every other failure rejects with a plain error (treated
   * as possibly-transient: `ensure` reports `dead`; `adoptOrEnsure` retries
   * without killing the survivor — F4).
   */
  connect: (
    socketPath: string,
  ) => Effect.Effect<DaemonConnection<C, I, M>, Error>;
  log: Logger;
  /** Called on every state transition — the supervisor publishes it. */
  onStatus(hostId: string, status: EndpointStatus<I, M>): void;
  /** Ceiling for the freshly-spawned daemon's socket to start accepting.
   *  Default 30_000ms. */
  socketReadyMs?: number;
  /** Socket-readiness poll spacing. Default 50ms. */
  socketPollMs?: number;
  /** How many times `adoptOrEnsure` re-attempts `connect()` against a live
   *  survivor on a NON-skew failure before giving up and reporting `degraded`
   *  (F4). A `DaemonContractSkewError` short-circuits on the FIRST attempt and
   *  recycles (retrying can't fix an incompatible contract); a transient
   *  transport/read hiccup against a healthy survivor clears on a retry and is
   *  adopted — so a one-off failure never kills live PTYs. Default 3. */
  adoptConnectAttempts?: number;
  /** Spacing between `adoptOrEnsure`'s connect retries. Default 100ms. */
  adoptConnectRetryMs?: number;
  /** A SECONDARY home the adopt policies probe ONLY when the PRIMARY
   *  `home` has no live serving survivor — the W2.2 upgrade bridge. The
   *  pre-W2.2 kaval lives at a port-keyed home the digest primary does not name;
   *  on a compatible survivor there it is ADOPTED (its `onAdopted` fires so the
   *  caller can record "my daemon is here"), and on a genuine skew it is recycled
   *  like any survivor. SPAWN is ALWAYS the primary (never the hint), so a recycle
   *  CONVERGES off the hint to the primary keying — the migration is bounded, not
   *  a permanent second home. Absent → the endpoint behaves exactly as before
   *  (a standalone padi with no binder never adopts a stray port kaval). */
  adoptHint?: {
    home: DaemonHomePaths;
    /** Dial + handshake the HINT socket (twin of {@link connect}; path from
     *  the framework). */
    connect: (
      socketPath: string,
    ) => Effect.Effect<DaemonConnection<C, I, M>, Error>;
    /** Fired once, right before the adopted-hint connection is held, so the caller
     *  can record the hint socket as its daemon's live location (e.g. the socket
     *  stamped into spawned PTYs and shown in the daemon dialog). */
    onAdopted?(): void;
  };
  /** Fired once a FRESH SPAWN's socket is up at the PRIMARY rendezvous — BEFORE
   *  the handshake, so it may precede a `connected`, `incompatible`, or `dead`
   *  outcome (it is a LOCATION signal, never a readiness signal): the daemon at
   *  the primary socket is the held one now, whatever its handshake says. The
   *  twin of `adoptHint.onAdopted`, so a caller that recorded the hint location
   *  can reset it back to the primary. A no-op for endpoints with no hint. */
  onSpawned?(): void;
}

/**
 * The **public** endpoint — the supervisor's view of one daemon.
 *
 * Public surface: the fixed `policy` / `probe` / `budget` / `log` that
 * `converge(endpoint)` reads, plus `current()` and `holdRestarting` for
 * `recycle(endpoint, steps)`. The boot-method trio is **not on this type and
 * not on the runtime object** — private binds live in a package WeakMap keyed
 * by handles from {@link createEndpoint} (F4 / F12).
 */
export interface Endpoint<
  C,
  I,
  M = undefined,
  Cap extends DrainCapability = DrainCapability,
> {
  readonly policy: ConvergencePolicy<Cap>;
  probe: () => Effect.Effect<ConvergenceProbe<Cap> | null, Error>;
  readonly budget: Cap extends "drainable"
    ? DrainBudgetHandle
    : DrainBudgetHandle | null;
  readonly log: Logger;
  /** The live connection, or `undefined` before boot or after the daemon died.
   *  SYNCHRONOUS by contract: it reads state the endpoint already holds, and its
   *  callers (a status projection, a facade forwarding a call) have nowhere to
   *  put an effect. */
  current(): DaemonConnection<C, I, M> | undefined;
  /** Run `body` with the status **held at `restarting`** — the emit-guard used by
   *  {@link recycle}. */
  holdRestarting(
    body: Effect.Effect<void, unknown>,
  ): Effect.Effect<void, unknown>;
}

/** Poll until a connection to `socketPath` is accepted, or the ceiling passes.
 *  Succeeds `true` if the socket came up, `false` on timeout. Each probe dials
 *  a bare socket through {@link dialSocket} (the one place that owns the
 *  connect/error race) inside its own scope, so the probe socket is closed
 *  whether the dial succeeded, failed, or was interrupted by the ceiling — the
 *  endpoint's real (handshaken) connection is made once by `spec.connect()`
 *  after this succeeds. The ceiling is ONE deadline over the whole poll rather
 *  than arithmetic re-checked per attempt. */
function waitForSocket(
  socketPath: string,
  ceilingMs: number,
  pollMs: number,
): Effect.Effect<boolean, Error> {
  return Effect.acquireRelease(dialSocket(socketPath), (sock) =>
    Effect.sync(() => sock.destroy()),
  ).pipe(
    Effect.as(true as boolean),
    Effect.scoped,
    Effect.retry(Schedule.spaced(pollMs)),
    Effect.timeoutOrElse({
      duration: ceilingMs,
      orElse: () => Effect.succeed(false),
    }),
  );
}

/** Is this holder the supervising process itself? The ONE definition of "our own
 *  process" in the recovery — every site that asks the question asks it here, so
 *  if the answer ever needs a second component (a pid AND a start time, as the
 *  daemon-identity gate already qualifies it) that is one edit rather than a hunt.
 *  Deliberately NOT applied at identification: see {@link externalHolders}. */
const isSelf = (h: SocketHolder): boolean => h.pid === process.pid;

/** The named holders of a reading, EXCLUDING the supervisor's own process.
 *  The supervisor spawns its daemon as a SEPARATE process (the survivable-spawn
 *  model), so its OWN pid holding the rendezvous is never a squatter — only an
 *  in-process serve (a test's in-process daemon) would be — and must never be a
 *  kill target.
 *
 *  This is the KILL-corroboration filter specifically, and that is the whole of
 *  its remit. The PREDICATE it applies is {@link isSelf}, one definition shared
 *  with the recovery's other self-checks; this helper is the KILL-SIDE
 *  application of it. Self-detection is legitimate elsewhere and the recovery
 *  does spell it elsewhere — to REFUSE a skew served by this process, and to
 *  NAME us in a refusal message — because those are not kill decisions.
 *  Applying this FILTER at identification is precisely the bug that let an
 *  in-process serve read as an empty holder set, and be reported `free`.
 *
 *  It takes the READING, not the reader, so the caller that must keep the three
 *  answers apart (`recoverGatelessSquatter`, and the squatter error's `detail`)
 *  still holds them: this only drops the pids, never the arm. */
function externalHolders(reading: SocketOccupancy): SocketHolder[] {
  return reading.kind === "held"
    ? reading.holders.filter((h) => !isSelf(h))
    : [];
}

/**
 * What a status BECOMES while a supervised restart holds the surface.
 *
 * While a restart is held, the recycle's transient transitions — the old
 * connection closing (`degraded`) and the fresh daemon coming up (`connecting`)
 * — are both part of one "restarting", not separate states a consumer should
 * render. Coerce them; let the terminal `connected`/`dead` (and the explicit
 * `restarting` from `holdRestarting`) report honestly. `incompatible` is
 * DELIBERATELY not coerced (SK4): a proven skew inside a restart is that
 * restart's terminal VERDICT — repainting it as "restarting" would show
 * progress against a daemon a restart cannot fix.
 *
 * A pure function of the two inputs, deliberately: this is the rule an operator
 * sees, and it is worth stating (and testing) without an endpoint, a daemon or a
 * socket around it.
 */
export function underRestartHold<I, M>(
  held: boolean,
  status: EndpointStatus<I, M>,
): EndpointStatus<I, M> {
  return held && (status.state === "connecting" || status.state === "degraded")
    ? { state: "restarting" }
    : status;
}

export function createEndpoint<
  C,
  I,
  M = undefined,
  Cap extends DrainCapability = DrainCapability,
>(spec: EndpointSpec<C, I, M, Cap>): Endpoint<C, I, M, Cap> {
  const socketReadyMs = spec.socketReadyMs ?? 30_000;
  const socketPollMs = spec.socketPollMs ?? 50;
  const adoptConnectAttempts = spec.adoptConnectAttempts ?? 3;
  const adoptConnectRetryMs = spec.adoptConnectRetryMs ?? 100;
  // Per-boot budget memory — drainable only. Survives adopts; shared by every
  // `converge(endpoint)` of this endpoint's life. Not-drainable policies get
  // `null` (and cannot spell `drainBudget` at the type level). Cap generics don't
  // narrow on `capability === "drainable"`, so read the budget via a cast once
  // the runtime discriminant has been checked.
  const budget: DrainBudgetHandle | null =
    spec.policy.capability === "drainable"
      ? createDrainBudget(spec.policy as ConvergencePolicy<"drainable">)
      : null;
  // How many times the gate-less-squatter recovery re-reads the holder + re-runs the
  // handshake when the holder CHANGES between identify and kill. A bounded backstop
  // on a flapping holder; a stable holder is decided on the first pass.
  const RECOVERY_DECISION_ATTEMPTS = 3;

  /** Write a `Ref` from synchronous, non-Effect code. The endpoint has four
   *  synchronous seams by contract — `current()`, `releaseHeld()`, the status
   *  emitter, and the `onClose` callback the transport invokes — and each of
   *  them touches the state cells below. `Ref.set` is an Effect; running one
   *  from a callback would open a run edge for a single assignment, so the
   *  synchronous seams write the cell under the `Ref` directly and the Effect
   *  bodies use `Ref.get`/`Ref.set` as normal. Both spellings address the same
   *  cell, so there is one piece of state, not two views of it. */
  const setRef = <A>(ref: Ref.Ref<A>, value: A): void => {
    MutableRef.set(ref.ref, value);
  };

  const conn = Ref.makeUnsafe<DaemonConnection<C, I, M> | undefined>(undefined);

  // A rendezvous (gate + socket) the endpoint can probe or hold a daemon at. The
  // PRIMARY is where the endpoint SPAWNS (kaval-<digest> for padi); the adopt-HINT
  // (kaval-<port>, upgrade only) is a legacy survivor's rendezvous the primary does
  // not name.
  const primaryRv = {
    gatePath: spec.home.gatePath,
    socketPath: spec.home.socketPath,
  };
  // The rendezvous the endpoint currently HOLDS a daemon at — the primary by
  // default, switched to the adopt-hint when a hint survivor is adopted, and RESET
  // to the primary on every spawn. `ensure`'s recycle SIGTERMs the holder at THIS
  // rendezvous (the legacy port daemon, when adopted off the hint) and spawns fresh
  // at the primary — so a recycle always CONVERGES the keying off the hint.
  const held = Ref.makeUnsafe(primaryRv);

  // The `connect` that dials a given rendezvous — framework hands the path.
  // Primary vs adopt-hint dialer chosen by which socket is held.
  const connectFor = (rv: {
    socketPath: string;
  }): (() => Effect.Effect<DaemonConnection<C, I, M>, Error>) => {
    const dial =
      rv.socketPath === spec.home.socketPath
        ? spec.connect
        : (spec.adoptHint?.connect ?? spec.connect);
    return () => dial(rv.socketPath);
  };

  // The emit-guard flag: true only while `holdRestarting` is running a
  // supervised restart's inner sequence. See `emit` for what it coerces.
  const restartHold = Ref.makeUnsafe(false);

  // The last state actually published (post-coercion). `holdRestarting` reads it
  // to detect a restart that errored out BEFORE any terminal `connected`/`dead`
  // transition — leaving the surface pinned at `restarting` — and recover it.
  const lastReported = Ref.makeUnsafe<EndpointState | undefined>(undefined);

  const connectedStatus = (
    next: DaemonConnection<C, I, M>,
  ): ConnectedEndpointStatus<I, M> =>
    ({
      state: "connected",
      identity: next.identity,
      startedAt: next.startedAt,
      metadata: next.metadata,
    }) as ConnectedEndpointStatus<I, M>;

  // SYNCHRONOUS on purpose, and it has to be: `onStatus` is the supervisor's
  // publish callback, and one of `emit`'s callers is the transport's `onClose`,
  // which hands us no fiber to run in. It reads and writes the state cells
  // directly for the reason `setRef` records.
  const emit = (status: EndpointStatus<I, M>): void => {
    const reported = underRestartHold(Ref.getUnsafe(restartHold), status);
    setRef(lastReported, reported.state);
    try {
      spec.onStatus(spec.hostId, reported);
    } catch (err) {
      spec.log.error(
        { hostId: spec.hostId, err: String(err), status: reported.state },
        "daemon status subscriber failed",
      );
    }
  };

  // Run a caller-supplied best-effort location hook (`adoptHint.onAdopted`) at a
  // fanout, GUARDED: a throw from the hook must not break the funnel — the adoption
  // it accompanies has already succeeded (we hold a live connection), and the hook
  // only records where the daemon lives, so its failure is logged, never propagated
  // out of the boot (which — running AFTER `recoverGuarded`'s catch — would escape
  // the "report `dead` before throwing" contract and strand the UI).
  const runHook = (hook: (() => void) | undefined, name: string): void => {
    try {
      hook?.();
    } catch (err) {
      spec.log.error(
        { hostId: spec.hostId, hook: name, err: String(err) },
        "adoption location hook threw — the adoption succeeded; the hook's side effect did not",
      );
    }
  };

  // The gate-holder check shared by every boot policy: return the live holder
  // that is a safe kill/adopt target, or undefined. Failures (osfacts reject,
  // non-ENOENT lstat, probe indeterminate) emit `dead` then rethrow — the
  // endpoint contract "failures report dead before throw" so the UI never
  // wedges on `connecting` (R4-2). This wrapper is the only spelled path to
  // the probe from boot policies.
  //
  // Identity law: two-field ±2 s match / one-field kill-0, then for one-field
  // only an exhaustive {@link SocketServeState} fold:
  //   serving       → occupied (safe kill/adopt target)
  //   dead / absent → not a safe target (stale / mid-boot); do not SIGTERM
  //   indeterminate → fail loud (never kill / unlink / spawn) with the gate
  //                   observation retained (R4-1)
  // Two-field identity is truth even mid-boot (socket not yet accepting).
  const liveServingHolder = (rv: {
    gatePath: string;
    socketPath: string;
  }): Effect.Effect<number | undefined, Error> =>
    liveServingHolderProbe(rv).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (Ref.getUnsafe(lastReported) !== "dead") emit({ state: "dead" });
        }),
      ),
    );

  /** Read the rendezvous' unix socket serve state. Promise-shaped in
   *  `@kolu/surface-daemon` (it wraps an `lstat` plus a bounded dial), so it is
   *  lifted here rather than travelling as a Promise. */
  const serveStateOf = (
    socketPath: string,
  ): Effect.Effect<SocketServeState, Error> =>
    Effect.tryPromise({
      try: () => socketServeState(socketPath),
      catch: (err) => (err instanceof Error ? err : new Error(String(err))),
    });

  const liveServingHolderProbe = (rv: {
    gatePath: string;
    socketPath: string;
  }): Effect.Effect<number | undefined, Error> =>
    Effect.gen(function* () {
      // One gate read + one identity resolve — never reassemble pid from a
      // second file read that can race a rewrite (fact-check: wrong SIGTERM).
      // Three-way law (A1-1): absent/malformed → no holder; unreadable → FAIL.
      const recorded = readGateIdentity(rv.gatePath);
      switch (recorded.kind) {
        case "ok":
          break;
        case "absent":
        case "malformed":
          return undefined;
        case "unreadable":
          return yield* Effect.fail(
            new Error(
              `gate file unreadable at ${rv.gatePath} — refusing to treat as free or stale (EACCES/EIO is not an observation)`,
            ),
          );
        default: {
          const _exhaustive: never = recorded;
          return yield* Effect.fail(
            new Error(`unreachable gate read: ${JSON.stringify(_exhaustive)}`),
          );
        }
      }

      if (recorded.startUnixUs !== undefined) {
        // Yielded, not lifted: `readProcessIdentity` is an Effect whose
        // declared errors are `osfacts-client`'s three, so a read that FAILS
        // stays a failure this endpoint has an answer for (report `dead`, then
        // propagate — R3-5) instead of a defect that would sail past
        // `liveServingHolder`'s emit and strand the UI at `connecting`. That
        // used to be an `Effect.tryPromise`-not-`Effect.promise` argument in
        // prose; it is the signature now.
        const current = yield* spec.readProcessIdentity(recorded.pid);
        if (
          current === undefined ||
          !identitiesMatch(
            { pid: recorded.pid, startUnixUs: recorded.startUnixUs },
            current,
          )
        ) {
          return undefined;
        }
        // Two-field: identity is truth even when the socket is not accepting.
        return recorded.pid;
      }

      if (!isHolderLive(recorded.pid)) return undefined;
      const state: SocketServeState = yield* serveStateOf(rv.socketPath);
      switch (state) {
        case "serving":
          return recorded.pid;
        case "dead":
        case "absent":
          spec.log.warn(
            {
              hostId: spec.hostId,
              pid: recorded.pid,
              socketPath: rv.socketPath,
              socketState: state,
            },
            "legacy one-field gate names a live pid but its socket is not serving — " +
              "treating gate as stale (not killing the pid: it may be an unrelated " +
              "reused pid)",
          );
          return undefined;
        case "indeterminate":
          return yield* Effect.fail(
            new SocketProbeIndeterminateError(rv, recorded.pid),
          );
        default: {
          const _exhaustive: never = state;
          return yield* Effect.fail(
            new Error(`unreachable socket state: ${_exhaustive}`),
          );
        }
      }
    });

  /**
   * The convergence probe, plus the ONE corroboration PLAN D6/#3 demands before
   * an undecodable wire may become a convergence verdict.
   *
   * The soul's probe raises {@link UnspeakableProtocolError} at one of the two
   * bounded triggers `UnspeakableEvidence` names — an explicit first-frame decode
   * failure, or a peer that accepted the connection and stayed mute past the
   * dial's silence deadline. Either way it is a TRANSPORT fact about whoever
   * answered. That alone is not a licence to act: a stranger squatting our socket
   * may send any bytes it likes — or none — and this package never disposes of a
   * process it has not proven is its own. So the fact is escalated to the
   * corroborated
   * {@link UnspeakablePeerError} only when BOTH attestations hold — the gate
   * file at this rendezvous is ours, and the pid it names passes the same
   * identity law {@link liveServingHolderProbe} applies before any SIGTERM.
   *
   * Anything less and the ORIGINAL error is rethrown, so the observation stays
   * `probe-failed` and a foreign socket-squatter keeps the untouched
   * {@link SocketSquatterForeignError} / refuse path. `probe-failed` is never
   * widened; this only ever NARROWS a subset of it.
   *
   * The corroboration reads the gate through `liveServingHolderProbe`, not
   * `liveServingHolder`: a probe is an OBSERVATION, and emitting `dead` from it
   * would report a transition the convergence fold has not decided yet.
   */
  const probeCorroborated = (): Effect.Effect<
    ConvergenceProbe<Cap> | null,
    Error
  > =>
    spec.probe(primaryRv.socketPath).pipe(
      Effect.catch((err) => {
        if (!isUnspeakableProtocolError(err) || isUnspeakablePeerError(err)) {
          return Effect.fail(err);
        }
        return liveServingHolderProbe(primaryRv).pipe(
          // An unreadable gate or an indeterminate socket probe is not a NO — it
          // is "we could not ask". Either way we have not proven the peer is
          // ours, so the transport fact is reported as the probe failure it is.
          // Logged rather than swallowed: the gate read's own error would
          // otherwise vanish behind the transport fact.
          Effect.catch((gateErr) => {
            spec.log.warn(
              {
                hostId: spec.hostId,
                socketPath: primaryRv.socketPath,
                trigger: err.evidence.trigger,
                err: String(gateErr),
              },
              "a peer proved unspeakable, but its gate could not be read — reporting a probe failure, never a convergence verdict",
            );
            return Effect.fail(err);
          }),
          Effect.flatMap((holder) => {
            if (holder === undefined) {
              spec.log.warn(
                {
                  hostId: spec.hostId,
                  socketPath: primaryRv.socketPath,
                  gatePath: primaryRv.gatePath,
                  trigger: err.evidence.trigger,
                },
                "a peer proved unspeakable at our rendezvous, but no gate of ours names a verified holder — refusing to treat a stranger as our daemon",
              );
              return Effect.fail(err);
            }
            return Effect.fail(
              new UnspeakablePeerError({
                socketPath: primaryRv.socketPath,
                gatePath: primaryRv.gatePath,
                pid: holder,
                evidence: err.evidence,
                cause: err,
              }),
            );
          }),
        );
      }),
    );

  // Stop a proven-live gate holder and do not return until the OS says it is
  // gone — the two-deadline reap (SIGTERM → wait → SIGKILL → wait) that
  // `reapHolder` owns. Reports `dead` and throws when even SIGKILL did not take:
  // respawning over a still-live holder would just yield to it (single
  // instance), a silent no-op recycle, so fail loudly instead.
  //
  // `why` names the disposition that reached here (always-recycle boot, gate-less
  // squatter recovery, cross-epoch takeover) so one journal line tells an operator
  // WHICH policy killed this daemon, not merely that something did.
  const killLiveHolder = (
    holder: number,
    why: string,
  ): Effect.Effect<Extract<ReapOutcome, { kind: "reaped" }>, Error> =>
    Effect.gen(function* () {
      spec.log.info(
        { hostId: spec.hostId, pid: holder },
        `stopping live daemon — ${why}`,
      );
      const reap = yield* reapHolder(holder);
      if (reap.kind === "survived") {
        // Respawning now would just make the new daemon yield to the still-live
        // gate holder (single instance) — a silent no-op recycle. Fail loudly.
        emit({ state: "dead" });
        return yield* Effect.fail(
          new Error(
            `daemon pid ${holder} survived SIGTERM (${REAP_TERM_CEILING_MS}ms) and then SIGKILL ` +
              `(${REAP_KILL_CEILING_MS}ms) after ${reap.waitedMs}ms — a process that outlives SIGKILL is ` +
              "stuck in uninterruptible sleep; nothing this supervisor can do will free the rendezvous",
          ),
        );
      }
      return reap;
    });

  // Hold a freshly-established connection: record it, wire its mid-session close
  // → `degraded` (guarded so a disposed predecessor's late close can't stomp a
  // newer `connected`), and report `connected`. Shared by the two paths that
  // establish a connection — `spawnConnectHold` (a fresh spawn) and
  // `adoptOrEnsure` (a survivor connected to WITHOUT a spawn) — so an adopted
  // daemon reports `connected` identically to a fresh one and neither path
  // re-implements the close→degrade wiring.
  const holdConnection = (next: DaemonConnection<C, I, M>): void => {
    // Dispose any predecessor we're replacing so its transport doesn't leak (a
    // repeated adopt of a gate-less compatible survivor would otherwise leave one
    // client socket + server peer per call). We set `conn = next` FIRST so the
    // predecessor's guarded `onClose` sees `conn !== previous` and can't demote the
    // fresh `connected`; then dispose it.
    const previous = Ref.getUnsafe(conn);
    setRef(conn, next);
    if (previous !== undefined && previous !== next) previous.dispose();
    next.onClose(() => {
      // Only the CURRENT connection's close demotes us — a stale close from a
      // disposed predecessor must not stomp a fresh `connected`.
      if (Ref.getUnsafe(conn) === next) {
        setRef(conn, undefined);
        spec.log.warn(
          { hostId: spec.hostId },
          "daemon connection closed mid-session — degraded",
        );
        emit({ state: "degraded" });
      }
    });
    emit(connectedStatus(next));
  };

  /**
   * After holding `heldConn` at `socketPath`, probe THAT rendezvous for
   * ConvergenceIdentity. Four-valued — never catch-to-null. Correlates a NAMED
   * probe instance key with `instanceKeyFromStartedAt(heldConn.startedAt)`;
   * mismatch (or connection replaced mid-probe) ⇒ uncorrelated. Never overwrites
   * the probe's instance key with the connection key.
   *
   * An unspeakable transport fact is deliberately NOT escalated here: this path
   * runs only AFTER the soul's `connect` handshaked successfully at this very
   * rendezvous, so a peer that suddenly cannot be decoded — or suddenly goes
   * mute — is a fresh anomaly about a connection we already hold; `failed`
   * (⇒ probe-failed) is the honest reading, and the conservative one.
   */
  const characterizeHeld = (
    socketPath: string,
    heldConn: DaemonConnection<C, I, M>,
  ): Effect.Effect<BoundResidentCharacterization> =>
    Effect.gen(function* () {
      const probed = yield* Effect.result(spec.probe(socketPath));
      if (probed._tag === "Failure") {
        const err = probed.failure;
        return {
          kind: "failed",
          message: err instanceof Error ? err.message : String(err),
        };
      }
      const p = probed.success;
      if (p === null) return { kind: "absent" };
      // The probe's transport is ours to close from here on — every arm below
      // returns a characterization, so the dispose is a finalizer rather than a
      // line each of them has to remember.
      return yield* Effect.sync((): BoundResidentCharacterization => {
        // Connection must still be the one we held (no rebind mid-probe).
        if (Ref.getUnsafe(conn) !== heldConn) return { kind: "uncorrelated" };
        // Named probe key must match the held connection's startedAt-derived key.
        if (p.instanceKey.kind === "instance") {
          const fromConn = instanceKeyFromStartedAt(heldConn.startedAt);
          if (
            fromConn.kind !== "instance" ||
            instanceKeyTag(p.instanceKey) !== instanceKeyTag(fromConn)
          ) {
            return { kind: "uncorrelated" };
          }
        }
        // Always the probe's own key — never overwrite with the connection key.
        return {
          kind: "characterized",
          identity: p.identity,
          instanceKey: p.instanceKey,
        };
      }).pipe(Effect.ensuring(Effect.sync(() => p.dispose())));
    });

  // Resolve an ACCEPTING-but-unattributable rendezvous to a SAFE outcome: `free`
  // (→ the caller may spawn) ONLY when a fresh probe proves the socket NOT accepting
  // (a holder that just closed); otherwise the socket is still accepting and we
  // cannot name who holds it — NOT proof of freedom, so we fail LOUD rather than let
  // the caller spawn onto it (F5). This is the feature's ONE operator-facing exit, so
  // it carries the reading's `detail` into the error: when the OS names nobody, the
  // refusal says WHY it could not (a bound-but-uninspectable holder, or a search that
  // went blind) instead of "an unidentifiable process" — which on darwin, where a
  // denied descriptor walk is the normal result, would be the normal message.
  //
  // `taken` is an ALREADY-TAKEN reading of this same socket, passed by a caller
  // that read one microseconds ago; absent, we take our own. It only ever fills
  // the operator-facing `held` / `detail` — the free-vs-throw decision comes
  // from `socketServeState` and nothing else.
  const freeOrFailLoud = (
    rv: {
      gatePath: string;
      socketPath: string;
    },
    taken?: SocketOccupancy,
  ): Effect.Effect<"free", Error> =>
    Effect.gen(function* () {
      // Exhaustive SocketServeState fold — never collapse indeterminate to free
      // (that boolean collapse is the R4-1 defect).
      const state: SocketServeState = yield* serveStateOf(rv.socketPath);
      switch (state) {
        case "dead":
        case "absent":
          return "free" as const;
        case "indeterminate":
          return yield* Effect.fail(new SocketProbeIndeterminateError(rv));
        case "serving": {
          const reading =
            taken ?? (yield* spec.readSocketHolders(rv.socketPath));
          // EVERY holder the OS named, ourselves included. This is a REFUSAL
          // message, not a kill decision, so excluding our own pid here would
          // only rob an operator of the one name the OS actually gave — the
          // in-process-serve case would read as "an unidentifiable process"
          // while the holder was known all along.
          const held: readonly SocketHolder[] =
            reading.kind === "held" ? reading.holders : [];
          const detail =
            reading.kind === "unattributed"
              ? reading.detail
              : held.some(isSelf)
                ? "the socket is served by this very process"
                : undefined;
          spec.log.error(
            {
              hostId: spec.hostId,
              socketPath: rv.socketPath,
              holders: held.map((h) => h.pid),
              detail,
            },
            // The `holders` field carries whatever the OS now names — a set (a holder
            // that reappeared after a flap) or empty (nothing nameable) — so the message
            // doesn't assert which; either way an accepting socket is not proven free.
            "rendezvous socket is still accepting after recovery — failing loud rather than spawning onto it",
          );
          return yield* Effect.fail(
            new SocketSquatterForeignError(rv.socketPath, held, detail),
          );
        }
        default: {
          const _exhaustive: never = state;
          return yield* Effect.fail(
            new Error(`unreachable socket state: ${_exhaustive}`),
          );
        }
      }
    });

  // The gate-less-squatter recovery (SQUAT1). Run by `recoverGuarded` at exactly
  // the boot points where NO live gate holder was found yet the endpoint is about
  // to spawn — `ensure`'s else branch and `adoptSurvivor`'s no-survivor branch
  // (hence, via converge and renew, every wedge path). It is DELIBERATELY not on
  // the `recycle` path, which has already reaped its holder and freed the socket.
  // When the rendezvous socket is ACCEPTING but no gate holder routed us here, a
  // gate-less orphan holds it — the state that wedged kolu forever (`liveServingHolder`
  // is gate-only, so recycle never targeted the orphan; the fresh spawn couldn't
  // bind and handshaked the orphan into an endless `incompatible`).
  //
  // It identifies the holder over the OS (`spec.readSocketHolders`, the injected
  // three-way reading), then proves what it is
  // over the SAME handshake the adopt path trusts, returning a FOUR-way outcome the
  // caller acts on:
  //   - `free`     → the socket is PROVEN not accepting: a fresh probe found it
  //                  dead or absent, so the caller may spawn (or fall to a next
  //                  rendezvous). NOTHING else earns this outcome — an accepting
  //                  socket we cannot attribute fails loud, and so does one held
  //                  by our OWN process, because `free` is what sends the caller
  //                  to spawn and a second daemon must never land on a live socket.
  //   - `adopted`  → a COMPATIBLE gate-less holder: its already-proven connection is
  //                  HELD directly (PTYs preserved), so the caller reconciles the session.
  //   - `refused`  → a SKEW under the REFUSE policy (padi #1313): left STANDING and
  //                  reported `incompatible`; NEVER killed.
  //   - `recycled` → a SKEW under the RECYCLE policy (kaval): the verified orphan was
  //                  SIGTERM'd, so the caller spawns fresh.
  //   A holder that never completes the handshake (a stranger, or a non-conforming
  //   speaker) is NEVER killed; but because a single unreachable pass is NOT proof of
  //   foreign (a slow/loaded legitimate kaval presents identically — the same verdict
  //   `adoptAt` treats conservatively), it is NOT branded foreign on the first miss:
  //   the re-decision loop retries it, and only a holder that stays unreachable across
  //   EVERY attempt reaches the tail's `freeOrFailLoud`, which THROWS
  //   `SocketSquatterForeignError` on a still-accepting socket.
  const recoverGatelessSquatter = (
    rv: { gatePath: string; socketPath: string },
    connect: () => Effect.Effect<DaemonConnection<C, I, M>, Error>,
    skewPolicy: GatelessSkewPolicy,
  ): Effect.Effect<"free" | "refused" | "adopted" | "recycled", Error> =>
    Effect.gen(function* () {
      // Bounded re-decision loop: a holder can CHANGE between our identify and our
      // kill (it exits; the pid is reused; a fresh daemon binds). Rather than trust a
      // stale snapshot, each pass re-reads the OS holders and re-runs the handshake,
      // and the kill only fires when a FRESH handshake — followed by a FRESH OS
      // corroboration — still attests the same skewed daemon.
      for (let attempt = 1; attempt <= RECOVERY_DECISION_ATTEMPTS; attempt++) {
        // Exhaustive fold — indeterminate is NOT free (R4-1).
        const serveState: SocketServeState = yield* serveStateOf(rv.socketPath);
        switch (serveState) {
          case "dead":
          case "absent":
            return "free"; // proven not serving
          case "indeterminate":
            return yield* Effect.fail(new SocketProbeIndeterminateError(rv));
          case "serving":
            break; // occupied — identify the holder below
          default: {
            const _exhaustive: never = serveState;
            return yield* Effect.fail(
              new Error(`unreachable socket state: ${_exhaustive}`),
            );
          }
        }

        // Exhaustive fold of the reading's three answers — the site that must NOT
        // flatten them. Only a NAMED holder set is actionable; `none` (nothing
        // holds it) and `unattributed` (something might, unnameably) both mean we
        // cannot pick a kill target, and both resolve through `freeOrFailLoud`.
        const reading: SocketOccupancy = yield* spec.readSocketHolders(
          rv.socketPath,
        );
        if (reading.kind === "unattributed") {
          // Accepting, and the OS would not name who holds it. NOT proof of
          // freedom — do not let the caller spawn onto it. Re-probe: only a
          // not-accepting socket is `free`; still-accepting fails loud (F5).
          spec.log.warn(
            {
              hostId: spec.hostId,
              socketPath: rv.socketPath,
              detail: reading.detail,
            },
            "the OS would not name the rendezvous socket's holder — resolving the socket safely rather than guessing",
          );
          // Hand over the reading we just took — it is what the refusal reports,
          // and re-spawning osfacts to recompute the very `detail` logged on the
          // line above would buy nothing.
          return yield* freeOrFailLoud(rv, reading);
        }
        if (reading.kind === "none") {
          // The OS proves nothing holds it, yet the probe above said it was
          // serving: a race (the holder closed in between). Still not a licence
          // to spawn on this pass — `freeOrFailLoud` re-probes and only a socket
          // proven not-accepting comes back `free`. It gets the reading we just
          // took: no holder to name, and no reason to spawn osfacts again to
          // re-learn that.
          return yield* freeOrFailLoud(rv, reading);
        }
        // EVERY holder the OS named, ourselves included. Self-exclusion belongs to
        // the KILL decision, not to identification: a socket our own process
        // serves (an in-process daemon) is still a holder to be identified, and
        // the handshake below is what says whether it is a daemon we can serve
        // through. Excluding ourselves HERE meant an in-process serve produced an
        // empty holder set, which was then reported as `free` — and `free` sends
        // the caller to spawn a second daemon onto a socket that is live and
        // serving. The kill site refuses our own pid explicitly instead.
        const holders = reading.holders;
        const holderPids = holders.map((h) => h.pid);

        // Prove what the holder is, reusing the adopt path's three-way handshake
        // verdict (the dial targets `rv.socketPath`; the pids are LOG CONTEXT — a SET,
        // since on darwin the OS lookup may include connected clients, so no member is
        // labelled "the daemon" until a skew self-reports its pid).
        const verdict = yield* connectSurvivor(holderPids, connect);

        if (verdict.kind === "adopted") {
          // Compatible gate-less orphan → ADOPT the already-proven connection directly
          // (its PTYs preserved). Holding it reports `connected` and returns `adopted`,
          // so the caller RECONCILES the surviving session instead of parking it (F1).
          // Record `rv` as the HELD rendezvous — exactly as `adoptAt` does for a
          // gate-recorded survivor — so a later `ensure()` recycles the daemon we
          // actually adopted (e.g. the legacy hint), never abandons it by operating on
          // the primary (F4).
          setRef(held, rv);
          spec.log.info(
            {
              hostId: spec.hostId,
              socketPath: rv.socketPath,
              holders: holderPids,
            },
            "gate-less holder speaks a compatible contract — adopting it (PTYs preserved)",
          );
          holdConnection(verdict.conn);
          return "adopted";
        }
        if (verdict.kind === "unreachable") {
          // A NON-skew, deadline-exhausted handshake failure is NOT proof of foreign —
          // it is the very "alive but we cannot reach it RIGHT NOW" verdict `adoptAt`
          // treats CONSERVATIVELY (a slow / heavily-loaded but legitimate kaval presents
          // here identically to a stranger). So do NOT brand it foreign on the first
          // miss: re-decide via the loop. Only a holder that stays unreachable across
          // EVERY attempt reaches the tail's `freeOrFailLoud`, which fails LOUD on a
          // still-accepting socket. This matches the gate-recorded path's disposition of
          // the identical verdict, and lets the re-decision loop absorb a transient hiccup.
          spec.log.warn(
            {
              hostId: spec.hostId,
              socketPath: rv.socketPath,
              holders: holderPids,
              attempt,
            },
            "gate-less holder did not complete the handshake this pass (non-skew, not proven foreign) — re-deciding rather than branding it foreign",
          );
          continue;
        }

        // `skew`: a daemon of this estate we cannot serve through. What we do with it is
        // the ONE policy that differs by boot mode — the SAME split `adoptSurvivor`'s
        // `onSkew` makes for a GATE-recorded skew, applied here to a gate-less one:
        if (skewPolicy === "refuse") {
          // The padi binder policy (#1313): a client NEVER SIGTERMs a running padi, even
          // a skewed gate-less one — a second binder must not kill the daemon that owns
          // the real PTYs. Leave it STANDING and report the proven skew (SK4).
          spec.log.error(
            {
              hostId: spec.hostId,
              socketPath: rv.socketPath,
              holders: holderPids,
              daemonVersion: verdict.err.daemonVersion,
              requiredVersion: verdict.err.requiredVersion,
            },
            "gate-less survivor is a contract skew under a REFUSE policy — leaving it " +
              "standing (never killing a running daemon), reporting incompatible",
          );
          emit({
            state: "incompatible",
            daemonVersion: verdict.err.daemonVersion,
            requiredVersion: verdict.err.requiredVersion,
          });
          return "refused";
        }

        // `recycle` policy (kaval / always-recycle): the wedge (the 25494 case). The kill
        // target is the daemon's OWN self-reported pid (attestation 3), which MUST be
        // corroborated by the OS as a holder of THIS exact socket (attestation 2). A skew
        // that carries no pid, or a pid the OS does not name, is not a verified daemon of
        // this rendezvous — refuse rather than kill.
        // The ONE holder identity a recycle policy may never act on: ourselves.
        // The supervisor spawns its daemon as a separate process, so a real
        // squatter is never us — but an in-process serve is, and "recycling" it
        // means SIGTERMing the supervisor. It is a REFUSAL, taking the same arm
        // a refuse-policy skew takes: left standing, reported `incompatible`.
        // Not `free` (the caller would spawn a second daemon onto a live socket)
        // and not foreign (the handshake completed and proved a skew).
        if (holders.every(isSelf)) {
          spec.log.error(
            {
              hostId: spec.hostId,
              socketPath: rv.socketPath,
              holders: holderPids,
              daemonVersion: verdict.err.daemonVersion,
              requiredVersion: verdict.err.requiredVersion,
            },
            "the gate-less skew is served by THIS process — never recycling ourselves; leaving it standing and reporting incompatible",
          );
          emit({
            state: "incompatible",
            daemonVersion: verdict.err.daemonVersion,
            requiredVersion: verdict.err.requiredVersion,
          });
          return "refused";
        }
        const reportedPid = verdict.err.pid;
        if (reportedPid === undefined || !holderPids.includes(reportedPid)) {
          // The skew's self-reported pid is absent, or not (yet) among the OS holders —
          // an identity we cannot corroborate THIS pass (a non-conforming speaker, or the
          // OS lookup racing the handshake). Re-decide rather than kill or brand foreign
          // on the first miss; a holder that stays uncorroborated across every attempt
          // reaches the tail's fail-loud (still-accepting → foreign).
          spec.log.warn(
            {
              hostId: spec.hostId,
              socketPath: rv.socketPath,
              reportedPid,
              holders: holderPids,
              attempt,
            },
            "gate-less skew's self-reported pid is not OS-corroborated this pass — re-deciding rather than killing or branding foreign",
          );
          continue;
        }

        // Re-attest identity IMMEDIATELY before the kill, in the order the guarantee
        // needs (F3): (1) a FRESH complete handshake — the holder must STILL be a skew
        // reporting the SAME self-reported pid; THEN (2) a FRESH OS corroboration taken
        // AFTER that handshake — that pid must still hold this exact socket. If either
        // changed (the daemon exited, the pid was reused, it became compatible/foreign,
        // or it moved between the handshake and now) do NOT kill — re-decide next pass.
        const reverify = yield* connectSurvivor([reportedPid], connect);
        if (reverify.kind === "adopted") {
          // The holder became COMPATIBLE between identify and re-attest — dispose the
          // probe connection we just opened (never leak it, F11) and re-decide.
          reverify.conn.dispose();
          spec.log.warn(
            {
              hostId: spec.hostId,
              socketPath: rv.socketPath,
              pid: reportedPid,
            },
            "gate-less squatter became compatible between identify and kill — re-deciding",
          );
          continue;
        }
        if (reverify.kind !== "skew" || reverify.err.pid !== reportedPid) {
          spec.log.warn(
            {
              hostId: spec.hostId,
              socketPath: rv.socketPath,
              pid: reportedPid,
            },
            "gate-less squatter changed between identify and kill — re-deciding against the fresh snapshot",
          );
          continue;
        }
        // OS corroboration AFTER the fresh handshake (F3 order): the just-attested pid
        // must still be a live holder of THIS socket right now. Flattening the
        // reading's unnamed arms to `[]` is lossless HERE: the question is "is this
        // specific pid among the holders", and `none` / `unattributed` both answer no.
        const finalHolders = externalHolders(
          yield* spec.readSocketHolders(rv.socketPath),
        );
        if (!finalHolders.some((h) => h.pid === reportedPid)) {
          spec.log.warn(
            {
              hostId: spec.hostId,
              socketPath: rv.socketPath,
              pid: reportedPid,
            },
            "gate-less squatter moved after its fresh handshake — re-deciding",
          );
          continue;
        }

        spec.log.warn(
          {
            hostId: spec.hostId,
            socketPath: rv.socketPath,
            pid: reportedPid,
            daemonVersion: reverify.err.daemonVersion,
            requiredVersion: reverify.err.requiredVersion,
          },
          "recovered a gate-less skewed daemon squatter — re-attested by a fresh handshake then a fresh OS corroboration (still a skew, same self-reported pid, still the holder) — recycling it",
        );
        // NOTE: only the tiny window between that final OS corroboration and the SIGTERM
        // inside `killLiveHolder` is IRREDUCIBLE — there is no atomic check-and-kill
        // syscall — so it is a bounded, considered race, NOT an oversight, and the SAME
        // race `killLiveHolder` already lives with on a gate pid.
        yield* killLiveHolder(
          reportedPid,
          "a re-attested gate-less skewed squatter holds our rendezvous",
        );
        return "recycled";
      }
      // The holder kept changing across every attempt — a pathological flap. `free`
      // (→ spawn) is only safe when a fresh probe PROVES the socket free; a still-
      // accepting socket fails loud rather than spawning onto an unstable holder (F5) —
      // the same rule the empty-holder branch uses, so both go through `freeOrFailLoud`.
      spec.log.warn(
        { hostId: spec.hostId, socketPath: rv.socketPath },
        "gate-less squatter kept changing across every recovery attempt — resolving the socket safely",
      );
      // No reading handed over here, deliberately: reaching this line means the
      // holder changed under us on every pass, so the last reading we took is by
      // construction STALE. `freeOrFailLoud` takes a fresh one.
      return yield* freeOrFailLoud(rv);
    });

  // Spawn a fresh daemon, wait for its socket, run the injected handshake, and
  // hold the connection (wiring its mid-session close → `degraded`). Reports
  // `dead` before throwing on any failure (launch, socket-never-up, or a failed
  // handshake), so the UI never sticks at `connecting`.
  const spawnConnectHold = (): Effect.Effect<void, Error> =>
    Effect.gen(function* () {
      yield* spec.driver.spawn.pipe(
        // The launch itself failed (ENOENT/EACCES on the binary, a systemd-run
        // that couldn't fork). The endpoint contract is "failures report `dead`
        // before they propagate" — the UI relies on it to leave the indefinite
        // `connecting` state — so flip to `dead` before the failure carries on.
        Effect.tapError(() => Effect.sync(() => emit({ state: "dead" }))),
      );

      const up = yield* waitForSocket(
        spec.home.socketPath,
        socketReadyMs,
        socketPollMs,
      );
      if (!up) {
        emit({ state: "dead" });
        return yield* Effect.fail(
          new Error(
            `daemon socket ${spec.home.socketPath} never came up within ${socketReadyMs}ms`,
          ),
        );
      }

      // A spawn always lands at the PRIMARY — commit it as the held rendezvous
      // (and tell the caller, which resets any recorded hint location back to
      // the primary socket) the moment the primary socket is UP, BEFORE the
      // handshake. Every post-spawn outcome — connected, skew (`incompatible`),
      // or a boot failure (`dead`) — must report against the daemon that now
      // holds the socket: leaving `held` on a recycled adopt-hint's dead legacy
      // rendezvous made a later recycle probe the wrong holder and padi's
      // status carry the dead legacy socket.
      setRef(held, primaryRv);
      spec.onSpawned?.();

      const next = yield* spec.connect(spec.home.socketPath).pipe(
        Effect.tapError((err) =>
          Effect.sync(() => {
            // A fresh spawn that STILL skews is the proven-incompatible verdict
            // (SK4): the currently-realised closure has been tried and cannot speak
            // this build's contract — respawning it again can never converge, so
            // report `incompatible` with both versions (never `dead`, whose UI
            // affordance is exactly the retry that just failed). Every OTHER
            // failure is a genuine boot failure — never an import-time throw,
            // just an honest `dead`.
            if (isContractSkewError(err)) {
              emit({
                state: "incompatible",
                daemonVersion: err.daemonVersion,
                requiredVersion: err.requiredVersion,
              });
            } else {
              emit({ state: "dead" });
            }
          }),
        ),
      );

      // A fresh daemon is a load-bearing lifecycle event — the twin of "adopted a
      // surviving daemon". Logged so a cold boot, a recycle respawn, and a
      // drain-then-respawn each leave an honest "brought a new daemon up here" line
      // in the journal (the adoption path already logs; a fresh spawn must too).
      spec.log.info(
        {
          hostId: spec.hostId,
          socketPath: spec.home.socketPath,
          startedAt: next.startedAt,
        },
        "spawned a fresh daemon and connected",
      );
      holdConnection(next);
    });

  // The stop-then-respawn recycle, defined once: reap a proven-live holder we
  // cannot use, then spawn + connect + hold a fresh daemon in its place. Both
  // policies that recycle — `ensure`'s always-recycle and `adoptOrEnsure`'s
  // skew-recycle — call this, so the mechanism never drifts between them.
  const recycle = (holder: number): Effect.Effect<void, Error> =>
    killLiveHolder(holder, "boot policy = always recycle").pipe(
      Effect.andThen(spawnConnectHold()),
    );

  /**
   * The CROSS-EPOCH TAKEOVER (PLAN D6 / Wave A) — the disposition for a
   * CORROBORATED {@link UnspeakablePeerError}.
   *
   * Its whole argument is one sentence: **for a daemon we have proven is our
   * own, SIGTERM is a drain that needs no wire.** The refusal this replaces
   * reasoned that `drain-newer-else-refuse` cannot drain over an undecodable
   * protocol and must therefore leave the survivor standing — true about the
   * drain VERB, and false about the act. The verb was only ever a way to ask the
   * daemon to run its own in-process shutdown; the kernel asks the same question
   * with a signal, the daemon answers it identically (persist, close, release the
   * gate), and its children live in their own processes and survive either way.
   * What refusing actually bought was a permanently wedged product: an operator
   * had to stop a daemon out of band before an upgrade could ever converge.
   *
   * Three things keep this from being the #1313 hazard (a binder must never
   * SIGTERM a running padi):
   *
   *  - The peer is CORROBORATED — our gate at this rendezvous named it and its
   *    process identity passed {@link liveServingHolderProbe}'s law. An
   *    uncorroborated unspeakable peer never reaches here; it is `probe-failed`
   *    and keeps the untouched {@link SocketSquatterForeignError} arm.
   *  - The peer is UNREACHABLE BY CONSTRUCTION, not merely unresponsive. Both
   *    triggers are bounded below the protocol's own liveness floor, so a daemon
   *    of THIS epoch that is merely slow has demonstrably still spoken (its
   *    protocol layer answers pings beneath its handlers) and yields an identity
   *    — an ordinary adopt/drain decision, never this one.
   *  - The holder is RE-ATTESTED immediately before the kill, and must still be
   *    the exact pid we corroborated. A daemon that was replaced under us is one
   *    we have proven nothing about, so we touch nothing and say so.
   *
   * Loss is bounded by the old daemon's continuous autosave (and, from this
   * epoch on, its signal-edge final capture) — the successor seeds from disk.
   */
  const takeOver = (
    peer: UnspeakablePeerError,
  ): Effect.Effect<TakeoverResult, Error> =>
    Effect.gen(function* () {
      emit({ state: "connecting" });
      // Re-attest through the SAME identity law, right before the kill (the
      // ordering `recoverGatelessSquatter` uses for its own kill). Only the window
      // between this read and the signal is irreducible.
      //
      // Against `primaryRv`, NOT `held`: the classification and its corroboration
      // both came from the primary rendezvous (`probeCorroborated`), so that is the
      // gate whose answer can be compared to `peer.pid` at all. Re-reading a
      // different rendezvous would compare two unrelated facts.
      const holder = yield* liveServingHolder(primaryRv);
      if (holder === undefined || holder !== peer.pid) {
        spec.log.warn(
          {
            hostId: spec.hostId,
            socketPath: peer.socketPath,
            gatePath: peer.gatePath,
            classifiedPid: peer.pid,
            holderNow: holder,
          },
          "the undecodable daemon we classified is no longer the holder of our gate — touching nothing and re-deciding against a fresh observation",
        );
        return { kind: "holder-changed", observed: holder };
      }

      const reap = yield* killLiveHolder(
        holder,
        `it speaks a protocol epoch this supervisor cannot decode (${peer.evidence.trigger})`,
      );
      // THE takeover observation: everything an operator needs after the fact —
      // what was killed, why it was provably ours, and how long the wait took.
      // Logged BEFORE the respawn so a failed spawn still leaves the record.
      spec.log.warn(
        {
          hostId: spec.hostId,
          socketPath: peer.socketPath,
          gatePath: peer.gatePath,
          pid: peer.pid,
          trigger: peer.evidence.trigger,
          endedBy: reap.endedBy,
          waitedMs: reap.waitedMs,
          termCeilingMs: REAP_TERM_CEILING_MS,
          killCeilingMs: REAP_KILL_CEILING_MS,
        },
        `convergence: TOOK OVER the daemon at ${peer.socketPath} — pid ${peer.pid} was provably ours ` +
          `(our gate ${peer.gatePath} named it and its process identity verified) and it ${unspeakableClause(peer.evidence)}. ` +
          `Stopped by ${reap.endedBy} after ${reap.waitedMs}ms; its own shutdown ran, so the session is seeded from disk. ` +
          "Starting this build's daemon in its place.",
      );
      yield* spawnConnectHold();
      return { kind: "taken-over", spawned: { kind: "spawned-fresh" } };
    });

  // `recoverGatelessSquatter` wrapped in the endpoint's "failures report `dead`
  // before they throw" contract (the UI relies on it to leave `connecting`): a
  // foreign-squatter refusal — or a flapping-holder fail-loud — flips to `dead`
  // before rethrowing, unless the recovery already emitted its own terminal `dead`
  // (`killLiveHolder`'s reap-timeout), so one failure never surfaces two `dead`
  // transitions (F10). Returns the recovery's four-way outcome for the caller to act
  // on. Called ONLY where a boot policy found NO live gate holder — never the
  // `recycle` path, which already reaped its holder.
  const recoverGuarded = (
    rv: { gatePath: string; socketPath: string },
    connect: () => Effect.Effect<DaemonConnection<C, I, M>, Error>,
    skewPolicy: GatelessSkewPolicy,
  ): Effect.Effect<"free" | "refused" | "adopted" | "recycled", Error> =>
    recoverGatelessSquatter(rv, connect, skewPolicy).pipe(
      Effect.tapError(() =>
        Effect.sync(() => {
          if (Ref.getUnsafe(lastReported) !== "dead") emit({ state: "dead" });
        }),
      ),
    );

  // The outcome of trying to connect to a live survivor for adoption (F4) — a
  // three-way verdict the endpoint can act on WITHOUT interpreting an error:
  //   adopted    — connected + handshaked; adopt it (preserve its PTYs).
  //   skew       — the soul raised `DaemonContractSkewError`: the contract really
  //                is incompatible, so recycle (retrying can't fix incompatibility).
  //   unreachable — a NON-skew failure (transport dial / unreadable handshake)
  //                that persisted across every retry: the survivor is alive but
  //                we cannot reach it RIGHT NOW. NOT proven incompatible — so the
  //                caller must NOT kill it (that would destroy live PTYs); it
  //                reports `degraded` and leaves the survivor be.
  type SurvivorConnect =
    | { kind: "adopted"; conn: DaemonConnection<C, I, M> }
    // The skew arm carries the TYPED error — its `daemonVersion`/`requiredVersion`
    // fields feed the `incompatible` status arm (SK4), never re-parsed prose.
    | { kind: "skew"; err: DaemonContractSkewError }
    | { kind: "unreachable"; err: unknown };

  // Connect to a live survivor for adoption, retrying bounded times on a
  // NON-skew failure before declaring it `unreachable` (F4). A skew short-circuits
  // immediately (no retry can make an incompatible contract compatible). A
  // transient transport/read hiccup against a healthy survivor clears on a retry,
  // so a one-off failure never costs the survivor its live PTYs. The survivor's
  // socket stays up across the retries (we never killed it), so each retry
  // re-dials the SAME daemon.
  const connectSurvivor = (
    // Candidate holder pid(s), LOG CONTEXT ONLY (the dial targets the rendezvous,
    // not a pid). A SET, not a single pid, because on darwin the OS lookup may
    // include connected clients alongside the listener — logging one of them as
    // "the survivor pid" would mislead; only a skew's self-reported pid names the
    // real daemon. A gate-recorded caller passes its single `[holder]`.
    logHolders: number[],
    connect: () => Effect.Effect<DaemonConnection<C, I, M>, Error>,
  ): Effect.Effect<SurvivorConnect> =>
    Effect.gen(function* () {
      // The three-way verdict is the SUCCESS channel throughout (F4/H12): a
      // transport hiccup and a proven skew must never collapse into one error,
      // because `unreachable` means "leave the survivor's live PTYs alone" and
      // `skew` means "replace it". Retry therefore steps this loop rather than
      // an error channel, where the distinction would have to be re-derived.
      //
      // Seeded so a misconfigured `adoptConnectAttempts <= 0` (the loop never runs)
      // surfaces a loud, meaningful `unreachable` error rather than a bare
      // `undefined` — fail loud over fail silent.
      let lastErr: unknown = new Error(
        `survivor connect made no attempts (adoptConnectAttempts=${adoptConnectAttempts})`,
      );
      for (let attempt = 1; attempt <= adoptConnectAttempts; attempt++) {
        const dialed = yield* Effect.result(connect());
        if (dialed._tag === "Success") {
          return { kind: "adopted", conn: dialed.success } as const;
        }
        const err = dialed.failure;
        lastErr = err;
        // A genuine contract skew is terminal: an incompatible daemon stays
        // incompatible no matter how many times we re-dial it, so stop retrying
        // and tell the caller to recycle.
        if (isContractSkewError(err)) {
          spec.log.warn(
            { hostId: spec.hostId, holders: logHolders, err: String(err) },
            "survivor connect hit a contract skew — recycling (incompatible daemon)",
          );
          return { kind: "skew", err } as const;
        }
        const last = attempt === adoptConnectAttempts;
        spec.log.warn(
          {
            hostId: spec.hostId,
            holders: logHolders,
            attempt,
            attempts: adoptConnectAttempts,
            err: String(err),
          },
          last
            ? "survivor connect failed (non-skew) on the final attempt — " +
                "leaving the survivor up (its PTYs are not killed)"
            : "survivor connect failed (non-skew) — retrying without killing the survivor",
        );
        if (!last) yield* Effect.sleep(adoptConnectRetryMs);
      }
      return { kind: "unreachable", err: lastErr } as const;
    });

  // Connect to a live survivor at rendezvous `rv` (via its own `connect`) and act on
  // the verdict: ADOPT (hold it; `onAdopted` records where it lives), RECYCLE/REFUSE a
  // proven contract SKEW (`onSkew` — the ONE volatile choice between the two policies),
  // or leave an `unreachable` survivor STANDING + `degraded` — the F4 data-loss-critical
  // "never kill a survivor we have not PROVEN incompatible" arm. Factored so the PRIMARY
  // (digest) rendezvous and the adopt-HINT (legacy port) rendezvous share ONE
  // adopt/skew/degrade sequence, so the preserve-live-PTYs handling can't drift between
  // them. Records `held = rv` BEFORE connecting, so a later recycle SIGTERMs THIS holder
  // (the legacy port daemon, when adopted off the hint) and converges to the primary.
  const adoptAt = (
    rv: { gatePath: string; socketPath: string },
    holder: number,
    connect: () => Effect.Effect<DaemonConnection<C, I, M>, Error>,
    onAdopted: (() => void) | undefined,
    onSkew: (
      holder: number,
      err: DaemonContractSkewError,
    ) => Effect.Effect<BindResult, Error>,
    // Which rendezvous this adoption is against — `primary` (the digest socket) or
    // `upgrade-hint` (the pre-W2.2 legacy port socket, the migration bridge). Stamped
    // on the adopted log so an operator can grep "did the W2.2 upgrade bridge fire?"
    // without decoding the socket path.
    via: "primary" | "upgrade-hint",
  ): Effect.Effect<BindResult, Error> =>
    Effect.gen(function* () {
      setRef(held, rv);
      // A single failure is NOT proof of skew (F4): only a `DaemonContractSkewError`
      // raised by the soul's `connect` proves incompatibility. A transport-dial or
      // handshake-read failure may be transient, so it is retried, and if it persists
      // the survivor is `unreachable`, not skewed. The endpoint stays soul-agnostic —
      // it never parses an error, only branches on the soul's typed skew marker.
      const outcome = yield* connectSurvivor([holder], connect);
      if (outcome.kind === "adopted") {
        runHook(onAdopted, "onAdopted");
        spec.log.info(
          {
            hostId: spec.hostId,
            pid: holder,
            startedAt: outcome.conn.startedAt,
            socketPath: rv.socketPath,
            via,
          },
          "adopted a surviving daemon (its PTYs are preserved)",
        );
        holdConnection(outcome.conn);
        // Characterize the held rendezvous (W5) — primary or upgrade-hint socket.
        return {
          kind: "adopted-resident",
          characterization: yield* characterizeHeld(
            rv.socketPath,
            outcome.conn,
          ),
        };
      }
      if (outcome.kind === "skew") {
        // Proven incompatible: `adoptOrEnsure` RECYCLES (kill this holder + respawn at
        // the primary — converging a skewed legacy kaval to the digest keying);
        // `adoptOrSpawnOrRefuse` REFUSES (leave standing + report `incompatible`).
        return yield* onSkew(holder, outcome.err);
      }
      // `unreachable`: alive but every NON-skew connect attempt failed. NOT proven
      // incompatible, so must NOT kill it (that would destroy the live PTYs adoption
      // exists to preserve — the F4 data-loss mode). Report `degraded` and leave it
      // standing; the facade throws until a later reconnect, its session intact.
      spec.log.error(
        {
          hostId: spec.hostId,
          pid: holder,
          attempts: adoptConnectAttempts,
          err: String(outcome.err),
        },
        "live daemon survivor is unreachable (non-skew connect failure) — " +
          "leaving it up to preserve its PTYs; reporting degraded",
      );
      emit({ state: "degraded" });
      return { kind: "refused-or-failed" };
    });

  // The shared survivor-adoption sequence, factored from `adoptOrEnsure` and
  // `adoptOrSpawnOrRefuse`: the two policies are IDENTICAL except for how they treat
  // a proven contract SKEW (recycle vs refuse), which the caller passes as `onSkew`.
  // Probes the PRIMARY (digest) rendezvous first; only when it has NO live survivor
  // does it fall to the adopt-HINT (legacy port, W2.2 upgrade) — so a compatible
  // digest survivor is always preferred and a standalone endpoint (no hint) behaves
  // exactly as before. The no-survivor fresh spawn is always at the PRIMARY. Returns
  // whether a live survivor was ADOPTED.
  const adoptSurvivor = (
    // The ONE policy value for a proven contract skew — recycle (kaval) or refuse
    // (padi). BOTH enactment sites derive from it: the gate-recorded `onSkew`
    // handler below, and the gate-less `recoverGuarded(rv, connect, policy)` at the
    // no-gate-holder branches. One statement of the policy, so the two paths can't
    // drift and the illegal cross-pairing (recycle-here + refuse-there) is unrepresentable.
    policy: GatelessSkewPolicy,
  ): Effect.Effect<BindResult, Error> =>
    Effect.gen(function* () {
      // Derived from `policy`, so the gate-recorded skew disposition is the SAME
      // recycle-vs-refuse choice the gate-less path takes — never a hand-synced twin.
      // recycle (kaval): SIGTERM the skewed holder and spawn fresh. refuse (padi):
      // leave it STANDING and report incompatible — #1313, never SIGTERM a running padi.
      const onSkew = (
        holder: number,
        err: DaemonContractSkewError,
      ): Effect.Effect<BindResult, Error> =>
        Effect.gen(function* () {
          if (policy === "recycle") {
            spec.log.warn(
              { hostId: spec.hostId, pid: holder },
              "live daemon survivor is a contract skew — recycling it",
            );
            yield* recycle(holder);
            return { kind: "spawned-fresh" };
          }
          spec.log.error(
            { hostId: spec.hostId, pid: holder },
            "live padi survivor is a contract skew — REFUSING (never killing a " +
              "running padi); leaving it up and reporting incompatible. Upgrade " +
              "the binder or drain the daemon via its control core to converge.",
          );
          // The verdict is PROVEN skew — name it (SK4). Reporting it as plain
          // `degraded` made a contract skew indistinguishable on the wire from
          // "unreachable" / "died mid-session", which is exactly the collapse
          // this arm exists to kill.
          emit({
            state: "incompatible",
            daemonVersion: err.daemonVersion,
            requiredVersion: err.requiredVersion,
          });
          return { kind: "refused-or-failed" };
        });
      emit({ state: "connecting" });
      const primaryHolder = yield* liveServingHolder(primaryRv);
      if (primaryHolder !== undefined) {
        return yield* adoptAt(
          primaryRv,
          primaryHolder,
          connectFor(primaryRv),
          undefined,
          onSkew,
          "primary",
        );
      }
      // PRIMARY has no live GATE survivor — but a gate-less squatter may still hold the
      // PRIMARY socket (the wedge). Recover it BEFORE falling to the legacy hint (F4
      // seq 1): otherwise a primary squatter is masked by a hint adoption and re-wedges
      // the later recycle→spawn-at-primary. A compatible primary holder is ADOPTED
      // (return true so converge reconciles); a skew is recycled (kaval) / refused
      // (padi); a foreign holder fails loud. Only when the primary is genuinely FREE do
      // we consider the hint.
      // Map a gate-less recovery outcome to `adoptSurvivor`'s boolean, or `undefined`
      // when the rendezvous was FREE (nothing recovered → fall through / spawn). One
      // interpretation of the four-way outcome, so the primary and hint dispatch can't
      // drift.
      const settle = (
        outcome: "free" | "refused" | "adopted" | "recycled",
        onAdopted?: () => void,
      ): Effect.Effect<BindResult | undefined, Error> =>
        Effect.gen(function* () {
          switch (outcome) {
            case "adopted": {
              runHook(onAdopted, "onAdopted");
              // held was set in recoverGuarded; characterize that rendezvous (W5).
              // conn is the just-held connection.
              const heldConn = Ref.getUnsafe(conn);
              if (heldConn === undefined) {
                return {
                  kind: "adopted-resident",
                  characterization: { kind: "absent" },
                };
              }
              return {
                kind: "adopted-resident",
                characterization: yield* characterizeHeld(
                  Ref.getUnsafe(held).socketPath,
                  heldConn,
                ),
              };
            }
            case "refused":
              return { kind: "refused-or-failed" };
            case "recycled":
              yield* spawnConnectHold();
              return { kind: "spawned-fresh" };
            case "free":
              return undefined; // nothing recovered here — the caller falls through
          }
          // Exhaustiveness fence (the file's `satisfies never` idiom): a new recovery
          // outcome compile-fails here until it is handled, rather than silently
          // falling through to "free".
          outcome satisfies never;
          return undefined;
        });

      const primary = yield* settle(
        yield* recoverGuarded(primaryRv, connectFor(primaryRv), policy),
      );
      if (primary !== undefined) return primary;

      // PRIMARY is free. On a W2.2 upgrade the pre-W2.2 kaval may still be alive at the
      // adopt-HINT (legacy port) rendezvous the digest primary does not name.
      if (spec.adoptHint) {
        const hintRv = {
          gatePath: spec.adoptHint.home.gatePath,
          socketPath: spec.adoptHint.home.socketPath,
        };
        const hintHolder = yield* liveServingHolder(hintRv);
        if (hintHolder !== undefined) {
          return yield* adoptAt(
            hintRv,
            hintHolder,
            connectFor(hintRv),
            spec.adoptHint.onAdopted,
            onSkew,
            "upgrade-hint",
          );
        }
        // Hint has no live GATE holder — but a gate-less legacy daemon may still hold
        // the hint socket (F4 seq 2): recover it with the HINT's own dialer so it is
        // not abandoned. On adopt, record the hint as the live location (`onAdopted`);
        // on recycle, the follow-on spawn lands at the PRIMARY, converging the migration.
        const hint = yield* settle(
          yield* recoverGuarded(hintRv, connectFor(hintRv), policy),
          spec.adoptHint.onAdopted,
        );
        if (hint !== undefined) return hint;
      }
      // Nothing live anywhere — a fresh boot; spawn fresh at the PRIMARY.
      yield* spawnConnectHold();
      return { kind: "spawned-fresh" };
    });

  // Public handle — private boot binds live only in the package WeakMap (F12).
  const endpoint: Endpoint<C, I, M, Cap> = {
    current: () => Ref.getUnsafe(conn),

    holdRestarting(
      body: Effect.Effect<void, unknown>,
    ): Effect.Effect<void, unknown> {
      // Emit `restarting` up front so the status flips the instant the restart
      // begins (before the capture/drain the caller runs inside `body`), then
      // hold it across the recycle. Cleared by the finalizer so a failed
      // restart's `dead` (emitted by the inner recycle, never coerced) is the
      // last word.
      return Effect.suspend(() => {
        setRef(restartHold, true);
        emit({ state: "restarting" });
        return body;
      }).pipe(
        Effect.tapError(() =>
          Effect.sync(() => {
            // The recycle (`ensure`) reports its own terminal `dead`/`connected`
            // before it fails. But a step that runs BEFORE the recycle —
            // `capture` or `drain` — can fail with the surface still pinned at
            // `restarting`, even though the daemon never moved (those steps
            // don't touch the connection). Recover the honest current state so
            // the rail/buttons don't stick in an in-flight state forever: a live
            // connection means the old daemon is still `connected`; no
            // connection means it's `dead`. (Skip if the recycle already emitted
            // a terminal state — `lastReported` is no longer `restarting` — so
            // we never stomp a fresh `connected`/`dead`.)
            if (Ref.getUnsafe(lastReported) !== "restarting") return;
            // restartHold is still true here, but `connected`/`dead` are never
            // coerced by `emit`, so the recovery reports honestly.
            const live = Ref.getUnsafe(conn);
            if (live) emit(connectedStatus(live));
            else emit({ state: "dead" });
          }),
        ),
        Effect.ensuring(Effect.sync(() => setRef(restartHold, false))),
      );
    },

    // ── ConvergingEndpoint face — `converge(endpoint)` reads these ──────────
    policy: spec.policy,
    probe: probeCorroborated,
    // Drainable policies always mint a budget above; not-drainable leave null.
    // The Cap generic makes `budget` non-null when Cap is "drainable".
    budget: budget as Cap extends "drainable"
      ? DrainBudgetHandle
      : DrainBudgetHandle | null,
    log: spec.log,
  };

  registerEndpointPrivate(endpoint, {
    ensure: Effect.gen(function* () {
      emit({ state: "connecting" });
      // ALWAYS RECYCLE (B2, "the door"): a live serving survivor is killed,
      // never adopted, so no survival hazard can open (no orphan, no skew older
      // than one boot). `liveServingHolder` proves a holder is really the daemon
      // before we SIGTERM it; a stale gate over a reused pid is left alone.
      //
      // Probe the HELD rendezvous — the socket the endpoint currently holds a daemon
      // at, which is the adopt-HINT (legacy port) socket after an upgrade adoption,
      // not the primary. So a Restart-kaval recycle SIGTERMs the ADOPTED legacy daemon
      // (never leaks it) and `recycle`'s spawn lands at the PRIMARY (digest) — the
      // bounded migration converges here.
      const at = Ref.getUnsafe(held);
      const holder = yield* liveServingHolder(at);
      if (holder !== undefined) {
        yield* recycle(holder);
      } else {
        // No live GATE holder — but a gate-less squatter may still hold the HELD
        // socket (the wedge). Recover it (at the held rendezvous, with its matching
        // dialer); `ensure` is always-recycle, so a gate-less skew is RECYCLED (a
        // foreign holder is still refused loud). Spawn fresh when the recovery reaped
        // a squatter (`recycled`) or the socket was free (`free`); a compatible holder
        // is adopted in place (`adopted`) and `refused` can't arise under recycle.
        const o = yield* recoverGuarded(at, connectFor(at), "recycle");
        if (o === "free" || o === "recycled") yield* spawnConnectHold();
      }
    }),

    // ADOPT-OR-RECYCLE (B3.3): a live serving handshake-COMPATIBLE survivor is
    // ADOPTED; a proven SKEW is RECYCLED. Yields a BindResult (F5).
    adoptOrEnsure: Effect.suspend(() => adoptSurvivor("recycle")),

    takeOver,

    // ADOPT-OR-SPAWN-OR-REFUSE (W2.2): a proven contract SKEW is REFUSED, not
    // recycled (#1313). Yields a BindResult (F5).
    adoptOrSpawnOrRefuse: Effect.suspend(() => adoptSurvivor("refuse")),

    releaseHeld(): void {
      // W4.2: drop held connection so a non-adopt converge verdict matches reality.
      const c = Ref.getUnsafe(conn);
      if (c === undefined) return;
      setRef(conn, undefined);
      c.dispose();
      emit({ state: "degraded" });
    },
  });

  return endpoint;
}
