/**
 * `makeSession` — the reconnect-mirror SESSION appliance (S9).
 *
 * A **session** is a durable, supervised relationship to one remote surface: it
 * dials the far end, notices when the link dies, redials with exponential backoff,
 * gives up loudly after too many *remote* rejections, and hands `reServeSurface`'s
 * pump a fresh client per (re)bind. That reconnect/backoff/give-up/state-merge loop
 * is the ELECTRICITY — extracted ONCE here, transport-agnostic.
 *
 * The transport is a **connector**: a `connectOnce` plug the loop calls per (re)dial.
 * It owns everything transport-specific — provisioning, spawning, the byte channel,
 * the per-attempt liveness probe — and hands back one {@link Connection} (a live
 * `client`, a `closed` signal, an `isAlive` probe). The ssh transport is
 * {@link sshConnector}; kolu-server's local padi arm supplies an endpoint connector.
 * Two transports, one loop; `reServeSurface` can't tell them apart.
 *
 * Connection-state lifecycle (snapshot-then-delta on `onState`). A session opens at
 * its connector's OPENING phase — `connecting` for a non-provisioning endpoint, or
 * the connector's first provisioning phase (the ssh connector's `probing`) — and
 * advances through the connector's own provisioning vocabulary before `connecting`:
 *
 *     <open>       ──connectOnce ok──────▶ connecting   (ssh: probing → [copying → building] → connecting)
 *     <open>       ──connectOnce reject──▶ disconnected (backoff, then retry)
 *     connecting   ──markConnected ──────▶ connected
 *     connecting   ──watchdog timeout ───▶ disconnected (tear down, then retry)
 *     connected    ──link died ──────────▶ disconnected ──reconnect──▶ <open>
 *     disconnected ──gave up (N *remote* fails)──▶ failed   (terminal; `reconnect()` re-arms)
 *
 * A `"remote"` failure (reached the host, it rejected us) is terminal after
 * `MAX_CONSECUTIVE_FAILURES`; a `"network"` failure (unreachable host) is NEVER
 * terminal — the capped backoff keeps probing so a roaming laptop self-heals. `recheck()` force-cycles even a seemingly-connected link
 * (wake/network change); `reconnect()` only re-arms a `failed`/idle session.
 *
 * Every server auto-answers the framework-reserved `system.identity` (see
 * `@kolu/surface/identity`), so `identity()` reports the bound server's contract
 * version / uptime / build off the live client — `null` only transiently before
 * the first successful connect, never null-forever.
 */

import {
  createHeartbeat,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
} from "@kolu/surface/heartbeat";
import { monotonicNow } from "@kolu/surface/time";
import { measureSurfaceClockOffset } from "@kolu/surface/clock-now";
import {
  probeSurfaceIdentity,
  type ServedIdentity,
  type SurfaceIdentity,
} from "@kolu/surface/identity";
import { probeSurfaceLive } from "@kolu/surface/liveness";
import type { SurfaceClientLike } from "@kolu/surface/project";
import { inMemoryCell } from "@kolu/surface/server";
import type { LogEntry } from "./connection";

const MAX_PROGRESS_LINES = 20;
const MAX_CONSECUTIVE_FAILURES = 5;

/** The dead-man ceiling for a LOCAL arm's liveness watchdog (see
 *  {@link Connection.processAlive}). When the same-box process oracle reports the padi
 *  ALIVE but its heartbeat has stayed silent this long, the process is
 *  deadlocked-but-alive (not merely slow under CPU load), so the watchdog force-cycles
 *  anyway — slow-under-load and hung-forever are different facts and get different
 *  treatment. Minute-scale and BAKED (no knob): far past any CPU-contention heartbeat
 *  delay, far short of leaving a genuinely wedged local padi unhealed. */
const LOCAL_LIVENESS_DEAD_MAN_CEILING_MS = 60_000;

/** The observable link state a session publishes (snapshot-then-delta on
 *  `onState`) — ONE framework type. A `log` tail every arm carries, intersected
 *  with a discriminated union over `phase`'s UP/DOWN split, so "down with no
 *  reason", "live with a stale error", and "gave up on a transport blip" are all
 *  UNREPRESENTABLE:
 *
 *   - UP (`connecting`/`connected`/a connector-declared provisioning `Prov`, e.g.
 *     the ssh connector's `"probing"`/`"copying"`/`"building"`) — no `error`/`cause`
 *     FIELDS at all (there is nothing to report). The `connected` arm ALONE also
 *     carries `clockOffset` — the far-end host's wall-clock offset (ms) vs THIS
 *     process, measured off the framework-reserved `system.clockNow` at the admit
 *     handshake (see {@link measureSurfaceClockOffset}) — `null` until that first probe stamps
 *     it (offset-at-hello is the contract; a keyed `SurfaceMap` reads a null offset
 *     as still `connecting`, never a `0` placeholder).
 *   - `disconnected` — `error` + `cause` are REQUIRED, never nullable: a down link
 *     ALWAYS has a real reason, so a consumer needs no `?? "disconnected"`
 *     invented-text fallback. `cause` is `"network"` (unreachable; retries forever)
 *     or `"remote"` (host reached, rejected us).
 *   - `failed` — terminal, and `cause` is the `"remote"` LITERAL: a `"network"`
 *     fault never gives up (it retries forever), so `failed`+`network` is a COMPILE
 *     error by type, not a runtime convention.
 *
 *  `Prov` is the connector's OWN provisioning-phase vocabulary (`= never` for a
 *  non-provisioning endpoint — the local arm, whose up phases are exactly
 *  `connecting`/`connected`, so `"copying"` is unspellable there; `= "probing" |
 *  "copying" | "building"` for the ssh connector). The browser cell `ConnectionInfo`
 *  (`./connection`) IS this sum at `Prov = SshProv` on the wire. */
export type SessionState<Prov extends string = never> = {
  /** The link's provenance-tagged log tail (last {@link MAX_PROGRESS_LINES}) —
   *  provisioning output, transport start, agent fatal-error tails, each tagged
   *  `local` (the parent's own chatter) or `remote` (the far agent's forwarded
   *  stderr). Provenance is a FIELD (`source`), not an in-band `[local] `/`[remote] `
   *  string prefix. Scoped to the CURRENT episode: it grows across the phase-flips
   *  WITHIN one dial→up episode, but is RESET when a fresh episode begins (a down→up
   *  crossing — a reconnect after disconnect/failed), so the overlay never shows a
   *  prior episode's stale lines under a fresh timer (see {@link sinceMs}). */
  log: readonly LogEntry[];
  /** How long the CURRENT episode has been running, in ms, computed on the SERVER's
   *  single clock at the moment this frame was published (`now − episodeStart`, where
   *  the episode begins on a down→up crossing). A DURATION, never a raw epoch — a
   *  browser must NOT subtract a foreign clock, so it reads this and extends it
   *  locally with its own ticker. Resets toward `0` on each fresh episode. The one
   *  source both per-episode elapsed AND per-episode log scoping derive from. */
  sinceMs: number;
} & (
  | { phase: "connecting" | Prov }
  | { phase: "connected"; clockOffset: number | null }
  | { phase: "disconnected"; error: string; cause: "network" | "remote" }
  | { phase: "failed"; error: string; cause: "remote" }
);

/** The DOWN arms of {@link SessionState} (`disconnected`/`failed`) — the frames
 *  carrying `error`/`cause`. `Prov`-independent (the up arm carries them on no
 *  connector), so a projection that has runtime-checked `phase ∈ {disconnected,
 *  failed}` narrows by asserting THIS shape: a GENERIC `Prov` defeats TS's
 *  discriminated-union narrowing (for an unconstrained `Prov`, the up arm's `phase`
 *  could itself be `"disconnected"`), so control-flow narrowing can't reach
 *  `error`/`cause` — the assertion can. */
export type DownSessionState = Extract<
  SessionState,
  { phase: "disconnected" | "failed" }
>;

/** The minimal session slot a fleet registry stores (S1): it only ever calls
 *  `destroy()` (add-rollback, remove, destroyAll), so the slot demands exactly
 *  that. `Session` satisfies it; a registry keyed on `DestroyableSession` never
 *  names a richer session type it doesn't use. Fleet verbs (reconnect/recheck) are
 *  declared separately via `buildRemotePool`'s `controls` (S2). */
export interface DestroyableSession {
  destroy(): void;
}

/** The reconnect-mirror receptacle's SESSION role — everything `reServeSurface` /
 *  `pumpRemoteSurface` and the fleet registry consume. `makeSession` returns this;
 *  kolu-server's padi arms are this plus the daemon members (added by object
 *  spread). Parameterized by the CLIENT the transport yields (default the opaque
 *  `SurfaceClientLike` the mirror forwards structurally) — NOT by the contract, so a
 *  specific-contract session stays assignable to the general receptacle (the
 *  covariance `session.variance.test-d.ts` pins). */
export interface Session<
  Client = SurfaceClientLike,
  Prov extends string = never,
> {
  /** Pin the session open for the parent's lifetime (bumps a ref so the reconnect
   *  loop keeps retrying across transient callers reaching zero). Resolves with the
   *  first client. */
  pin(): Promise<Client>;
  /** The in-flight/current client promise, or `null` between a link death and the
   *  next dial. Each dial reassigns it, so a pump detects a respawn by identity
   *  drift. */
  currentClient(): Promise<Client> | null;
  /** Has `destroy()` been called? */
  isDestroyed(): boolean;
  /** Snapshot-then-delta listener: fires the current state synchronously, then on
   *  every change. Returns an unsubscribe. */
  onState(cb: (s: SessionState<Prov>) => void): () => void;
  /** Called by the consumer's router/pump after the first RPC roundtrips — the
   *  `connecting → connected` cue the loop can't infer generically. */
  markConnected(): void;
  /** Immediately drop the session regardless of ref count (server shutdown). */
  destroy(): void;
  /** Re-arm a session that gave up (`phase === "failed"`); no-op on a live
   *  link. The manual "Reconnect" trigger. Universal — every session reconnects. */
  reconnect(): void;
  /** Force a fresh link probe (wake / network change) — force-cycles even a
   *  seemingly-`connected` link whose socket may have gone stale across a sleep. */
  recheck(): void;
  /** The bound server's identity off its reserved `system.identity` — a TOTAL,
   *  null-free {@link SurfaceIdentity} sum. `disconnected` before the first successful
   *  connect / between dials; `anonymous`/`identified` once connected (never
   *  null-forever — every server answers `system.identity`). */
  identity(): SurfaceIdentity;
  /** Does this session's transport PROVISION (nix-copy a closure) before
   *  connecting? The runtime twin of the `Prov` TYPE parameter, which is erased at
   *  runtime: `false` for a non-provisioning arm (`Prov = never`, whose
   *  `initialConnection` is always `"connecting"` — it can never legitimately reach
   *  a provisioning phase), `true` for a provisioning arm (ssh, whose
   *  `initialConnection` is its first provisioning phase, `"probing"`). Derived once
   *  at construction from `initialConnection` (`!== "connecting"`), so a generic
   *  consumer (e.g. `serveHostMap`'s juspay/kolu#1716 belt) can ask ANY session
   *  directly — no app-nominated "the local one" key required, and a pool with more
   *  than one non-provisioning member is covered, not just a single key. */
  readonly provisions: boolean;
}

/** How a live connection ended — the RAW transport signal the loop classifies (it
 *  alone knows whether the link was `connected`, and whether it initiated the
 *  teardown). A CLOSED union over the ways a transport dies, so each cause has ONE
 *  honest shape — no magic exit-code sentinel, no both-null `exit` overload:
 *
 *   - `exit`             — a real PROCESS death: the child exited with a numeric
 *                           `code` (`signal` null) or was killed by a `signal`
 *                           (`code` null). Exactly one of the pair is non-null,
 *                           per Node's `exit` event.
 *   - `transport-failed` — the ssh TRANSPORT itself failed (connection error / a
 *                           dropped link): ssh exits 255 for its OWN connection
 *                           failures, so `sshConnector` maps a REMOTE 255 to this
 *                           variant rather than leaking a magic `code === 255`
 *                           literal into this transport-agnostic loop. Classified
 *                           `"network"` (retry forever). Localhost has no ssh, so a
 *                           localhost 255 stays an honest `exit` (→ bounded
 *                           `"remote"`), fixing the old uniform-255 misread.
 *   - `endpoint-down`    — a NON-process endpoint link death: an in-process daemon
 *                           endpoint reported degraded/dead with NO child process,
 *                           so neither a code nor a signal exists. Its own variant
 *                           so "endpoint down" is not the both-null `exit`
 *                           inhabitant (which described an exit that never happened).
 *   - `spawn-error`      — the transport couldn't even START (a local/config fault);
 *                           always terminal-ish `"remote"`. */
export type ClosedInfo =
  | { kind: "exit"; code: number | null; signal: NodeJS.Signals | null }
  | { kind: "transport-failed" }
  | { kind: "endpoint-down" }
  | { kind: "spawn-error"; message: string };

/** A single live connection attempt, handed back by a connector once the transport
 *  is up (the `connecting` phase — client built, first RPC not yet seen). */
export interface Connection<Client> {
  /** The live client for THIS attempt. */
  client: Client;
  /** Resolves when THIS attempt's link dies. The loop awaits it to reconnect. */
  closed: Promise<ClosedInfo>;
  /** Probe THIS connection's liveness — the watchdog's per-transport probe. A
   *  rejection still counts as alive (the round-trip completed); only a true
   *  non-answer (timeout) is stale. Defaults to `system.live` for a plain client. */
  isAlive(): Promise<void>;
  /** OPTIONAL same-box life-oracle — the arm-structural distinction a LOCAL
   *  (stdio/endpoint) arm has that a REMOTE (ssh) arm cannot (P5: the guarantee
   *  belongs at the knowing endpoint). When the watchdog's {@link isAlive} round-trip
   *  goes SILENT, a remote arm has no recourse but to read silence as death — the
   *  network can die silently. A local arm can do better: it reads the same-box
   *  process table directly. So the LOCAL endpoint connector supplies this synchronous
   *  predicate (the padi process is alive) BY CONSTRUCTION; the ssh connector OMITS it
   *  (absent ≡ "no oracle better than the heartbeat" — today's semantics, exactly). On
   *  a heartbeat timeout the watchdog consults it: alive → the link is merely SLOW
   *  under load, not dead, so it keeps probing instead of force-cycling (bounded by
   *  {@link LOCAL_LIVENESS_DEAD_MAN_CEILING_MS}); dead → force-cycle at once. This is
   *  arm STRUCTURE, never a tuning knob — the distinction rides which connector built
   *  the connection, not a mode flag. */
  processAlive?: () => boolean;
  /** Force-tear-down THIS connection (recheck / connect-timeout / destroy). Routes
   *  through `closed` — so the loop's reconnect/give-up machinery runs once. */
  teardown(): void;
}

/** The per-attempt context the loop hands a connector: emit provenance-tagged
 *  progress lines, advance the connector's OWN provisioning phases, and signal the
 *  transport is up. The loop owns the state cell; the connector only pushes lines
 *  and drives its phase. Parameterized by the connector's provisioning-phase
 *  vocabulary `Prov` (`= never` for a non-provisioning endpoint — `provisioning`
 *  is then uncallable). */
export interface ConnectContext<Prov extends string = never> {
  /** Push a `local`-tagged progress line — the parent's own provisioning output,
   *  spawn errors, transport start. */
  localProgress(line: string): void;
  /** Push a `remote`-tagged forwarded remote-agent stderr line. */
  remoteProgress(line: string): void;
  /** Advance to one of the connector's OWN provisioning phases (e.g. the ssh
   *  connector's `probing → copying → building`, each at its real command boundary). The
   *  session opens at the connector's first provisioning phase; this moves it
   *  forward through the rest. Uncallable for `Prov = never`. */
  provisioning(phase: Prov): void;
  /** The transport is up and the client is built — move to `connecting`. Called by
   *  the connector before it returns the {@link Connection}. */
  connecting(): void;
}

/** A transport plug: dial ONCE and return a live {@link Connection}, or REJECT with
 *  a {@link ConnectError} classifying a provisioning/resolve failure (`network` =
 *  retry forever, `remote` = bounded → give up). The loop owns everything after.
 *  Parameterized by the connector's provisioning-phase vocabulary `Prov`. */
export type Connector<Client, Prov extends string = never> = (
  ctx: ConnectContext<Prov>,
) => Promise<Connection<Client>>;

/** A connector's rejection: a provisioning/resolve failure it classified itself
 *  (the connector knows the transport). A plain Error rejection is read as
 *  `"network"` (an unreachable-host default). */
export class ConnectError extends Error {
  constructor(
    message: string,
    // NB: NOT `cause` — that shadows the built-in `Error.cause`, which a strict
    // downstream tsconfig (drishti's `noImplicitOverride`) rejects (TS4115). This is
    // the connector's own transport classification, so it gets its own honest name.
    readonly failureCause: "network" | "remote",
  ) {
    super(message);
    this.name = "ConnectError";
  }
}

/** The degraded frame a {@link Admit} `refuse` overlays onto the session state —
 *  the transport is up but the session won't serve this far end (a contract skew a
 *  binder won't speak). Merged into `onState` as a `disconnected` down arm, so a
 *  refusal is a visible cell state, never a swallowed log line; its fields mirror
 *  that arm (`error`/`cause`). */
export interface AdmitRefusal {
  error: string;
  /** Mirrors the down arm's `cause` — pinned to {@link DownSessionState}'s so the "its fields
   *  mirror that arm" promise above is compiler-enforced, not a hand-kept copy (resolves
   *  identically to `"network" | "remote"`, no API change). */
  cause: DownSessionState["cause"];
}

/** An {@link Admit} hook's verdict on a connector's fresh connection — a CLOSED
 *  union (every outcome named; no boolean flags):
 *   - `adopt`         — the far end is who we want; use this connection (the admit
 *                        handshake proved the link live, so the session marks
 *                        connected without waiting for the consumer's first frame).
 *   - `refuse(state)` — reject it and OVERLAY `state` (a degraded frame) onto
 *                        `onState`; the transport stays up (a persistent skew doesn't
 *                        spin a reconnect loop), the client is withheld, and the loop
 *                        re-admits only if the link later dies on its own.
 *   - `replaced`      — this connection was replaced by the admit hook itself (a
 *                        supervisor drained the far end → it exits); reconnect brings
 *                        up the successor. */
export type AdmitVerdict =
  | { kind: "adopt" }
  | { kind: "refuse"; state: AdmitRefusal }
  | { kind: "replaced"; reason: string };

/** Admit (or reject) a connector's fresh connection before the session adopts it —
 *  the SUPERVISION seam a daemon session plugs its convergence into (padi's
 *  control-core hello + skew/build decision + drain enactment). Runs once per dial,
 *  after the transport is up (the client is live). Omitted → every connection is
 *  adopted (the plain ssh/agent case). The hook may itself act on the far end (drain
 *  it) before returning `replaced`; a rejection FROM the hook is treated as a link
 *  failure (the handshake RPC died mid-flight) → reconnect. */
export type Admit<Client> = (client: Client) => Promise<AdmitVerdict>;

export interface MakeSessionOptions<Client, Prov extends string = never> {
  /** The transport plug — dial once, hand back a live {@link Connection}. */
  connectOnce: Connector<Client, Prov>;
  /** The connector's OPENING phase — the fact only the connector knows (P5). Its
   *  TYPE is `[Prov] extends [never] ? "connecting" : Prov` — EXACTLY the
   *  connector's own TRUE first-dial state, never a state that means "gave up
   *  before ever dialing": the local endpoint connector provisions NOTHING (the
   *  daemon is already here) and opens straight into `"connecting"`, so
   *  `Prov = never` narrows `initialConnection` to EXACTLY `"connecting"` — a
   *  provisioning phase, `"connected"`, `"disconnected"`, and `"failed"` are all
   *  COMPILE errors there (a session that hasn't dialed yet cannot legally BOOT
   *  already live, already given up, or in a phase its connector can never enter —
   *  that would publish a LYING first frame and could misclassify `provisions`
   *  below). An ssh `sshConnector` PROVISIONS (nix-copies the closure first), so
   *  `Prov = "probing" | "copying" | "building"` and `initialConnection` narrows to
   *  EXACTLY `Prov` — the connector opens at its FIRST provisioning phase (`"probing"`) and
   *  advances the rest via `ctx.provisioning`. A provisioning session can no longer
   *  be constructed with a non-provisioning opening phase (juspay/kolu#1808): that
   *  constructible contradiction let `provisions` below (the runtime read of this
   *  same fact, since `Prov` itself is erased) misclassify it. Both the first dial
   *  and every reconnect re-arm at this SAME phase. */
  initialConnection: [Prov] extends [never] ? "connecting" : Prov;
  /** Optional SUPERVISION hook run once per dial after the transport is up — a
   *  daemon session's convergence (padi: control-core hello + skew/build decision +
   *  drain). Omit for a plain session (every connection adopted). See {@link Admit}. */
  admit?: Admit<Client>;
  /** Delay between disconnect and the first reconnect attempt (exponential from
   *  here, capped at 60s). Default 2s. */
  reconnectDelayMs?: number;
  /** How long to wait for `markConnected` after the transport comes up before
   *  treating `connecting` as wedged and tearing the connection down (routes
   *  through the normal reconnect path). Default 30s. */
  connectTimeoutMs?: number;
  /** Disable the periodic liveness watchdog (default ON). While `connected`, the
   *  watchdog races the connection's `isAlive` probe against a timeout; a true
   *  non-answer force-cycles the link (a silently half-open socket). An object
   *  tunes the cadence — so the illegal "tune a disabled watchdog" state is
   *  unrepresentable. */
  liveness?: false | { intervalMs?: number; timeoutMs?: number };
  /** Where the session's diagnostic lines go — default `process.stderr`. An
   *  alt-screen consumer passes its own sink so lines never corrupt the render. */
  onLog?: (line: string) => void;
  /** Label for diagnostic lines (`[<label>] …`) — e.g. the host. Default `session`. */
  label?: string;
}

/**
 * Build a reconnect-mirror session over a transport connector. Owns the whole
 * durable lifecycle: pin/ref-count, backoff + give-up, the connect watchdog, the
 * liveness watchdog, `recheck`/`reconnect`, the state cell, and the `system.identity`
 * poll. Returns the {@link Session} role — a plain object (closures), so a daemon
 * flavor is derived by spreading supervision members onto it (no wrapper class).
 */
export function makeSession<
  Client = SurfaceClientLike,
  Prov extends string = never,
>(opts: MakeSessionOptions<Client, Prov>): Session<Client, Prov> {
  const label = opts.label ?? "session";
  const reconnectDelayMs = opts.reconnectDelayMs ?? 2000;
  const connectTimeoutMs = opts.connectTimeoutMs ?? 30_000;
  // The runtime twin of `Prov` (erased at runtime, so this is the only witness
  // left standing at construction time). This is no GUESS from the initial state's
  // incidental value: `MakeSessionOptions.initialConnection`'s TYPE
  // (`[Prov] extends [never] ? "connecting" : Prov`) makes a NON-provisioning arm's
  // `initialConnection` EXACTLY `"connecting"` and a provisioning arm's EXACTLY its
  // first provisioning phase (juspay/kolu#1808) — so "opens at anything but
  // `connecting`" is precisely "provisions", and a provisioning session with a
  // non-provisioning opening phase is a COMPILE error this test could never be
  // fooled by.
  const provisions = opts.initialConnection !== "connecting";

  let refCount = 0;
  let destroyed = false;
  let consecutiveFailures = 0;
  /** The single pending phase-transition timer — either the reconnect-backoff delay
   *  (armed in `disconnected`) or the connect watchdog (armed in `connecting`). The
   *  two are never live at once, so folding them into one slot makes "at most one
   *  timer pending" a structural invariant. */
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** The in-flight/current client promise (or `null` between a link death and the
   *  backoff timer firing). Each dial reassigns it, so the pump's cursor advances on
   *  identity. */
  let clientPromise: Promise<Client> | null = null;
  /** The live connection handle for the current spawn (its `teardown` + `isAlive`),
   *  or `null` when no link is up. */
  let current: Connection<Client> | null = null;
  /** Set by `recheck()` before it tears down a live connection, so the closed
   *  handler labels that self-inflicted teardown a `"network"` retry (recovery, not
   *  a budget-consuming fault). Consumed in the closed handler. */
  let cyclingForRecheck = false;
  /** Set by the connect watchdog when it tears down a wedged `connecting`, so the
   *  closed handler reports a bounded `"remote"` timeout (a broken handshake fails
   *  loudly instead of spinning). */
  let connectTimedOut = false;
  /** Monotonic dial generation, bumped per (re)dial. The async `system.identity` probe
   *  captures it and refuses to write `cachedIdentity` once superseded — so a slow
   *  probe from a dead link can't clobber a newer dial's identity if it resolves late
   *  (rather than rejecting). */
  let dialEpoch = 0;
  /** The periodic liveness watchdog handle (ONE `@kolu/surface/heartbeat`), or
   *  `null` until first connect / after teardown. */
  let liveness: { dispose: () => void } | null = null;
  /** The CURRENT connection's liveness EPISODE — its two coupled probe fields, born
   *  and retired WITH `current` (created by {@link setCurrent}, nulled wherever
   *  `current` is nulled) so neither field can leak onto a replacement link:
   *   - `inFlight`: the single in-flight `isAlive` round-trip, or `null` when none is
   *     pending. Caps concurrency to ONE probe per connection — during the local arm's
   *     hold-off (a slow padi kept alive across repeated stale cycles) the heartbeat's
   *     timer re-fires every cycle, but a fresh `hello()` would pile onto the already-
   *     struggling process, so we REUSE this pending probe instead of launching another.
   *   - `unresponsiveSince`: LOCAL arm only — when its heartbeat first went SILENT while
   *     the {@link Connection.processAlive} oracle still reported the padi alive (the start
   *     of the dead-man ceiling window). `null` whenever the link is answering (reset by
   *     any completed probe). Unused by the ssh arm (no oracle → it force-cycles on the
   *     first silence).
   *  `null` when no link is up. Because both fields share `current`'s lifetime in ONE
   *  record, the connection-boundary reset is a single `episode = null` — a future path
   *  can't half-reset it (the old scatter's fourth-site bug becomes unrepresentable). */
  let episode: {
    inFlight: Promise<void> | null;
    unresponsiveSince: number | null;
  } | null = null;
  /** The bound server's served identity off its `system.identity`, or `null` before
   *  the first successful poll / after a link death (re-polled on the next connect,
   *  so a respawned server's fresh identity lands). `null` here is the INTERNAL
   *  "not-yet-polled" state; the public `identity()` maps it to the `disconnected`
   *  arm of the null-free {@link SurfaceIdentity} sum. */
  let cachedIdentity: ServedIdentity | null = null;
  /** When the CURRENT episode began (server clock), re-stamped on every down→up
   *  crossing (a fresh dial after disconnect/failed). The single source `sinceMs`
   *  (the published DURATION) and the per-episode `log` reset both derive from it;
   *  it stays server-INTERNAL — only the duration crosses the wire (P3: no foreign
   *  epoch for a browser to subtract). */
  let episodeStartedAt = Date.now();
  /** `now − episodeStartedAt` — the duration stamped on every published frame. */
  const since = (): number => Date.now() - episodeStartedAt;

  /** Adopt `conn` as the live connection and open a FRESH liveness episode for it.
   *  `current` and its `episode` share ONE lifetime, so every adopt site goes through
   *  here — no episode is ever left over from the prior link, and the three set-sites
   *  don't triplicate the init. */
  const setCurrent = (conn: Connection<Client>): void => {
    current = conn;
    episode = { inFlight: null, unresponsiveSince: null };
  };

  // The opening frame is ALWAYS an up arm (`initialConnection`'s type now
  // guarantees this — never a state that means "gave up before dialing"), so it
  // carries no error fields to begin with. `initialConnection` is a valid up phase
  // for THIS `Prov` by its type; the cast lets the generic construct the up arm.
  const stateCell = inMemoryCell<SessionState<Prov>>({
    phase: opts.initialConnection,
    log: [],
    sinceMs: 0,
  } as SessionState<Prov>);

  const emit = (line: string): void => {
    if (opts.onLog) {
      try {
        opts.onLog(line);
      } catch (err) {
        // A throwing sink must not escape the diagnostic funnel and freeze the
        // session; surface the sink's own failure on stderr so it isn't swallowed.
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[${label}] onLog sink threw: ${reason}\n`);
      }
    } else {
      process.stderr.write(`${line}\n`);
    }
  };

  const clearTimer = (): void => {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const armTimer = (delayMs: number, fn: () => void): void => {
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      fn();
    }, delayMs);
  };

  /** Bound the `admit` handshake by the SAME `connectTimeoutMs` the non-admit path's
   *  connect watchdog uses. `admit` does a control-core `hello()` over the transport; a
   *  wedged daemon (process up but the first `hello()` never settles) would otherwise
   *  hang this `await` forever — hanging `pin()` and leaking `conn` with no watchdog to
   *  trip. On timeout, reject a `"network"` {@link ConnectError} so `attempt`'s
   *  admit-catch tears `conn` down and reconnects — the admit-path twin of the
   *  `connecting`-phase watchdog (S9 parity). Clears its own timer on settle (its own
   *  slot, NOT the shared `pendingTimer` — the phase timer isn't armed yet here). */
  const withHandshakeTimeout = <T>(p: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new ConnectError(
            `admit handshake timed out after ${connectTimeoutMs}ms (transport up, hello never settled)`,
            "network",
          ),
        );
      }, connectTimeoutMs);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });

  const logTransition = (from: string, to: string): void => {
    if (from !== to) emit(`[${label} local] connection: ${from} → ${to}`);
  };

  // Leaving `connecting` by any path disarms the connect watchdog — one
  // choke-point both arm-transition helpers below call through, so the
  // closed/markConnected paths don't each clear it.
  const disarmConnectWatchdog = (from: string, to: string): void => {
    logTransition(from, to);
    if (from === "connecting" && to !== "connecting") clearTimer();
  };

  /** Append a provenance-tagged line to the CURRENT episode's log tail (last
   *  {@link MAX_PROGRESS_LINES}) — the ONE place the tail grows, so `local` and
   *  `remote` origins share the cap. Re-stamps `sinceMs` so each log line also
   *  freshens the published duration. */
  const pushLog = (source: LogEntry["source"], line: string): void => {
    const prev = stateCell.current();
    stateCell.set({
      ...prev,
      log: [...prev.log, { source, line }].slice(-MAX_PROGRESS_LINES),
      sinceMs: since(),
    } as SessionState<Prov>);
  };

  /** Transition to an UP arm (`connecting`/`connected`/a provisioning `Prov`, e.g.
   *  `"probing"`/`"copying"`/`"building"`) — constructed with EXACTLY its fields: no
   *  `error`/`cause` (the up arm has none to carry, stale or otherwise). A down→up
   *  crossing (`prev` is `disconnected`/`failed`) STARTS A FRESH EPISODE: it
   *  re-stamps the episode clock (so `sinceMs` resets toward 0) and DROPS the prior
   *  episode's `log` (so the overlay never shows stale lines under a fresh timer).
   *  Within an episode (up→up phase-flips) the log carries forward and the clock
   *  keeps running. */
  const setUp = (phase: "connecting" | "connected" | Prov): void => {
    const prev = stateCell.current();
    disarmConnectWatchdog(prev.phase, phase);
    const fresh = prev.phase === "disconnected" || prev.phase === "failed";
    if (fresh) episodeStartedAt = Date.now();
    stateCell.set({
      phase,
      log: fresh ? [] : prev.log,
      sinceMs: since(),
      // The `connected` arm ALONE carries `clockOffset`, born `null` here (offset-at-
      // hello: the frame is honest that it hasn't measured yet) and re-stamped by
      // `pollClockNow` once the reserved `system.clockNow` probe resolves. Other up
      // arms have no such field.
      ...(phase === "connected" ? { clockOffset: null } : {}),
    } as SessionState<Prov>);
  };

  /** Transition to a DOWN arm (`disconnected`/`failed`) — `error` + `cause` are
   *  REQUIRED parameters, supplied EXPLICITLY by the caller (never spread-inherited
   *  from `prev`, which may itself be an up arm with no error fields to inherit, or
   *  carry a stale reason from an earlier episode) — so a down transition can never
   *  omit or invent a reason. `failed`'s `cause` is forced to the `"remote"`
   *  literal the type demands (a `"network"` fault never gives up); the `log` tail
   *  carries forward (the failed episode's lines stay readable until the next dial
   *  resets them). */
  const setDown = (
    phase: "disconnected" | "failed",
    error: string,
    cause: "network" | "remote",
  ): void => {
    const prev = stateCell.current();
    disarmConnectWatchdog(prev.phase, phase);
    emit(`[${label}] error: ${error}`);
    stateCell.set(
      phase === "failed"
        ? { phase, error, cause: "remote", log: prev.log, sinceMs: since() }
        : { phase, error, cause, log: prev.log, sinceMs: since() },
    );
  };

  const localProgress = (line: string): void => {
    emit(`[${label} local] ${line}`);
    pushLog("local", line);
  };

  const remoteProgress = (line: string): void => {
    emit(`[${label} remote] ${line}`);
    pushLog("remote", line);
  };

  /** The watchdog's force-cycle action — the ONE "give up on this link" step:
   *  announce `reason` on the local log, then `recheck()` (tear the link down and
   *  redial). The three `onStale` cycling branches differ only in their reason
   *  string, so log-then-recheck lives here once. Touches NO episode state — the
   *  connection-boundary reset in `handleClosed` owns that. */
  const forceCycle = (reason: string): void => {
    localProgress(reason);
    session.recheck();
  };

  const startLiveness = (): void => {
    if (opts.liveness === false || liveness !== null) return;
    const tuning = typeof opts.liveness === "object" ? opts.liveness : {};
    liveness = createHeartbeat({
      intervalMs: tuning.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
      timeoutMs: tuning.timeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS,
      isLive: () =>
        !destroyed &&
        stateCell.current().phase === "connected" &&
        current !== null,
      probe: () => {
        const conn = current;
        // `conn` and `episode` share one lifetime (both set by `setCurrent`, both
        // nulled together), so a non-null `conn` implies a non-null `episode`; the
        // combined guard narrows the type without inventing an impossible branch.
        if (conn === null || episode === null)
          return Promise.reject(new Error("no connection"));
        const ep = episode;
        // Cap concurrency to ONE outstanding round-trip: while a probe is still in
        // flight (a genuinely slow padi, mid hold-off), the heartbeat re-fires its timer
        // each cycle — reuse the pending probe rather than piling a fresh `hello()` onto
        // the already-struggling process every ~25s. The reused promise still times out
        // against the heartbeat each cycle (so `onStale` keeps re-checking the ceiling).
        if (ep.inFlight !== null) return ep.inFlight;
        // Guard the ceiling-clock reset against a STRAGGLING settle from a superseded
        // dial: `conn.isAlive()` is never cancelled, so it can resolve/reject arbitrarily
        // late — after `current` has moved to a fresh connection mid-way through its OWN
        // dead-man countdown. Capture the connection + dial generation and reset only if
        // both still match (mirrors `pollIdentity`'s epoch guard below); a late settle
        // from a torn-down probe must not wipe a newer connection's clock.
        const connAtLaunch = conn;
        const epoch = dialEpoch;
        const probe: Promise<void> = conn.isAlive().finally(() => {
          // Clear only if still OURS — a stale settle must not null out a newer probe's
          // in-flight tracking. `ep` is this connection's episode record; once the
          // connection is retired the record is detached, so writing it is inert.
          if (ep.inFlight === probe) ep.inFlight = null;
          // A COMPLETED round-trip (even a rejection) proves the link answered, so the
          // local arm's "alive-but-silent" ceiling clock resets — the slow spell passed.
          // Harmless for the ssh arm, which never reads the clock.
          if (current === connAtLaunch && dialEpoch === epoch) {
            ep.unresponsiveSince = null;
          }
        });
        ep.inFlight = probe;
        return probe;
      },
      onStale: () => {
        if (destroyed) return;
        const oracle = current?.processAlive;
        // REMOTE arm (no same-box oracle): a silent heartbeat is its ONLY life-signal,
        // and the network can die silently — so silence means death: force-cycle.
        // Today's semantics, provably untouched.
        if (oracle === undefined) {
          forceCycle(
            "liveness probe timed out — remote wedged, force-cycling the link",
          );
          return;
        }
        // LOCAL arm: `current` is non-null (its `processAlive` is the `oracle`), so its
        // `episode` is non-null too (they share one lifetime); the guard narrows the type.
        const ep = episode;
        if (ep === null) return;
        // Consult the same-box process table — the superior oracle (P5).
        if (!oracle()) {
          // The padi process is genuinely gone → force-cycle now; reconnect heals.
          forceCycle(
            "liveness probe timed out and the local padi process has exited — force-cycling the link",
          );
          return;
        }
        // Alive but heartbeat-silent ≡ SLOW under load, not dead — do NOT force-cycle;
        // keep probing. The dead-man ceiling bounds it so an alive-but-never-answering
        // (deadlocked) padi still heals.
        //
        // Measured on the MONOTONIC clock (`monotonicNow`, the same clock
        // `createHeartbeat` reads), never wall time: `onStale` only ever fires over a
        // continuously-RUNNING probe window (the heartbeat VOIDS a suspension-straddling
        // window and re-probes without calling us — heartbeat.ts § SUSPENSION_SLACK_MS),
        // so the ceiling must accrue only running time too. Wall time (`Date.now`) would
        // fold a laptop sleep / clock step INTO the silent span and force-cycle a merely-
        // resumed-but-alive padi on the first post-wake stale — re-introducing the exact
        // suspension-induced false recovery this arm exists to prevent. On the monotonic
        // clock, suspended time never counts, so a resumed padi gets its full running-time
        // grace before the ceiling bites.
        const now = monotonicNow();
        ep.unresponsiveSince ??= now;
        const silentForMs = now - ep.unresponsiveSince;
        if (silentForMs >= LOCAL_LIVENESS_DEAD_MAN_CEILING_MS) {
          forceCycle(
            `local padi alive but heartbeat-silent for ${silentForMs}ms (≥ dead-man ceiling) — force-cycling the link`,
          );
          return;
        }
        localProgress(
          "liveness probe slow but the local padi process is alive — not cycling (load, not death)",
        );
      },
    });
  };

  const stopLiveness = (): void => {
    if (liveness !== null) {
      liveness.dispose();
      liveness = null;
    }
  };

  const scheduleReconnect = (
    cause: "network" | "remote",
    reason: string,
  ): void => {
    if (destroyed || pendingTimer !== null) return;
    // A stale (rejected) `clientPromise` during backoff keeps `launchAttempt`
    // idempotent — an acquire/pin during the wait won't start a second concurrent
    // dial. The terminal give-up branch clears it (no timer to act as the guard).
    const attemptsSoFar = consecutiveFailures;
    consecutiveFailures += 1;
    if (cause === "remote" && consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      localProgress(
        `gave up after ${MAX_CONSECUTIVE_FAILURES} consecutive failures — fix the underlying issue (often: remote nix-daemon needs your user in 'trusted-users' to accept unsigned closures), then reconnect`,
      );
      clientPromise = null;
      // EXPLICIT carry-forward: `reason` is the SAME real failure that just put
      // the session `disconnected` (the only path into this give-up branch) —
      // passed by the caller, never spread-inherited from `prev` (which the
      // discriminated union no longer lets us do blindly for an up arm anyway).
      setDown("failed", reason, cause);
      return;
    }
    const delay = Math.min(reconnectDelayMs * 2 ** attemptsSoFar, 60_000);
    localProgress(
      cause === "network"
        ? `host unreachable — retrying in ${delay}ms… (attempt ${consecutiveFailures})`
        : `reconnecting in ${delay}ms… (attempt ${consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES})`,
    );
    armTimer(delay, () => {
      if (destroyed || refCount === 0) return;
      launchAttempt();
    });
  };

  const handleClosed = (conn: Connection<Client>, info: ClosedInfo): void => {
    // Stale close from a connection we already replaced/tore down — ignore.
    if (conn !== current) return;
    // Retire this connection's liveness EPISODE with the connection itself. The
    // heartbeat is session-scoped (born once at the first connect, disposed only at
    // `destroy`), so the per-connection probe state — the concurrency-capped `inFlight`
    // probe and the dead-man `unresponsiveSince` clock — MUST go down with the
    // connection, or it leaks onto the REPLACEMENT: a probe that never settled on the
    // dead link would still be cached, so the heartbeat would hand the fresh connection
    // the old link's forever-pending promise (the `probe` reuse above) instead of ever
    // calling the new `isAlive()` — force-cycling a healthy successor (immediately for
    // the ssh arm, after the ceiling for the local arm). Because `episode` shares
    // `current`'s lifetime, nulling both together retires BOTH fields in ONE move — no
    // boundary path can half-reset it. A late settle from the now-retired probe is
    // inert: its captured episode is detached, and its `current === connAtLaunch` check
    // fails.
    current = null;
    episode = null;
    const wasConnected = stateCell.current().phase === "connected";
    let reason: string;
    let cause: "network" | "remote";
    if (cyclingForRecheck) {
      // We tore this down ourselves to re-probe after a wake/network change — a
      // transient recovery, retry as `"network"` so it never counts toward the
      // bounded give-up budget (even mid-`connecting`).
      cyclingForRecheck = false;
      reason = "rechecking link after wake/network change — cycled the link";
      cause = "network";
    } else if (connectTimedOut) {
      // Transport came up but the agent never answered the first RPC — wedged, not
      // unreachable. Bounded (`"remote"`) so a broken startup fails loudly.
      connectTimedOut = false;
      reason = `connect handshake timed out after ${connectTimeoutMs}ms (transport up, no first RPC)`;
      cause = "remote";
    } else if (info.kind === "spawn-error") {
      // The transport couldn't even start — a local/config problem. Bounded.
      reason = `transport failed to spawn: ${info.message}`;
      cause = "remote";
    } else if (info.kind === "transport-failed") {
      // The ssh TRANSPORT itself failed (a connection error, ssh's own exit 255,
      // or a dropped link — the connector classified it, so no magic literal
      // lives here). Transport → retry forever.
      reason =
        "ssh transport connection failed — host unreachable or link dropped";
      cause = "network";
    } else if (info.kind === "endpoint-down") {
      // A non-process endpoint link death (no child, so no exit code/signal). A
      // dropped LIVE link retries as transport; a death BEFORE we ever connected
      // is the endpoint refusing to come up — bounded.
      reason = "endpoint link down (no process exit)";
      cause = wasConnected ? "network" : "remote";
    } else {
      reason = `agent exited (code=${info.code}, signal=${info.signal})`;
      // A live link that dropped is transport — retry forever. An exit BEFORE we
      // ever connected means the transport ran the agent and IT exited (bad path,
      // missing exe, startup crash) — bounded. (An ssh transport-255 arrives as
      // `transport-failed` above, not here, so 255 is no longer magic-matched: a
      // real agent that exits 255 is now honestly bounded, and a localhost 255 —
      // which has no ssh transport — no longer misreads as a network fault.)
      cause = wasConnected ? "network" : "remote";
    }
    localProgress(reason);
    setDown("disconnected", reason, cause);
    clientPromise = null;
    // The link is down — identity() must report `disconnected`, and the next
    // connect re-polls (a respawned server may be a different build).
    cachedIdentity = null;
    if (!destroyed && refCount > 0) scheduleReconnect(cause, reason);
  };

  const attempt = async (): Promise<Client> => {
    dialEpoch += 1;
    // A fresh dial reopens at the connector's opening phase — always an up arm
    // (no stale error to clear: there is no field for one).
    setUp(opts.initialConnection);
    let conn: Connection<Client>;
    try {
      conn = await opts.connectOnce({
        localProgress,
        remoteProgress,
        provisioning: (phase) => setUp(phase),
        connecting: () => setUp("connecting"),
      });
    } catch (err) {
      const cause: "network" | "remote" =
        err instanceof ConnectError ? err.failureCause : "network";
      const reason = err instanceof Error ? err.message : String(err);
      setDown("disconnected", reason, cause);
      scheduleReconnect(cause, reason);
      throw err instanceof Error ? err : new Error(reason);
    }
    // Wire this connection's death once, up front, so every path below (adopt /
    // refuse) routes a later link drop through the same reconnect machinery.
    const wireClosed = (): void => {
      conn.closed
        .then((info) => handleClosed(conn, info))
        .catch(() => {
          /* `closed` never rejects — the handler owns the outcome */
        });
    };

    // Supervision gate (S9): a daemon session ADMITS the fresh connection — padi's
    // control-core hello + skew/build convergence. No admit → adopt every connection.
    if (opts.admit !== undefined) {
      let verdict: AdmitVerdict;
      try {
        verdict = await withHandshakeTimeout(opts.admit(conn.client));
      } catch (err) {
        // The admit handshake RPC itself died (a link blip mid-hello) OR timed out (a
        // wedged daemon — see `withHandshakeTimeout`). Treat as a link failure and
        // reconnect (`network` — recovery, never a give-up spiral).
        const reason = err instanceof Error ? err.message : String(err);
        conn.teardown();
        setDown("disconnected", reason, "network");
        scheduleReconnect("network", reason);
        throw err instanceof Error ? err : new Error(reason);
      }
      if (verdict.kind === "refuse") {
        // The transport is up but we won't serve this far end (a skew). KEEP the
        // connection (a later death re-admits), OVERLAY the degraded frame onto
        // `onState`, WITHHOLD the client (the cursor waits on the rejected promise),
        // and DON'T reconnect — a persistent skew holds degraded, it doesn't spin.
        // Reset the give-up budget: the hello proved the transport, this is not a
        // failure spiral. (Dissolves the old wrapper's separate state-overlay.)
        //
        // INVARIANT (a downstream projection rides on it — `@kolu/surface-map`'s
        // `projectStatus` discriminates a STANDING refuse from a TRANSIENT reconnect on
        // cause-specificity): this `disconnected` is a STANDING degraded state that will
        // NOT come back on its own (redialing can't unmake a skew / a foreign
        // supervisor). A refuse MUST therefore be accompanied by a SPECIFIC domain cause
        // on the down state (the daemon binder's `entryFailedDetail()` — cross-supervisor
        // / contract-skew-refused / unconverged), whereas a plain TRANSIENT link drop
        // (`setDown("disconnected", …)` from `handleClosed`/reconnect) carries NONE and
        // falls back to `"other"`. Keep that split intact: a refuse without a specific
        // cause would be mis-projected as warming (a lying "coming back up"). Pinned in
        // `remotePadiBinding.test.ts` (the "PROJECTION INVARIANT" tests). The
        // still-cleaner future shape — a SessionState arm that types standing-refuse
        // apart from transient-disconnected — is on the padi-cleanup ledger.
        setCurrent(conn);
        wireClosed();
        consecutiveFailures = 0;
        setDown("disconnected", verdict.state.error, verdict.state.cause);
        throw new Error(verdict.state.error);
      }
      if (verdict.kind === "replaced") {
        // The admit hook drained the far end (it exits); tear the old link down and
        // reconnect to bring up the successor (`network` — a converge, not a fault).
        // The admit hello proved the transport live, so reset the give-up budget —
        // a bounded drain→respawn treadmill (fenced by the arm) must not grow the
        // backoff toward give-up, matching the pre-S9 markConnected-before-drain.
        consecutiveFailures = 0;
        conn.teardown();
        setDown("disconnected", verdict.reason, "network");
        scheduleReconnect("network", verdict.reason);
        throw new Error(verdict.reason);
      }
      // adopt: the hello proved the link live. Take the connection, wire its death,
      // and enter `connected` NOW — no connect-watchdog needed (the link is proven).
      // Call `enterConnected` DIRECTLY, never `markConnected`: its `connecting`-only
      // guard would SILENTLY no-op — stranding this proven-live link — if the connector
      // returned without first calling `ctx.connecting()`. The connector IS contracted
      // to signal `connecting`; a breach is surfaced loudly here, but the transition
      // still completes (the admit hello proved the link, so `connected` is correct).
      // A later consumer `markConnected` is a harmless no-op (state is `connected`).
      setCurrent(conn);
      wireClosed();
      if (stateCell.current().phase !== "connecting") {
        emit(
          `adopt: connector returned a live link without signalling 'connecting' ` +
            `(state was '${stateCell.current().phase}') — forcing 'connected'; ` +
            "fix the connector to call ctx.connecting() before returning",
        );
      }
      enterConnected();
      return conn.client;
    }

    setCurrent(conn);
    // Defer `connected` until the first RPC roundtrips — the consumer signals that
    // via `markConnected()`; the connector's client has no synchronous "open".
    wireClosed();
    // Connect watchdog: transport up, but the first RPC may never roundtrip
    // (handshake wedges, process never exits). `markConnected`/`closed` are the only
    // other exits from `connecting`; without this the session hangs there forever.
    armTimer(connectTimeoutMs, () => {
      if (stateCell.current().phase !== "connecting") return;
      connectTimedOut = true;
      current?.teardown();
    });
    return conn.client;
  };

  const launchAttempt = (): void => {
    clientPromise = attempt();
    clientPromise.catch(() => {
      /* failure surfaces via the state cell; we just clear the promise */
    });
  };

  const ensureSpawned = (): Promise<Client> => {
    if (clientPromise === null) clientPromise = attempt();
    return clientPromise;
  };

  const pollIdentity = (client: Client): void => {
    // Poll the reserved `system.identity` off the fresh client (like the liveness
    // probe reads `system.live`). A rejection (an older server, a link blip) leaves
    // the last-known identity in place — an honest degrade, never a fabricated one.
    const epoch = dialEpoch; // this dial's generation — a later dial supersedes it
    probeSurfaceIdentity(client)
      .then((id) => {
        // Drop a probe that resolved AFTER its dial was superseded (a slow probe from a
        // now-dead link landing after a reconnect) — writing it would clobber the live
        // dial's identity with a stale one. Usually the dead transport rejects instead,
        // but nothing guarantees that, so guard the write on the generation.
        if (destroyed || epoch !== dialEpoch) return;
        cachedIdentity = id;
        // The identity probe resolves on its OWN clock — a separate RPC fired from
        // `markConnected`, decoupled from the `connected` frame that was already
        // published (which sampled the pre-probe `disconnected` identity). Republish
        // the current state (no field change) to wake `onState` listeners, so a
        // consumer that derives PUBLISHED state from `identity()` inside `onState`
        // (kolu-server's padi uptime / surface version / build commit) resamples the
        // now-`identified` value. Without this, that readout would stay stale until an
        // unrelated transition. The pre-S9 binding set identity SYNCHRONOUSLY on the
        // `connected` frame (its `onState` fired with identity already in hand), so
        // this restores that parity across the async-probe boundary.
        stateCell.set({ ...stateCell.current() });
      })
      .catch(() => {
        /* no identity this cycle — keep the last-known; never fabricate one */
      });
  };

  const pollClockNow = (client: Client): void => {
    // Measure the far-end clock offset off the framework-reserved `system.clockNow`
    // (the clock twin of the `system.identity` poll above) and stamp it onto the LIVE
    // `connected` frame. Fired once per admit — offset-at-hello IS the contract, no
    // continuous drift correction. This replaces the app-side hand-measurement the padi
    // binders did (`measureClockOffset` over the padi-specific `control.core.clockNow`):
    // the offset now rides the session's OWN connected state, so a keyed `SurfaceMap`
    // reads it there with no injected `offsetOf`.
    const epoch = dialEpoch; // this dial's generation — a later dial supersedes it
    measureSurfaceClockOffset(client)
      .then((clockOffset) => {
        // Drop a probe that resolved AFTER its dial was superseded (a slow probe from a
        // now-dead link landing after a reconnect) — mirrors `pollIdentity`'s epoch
        // guard. The `connected` guard covers a terminal `failed` (no redial, so no
        // epoch bump): a non-connected frame has no `clockOffset` to write.
        if (destroyed || epoch !== dialEpoch) return;
        const cur = stateCell.current();
        if (cur.phase !== "connected") return;
        stateCell.set({
          phase: "connected",
          clockOffset,
          log: cur.log,
          sinceMs: since(),
        } as SessionState<Prov>);
      })
      .catch((err) => {
        // No offset this cycle — the frame stays `clockOffset: null` (never fabricate a
        // 0). But a probe failure is DIAGNOSED, never silently swallowed (the contract the
        // old `measureClockOffset` line-sink carried): a serveHostMap consumer reads a null
        // offset as still `connecting`, so a probe that keeps failing must be visible in the
        // session log rather than leaving the entry warming for a reason nothing recorded.
        const reason = err instanceof Error ? err.message : String(err);
        emit(`[${label}] clock offset probe failed: ${reason}`);
      });
  };

  /** The `connecting` → `connected` transition body — factored out so BOTH the
   *  consumer-facing {@link markConnected} (which GUARDS on the current state) and
   *  the adopt path (which has ALREADY proven the link live via the admit hello)
   *  share ONE definition. The adopt path calls this DIRECTLY: routing it through
   *  `markConnected`'s `connecting`-only guard would SILENTLY no-op — and strand a
   *  proven-live link in its pre-connecting state forever — whenever a connector
   *  skipped `ctx.connecting()`. Idempotent across reconnects (`setUp`/`startLiveness`
   *  both are). */
  const enterConnected = (): void => {
    consecutiveFailures = 0;
    setUp("connected");
    // Birth the liveness watchdog at the FIRST successful connect (so it can never
    // probe before the first RPC), and poll the server's identity off the fresh
    // client. Both idempotent across later reconnects.
    startLiveness();
    const p = clientPromise;
    if (p !== null) {
      // Clear a stale identity so a respawned server's fresh one lands (never a
      // stale mix from the old process); re-poll off the current client. The clock
      // offset needs no separate reset — `setUp("connected")` just stamped the frame
      // `clockOffset: null`, and `pollClockNow` re-measures it off the same client.
      cachedIdentity = null;
      // `p` already resolved; `pollIdentity`/`pollClockNow` own their own probe-failure
      // catches, so this catch only absorbs a `p` rejection from a torn-down-mid-
      // microtask link.
      p.then((client) => {
        pollIdentity(client);
        pollClockNow(client);
      }).catch(() => {});
    }
  };

  const session: Session<Client, Prov> = {
    pin() {
      refCount += 1;
      return ensureSpawned();
    },
    currentClient() {
      return destroyed ? null : clientPromise;
    },
    isDestroyed() {
      return destroyed;
    },
    onState(cb) {
      return stateCell.consume({
        onEvent: cb,
        onError: () => {
          /* the cell never errors — onError is required by Channel<T> shape */
        },
      });
    },
    markConnected() {
      // Consumer-facing: the connector's client has no synchronous "open", so the
      // consumer signals the first successful roundtrip here. GUARDED to `connecting`
      // — a later/duplicate call once already `connected` is a deliberate no-op. The
      // adopt path does NOT come through here (it calls `enterConnected` directly).
      if (stateCell.current().phase !== "connecting") return;
      enterConnected();
    },
    destroy() {
      destroyed = true;
      clearTimer();
      stopLiveness();
      current?.teardown();
      current = null;
      episode = null;
      clientPromise = null;
      cachedIdentity = null;
      // Re-publish (no field change) purely to wake `onState` listeners so a cursor
      // blocked on the next client observes `isDestroyed()` and unblocks (the F7 bug).
      stateCell.set({ ...stateCell.current() });
    },
    reconnect() {
      if (destroyed || refCount === 0) return;
      if (clientPromise !== null || pendingTimer !== null) return;
      consecutiveFailures = 0;
      launchAttempt();
    },
    recheck() {
      if (destroyed || refCount === 0) return;
      consecutiveFailures = 0;
      if (current !== null) {
        // A live (connecting/connected) link whose socket may be stale after a
        // sleep. Clear the connect-watchdog and cycle it; `cyclingForRecheck` tells
        // the closed handler to schedule a `"network"` retry (a wake cycle is
        // recovery, never a budget-consuming fault — even mid-`connecting`).
        clearTimer();
        cyclingForRecheck = true;
        current.teardown();
        return;
      }
      if (pendingTimer !== null) {
        // In backoff: cancel the wait, drop the stale (rejected) client handle, and
        // dial now.
        clearTimer();
        clientPromise = null;
        launchAttempt();
        return;
      }
      // No connection, no pending timer: either a dial is genuinely in flight
      // (`probing`/`copying`/`building`, `clientPromise` pending) — leave it — or the session is
      // idle/`failed` (`clientPromise` null) — dial.
      if (clientPromise !== null) return;
      launchAttempt();
    },
    identity(): SurfaceIdentity {
      // TOTAL — never null. No live poll (destroyed, or between dials) is the
      // `disconnected` arm; a polled value is `anonymous`/`identified` verbatim.
      return destroyed || cachedIdentity === null
        ? { kind: "disconnected" }
        : cachedIdentity;
    },
    provisions,
  };

  return session;
}

/** The default `isAlive` probe for a plain surface client — the reserved
 *  `system.live` round-trip. A connector that yields a raw surface client uses this;
 *  a transport with its own liveness (an endpoint) supplies its own. */
export function surfaceLiveProbe(client: unknown): () => Promise<void> {
  return () => probeSurfaceLive(client).then(() => undefined);
}
