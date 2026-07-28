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
 * survivor is *killed*, then a fresh daemon is spawned — every boot exercises
 * kill → `waitForPidGone` → spawn → connect, the exact race #1034 lost, but with
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
  gatePid,
  isHolderLive,
  type Logger,
} from "@kolu/surface-daemon";
import { dialSocket } from "./dialSocket.ts";
import type { DaemonDriver } from "./driver.ts";
import { ENDPOINT_STATES, type EndpointState } from "./endpointStates.ts";
import { type SocketHolder, socketHolders } from "./socketHolder.ts";
import { waitForPidGone } from "./waitForPidGone.ts";

// `ENDPOINT_STATES` / `EndpointState` are the single source of truth for the
// reported state set; they live in the zero-dependency `endpointStates.ts` leaf
// so a browser-shared consumer (kolu's `DaemonStatusSchema`) can derive its enum
// from them without pulling this Node-only module's transport/gate graph. The
// endpoint re-exports them so existing supervisor consumers keep their import.
export { ENDPOINT_STATES, type EndpointState };

type ConnectedMetadata<M> = [M] extends [undefined]
  ? { metadata?: undefined }
  : { metadata: M };

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

/**
 * The soul's `connect` throws THIS — and only this — to tell the endpoint a live
 * survivor is genuinely INCOMPATIBLE (a contract-version skew: the daemon speaks
 * a version this client cannot talk to). It is the one connect failure that
 * proves recycling is safe-and-necessary: retrying can never make an
 * incompatible daemon compatible, and the survivor must be replaced.
 *
 * The endpoint stays soul-agnostic about *what* skew means — it never parses an
 * error message or knows a contract version. It only checks this typed marker:
 * the soul (which owns the handshake) decides "this is skew" and signals it.
 * Every OTHER connect rejection (a transport dial failure, an unreadable
 * handshake read) is NON-skew — possibly transient — so `adoptOrEnsure` retries
 * it and, if it persists, refuses to kill the live survivor (F4): a daemon we
 * merely cannot reach right now is not proven incompatible, and killing it would
 * destroy the live PTYs adoption exists to preserve.
 */
export class DaemonContractSkewError extends Error {
  readonly isContractSkew = true as const;
  /** Which contract flavor skewed ("pty-host", "padiSurface") — a readable
   *  FIELD, so a consumer that logs or routes by flavor never parses prose. */
  readonly subject: string;
  /** The contract version the running daemon actually speaks. */
  readonly daemonVersion: string;
  /** The contract version this supervisor's build requires. */
  readonly requiredVersion: string;
  /** The skewed daemon's own OS pid, as it self-reported over the handshake
   *  (kaval's `system.version.pid`). ADDITIVE and optional. It rides HERE — not
   *  only on a `DaemonConnection` — because the skew path THROWS before a
   *  connection is ever built, and the gate-less-squatter recovery of an OLD,
   *  skewed orphan (the 25494 case) still needs the daemon's self-reported pid as
   *  its third identity attestation. */
  readonly pid?: number;
  /** The message is DERIVED from the fields (parse-don't-validate — no
   *  consumer ever regexes the prose back apart); `subject` names the
   *  contract's flavor for a legible journal line ("pty-host", "padiSurface")
   *  while staying a field, never free prose. */
  constructor(versions: {
    subject: string;
    daemonVersion: string;
    requiredVersion: string;
    /** The skewed daemon's self-reported OS pid, if the handshake carried one. */
    pid?: number;
  }) {
    super(
      `${versions.subject} contract skew: daemon speaks ${versions.daemonVersion}, needs ${versions.requiredVersion}`,
    );
    this.name = "DaemonContractSkewError";
    this.subject = versions.subject;
    this.daemonVersion = versions.daemonVersion;
    this.requiredVersion = versions.requiredVersion;
    this.pid = versions.pid;
  }
}

/** True iff `err` is a `DaemonContractSkewError` — a genuine contract skew the
 *  soul's `connect` raised. Brand-checked (not `instanceof`) so it holds across
 *  module-instance / realm boundaries, the same robustness oRPC errors use. */
export function isContractSkewError(
  err: unknown,
): err is DaemonContractSkewError {
  const e = err as {
    isContractSkew?: unknown;
    subject?: unknown;
    daemonVersion?: unknown;
    requiredVersion?: unknown;
  };
  return (
    typeof err === "object" &&
    err !== null &&
    e.isContractSkew === true &&
    // The narrowed type promises its FIELDS (`subject` for the flavor a
    // consumer logs/routes by; the versions for the incompatible status arm
    // and the typed rethrow) — so the brand attests them all: a foreign
    // brand-carrier without the payload must not narrow to a type whose
    // fields it cannot honor.
    typeof e.subject === "string" &&
    typeof e.daemonVersion === "string" &&
    typeof e.requiredVersion === "string"
  );
}

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
  constructor(socketPath: string, holders: readonly SocketHolder[]) {
    const who = holders.length
      ? holders.map((h) => `pid ${h.pid} (${h.command})`).join(", ")
      : "an unidentifiable process";
    super(
      `rendezvous socket ${socketPath} is held by ${who}, which did not complete the daemon handshake — refusing to kill a process that is not a verified daemon of this endpoint`,
    );
    this.name = "SocketSquatterForeignError";
    this.socketPath = socketPath;
    this.holders = holders;
  }
}

/** True iff `err` is a {@link SocketSquatterForeignError}. Brand-checked (not
 *  `instanceof`) so it holds across module-instance / realm boundaries — and, like
 *  {@link isContractSkewError}, it attests EVERY field its narrowed type promises
 *  (`socketPath`, and `holders` as `{ pid, command }` records), so a foreign
 *  brand-carrier without the payload cannot narrow to a type whose fields a
 *  consumer would then dereference. */
export function isSocketSquatterForeignError(
  err: unknown,
): err is SocketSquatterForeignError {
  const e = err as {
    isSocketSquatterForeign?: unknown;
    socketPath?: unknown;
    holders?: unknown;
  };
  return (
    typeof err === "object" &&
    err !== null &&
    e.isSocketSquatterForeign === true &&
    typeof e.socketPath === "string" &&
    Array.isArray(e.holders) &&
    e.holders.every(
      (h) =>
        typeof h === "object" &&
        h !== null &&
        Number.isInteger((h as { pid?: unknown }).pid) &&
        typeof (h as { command?: unknown }).command === "string",
    )
  );
}

/** What a boot policy does with a gate-less SKEWED squatter — the one disposition
 *  that differs by boot mode, mirroring the caller's `onSkew` for a gate-recorded
 *  skew. `recycle` (kaval / always-recycle) SIGTERMs the verified orphan and spawns
 *  fresh; `refuse` (the padi binder — #1313) leaves it standing and reports
 *  incompatible, never killing a running daemon. The compatible-adopt and
 *  foreign-refusal arms are identical across both. */
type GatelessSkewPolicy = "recycle" | "refuse";

/** A live, handshaken connection to a daemon. The injected `connect` builds it;
 *  the endpoint holds it and tears it down. */
export type DaemonConnection<C, I, M = undefined> = {
  client: C;
  identity: I;
  startedAt: number;
  /** Drop the transport. */
  dispose(): void;
  /** Subscribe to the transport dropping (the daemon exited / the socket
   *  closed). Fires at most once. The endpoint uses it to flip to `degraded`. */
  onClose(cb: () => void): void;
} & ConnectedMetadata<M>;

export interface EndpointSpec<C, I, M = undefined> {
  /** Which host this endpoint is for. The status is reported per-host so the
   *  shapes stay host-count-agnostic (one local host today; ssh hosts at R-2). */
  hostId: string;
  /**
   * On-disk home — the spine primitive. Gate and socket are taken only from
   * here (the same home the daemon's `daemonMain` holds), never as loose path
   * strings. Build with `resolveDaemonHome` / `daemonHome`.
   */
  home: DaemonHomePaths;
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
  connect: (socketPath: string) => Promise<DaemonConnection<C, I, M>>;
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
    connect: (socketPath: string) => Promise<DaemonConnection<C, I, M>>;
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

export interface Endpoint<C, I, M = undefined> {
  /** Take the daemon to a live connection under the always-recycle boot policy.
   *  Throws (after reporting `dead`) if it cannot. */
  ensure(): Promise<void>;
  /** Take the daemon to a live connection under the **adopt-or-recycle** boot
   *  policy (B3.3): a live, handshake-compatible survivor is ADOPTED (connected
   *  to, never killed) so its PTYs survive a supervisor restart; an absent / dead
   *  survivor — or a live one that is a genuine contract skew — is recycled. A
   *  live survivor that merely cannot be reached (a non-skew connect failure that
   *  outlasts the retries) is left STANDING and reported `degraded`, never killed
   *  (F4) — preserving its PTYs. Resolves `true` iff it adopted a surviving daemon
   *  — the caller then reconciles that daemon's live PTYs against its saved
   *  session; `false` on a fresh / recycled / left-degraded boot, where there is
   *  nothing to reconcile. Throws (after reporting `dead`) if it cannot bring a
   *  daemon up at all. */
  adoptOrEnsure(): Promise<boolean>;
  /** Take the daemon to a live connection under the **adopt-or-spawn-or-refuse**
   *  boot policy — the padi binder's policy, distinct from `adoptOrEnsure` in ONE
   *  way: a live survivor that is a genuine contract SKEW is NOT recycled. Clients
   *  never kill a running padi (the #1313 inversion — a dev/second binder must not
   *  SIGTERM the daemon that owns another's PTYs), so a skewed survivor is left
   *  STANDING and reported `degraded` (the same non-killing shape an unreachable
   *  survivor already gets), never SIGTERM'd. An absent survivor is spawned fresh;
   *  a compatible one is adopted. Resolves `true` iff it adopted a surviving daemon
   *  (the caller then reconciles), `false` on a fresh-spawn / left-degraded boot.
   *  Throws (after `dead`) only if it cannot bring a daemon up at all. */
  adoptOrSpawnOrRefuse(): Promise<boolean>;
  /** The live connection, or `undefined` before `ensure()` or after the daemon
   *  died (`degraded`). */
  current(): DaemonConnection<C, I, M> | undefined;
  /** Run `body` (a session-preserving restart's inner sequence) with the status
   *  **held at `restarting`** — the emit-guard. While held, the transient
   *  transitions the recycle would otherwise surface (the old connection's
   *  `degraded` close, the fresh daemon's `connecting`) are reported as
   *  `restarting`, so an observer sees one honest "restarting" rather than a
   *  degraded→connecting→connected flicker; only the terminal `connected` /
   *  `dead` pass through to end the hold. */
  holdRestarting(body: () => Promise<void>): Promise<void>;
}

/** Poll until a connection to `socketPath` is accepted, or the ceiling passes.
 *  Resolves `true` if the socket came up, `false` on timeout. Each probe dials
 *  a bare socket through `dialSocket` (the one place that owns the connect/error
 *  race) and immediately closes it — the endpoint's real (handshaken) connection
 *  is made once by `spec.connect()` after this resolves. */
function waitForSocket(
  socketPath: string,
  ceilingMs: number,
  pollMs: number,
): Promise<boolean> {
  const deadline = Date.now() + ceilingMs;
  return new Promise<boolean>((resolve) => {
    const attempt = (): void => {
      dialSocket(socketPath).then(
        (sock) => {
          sock.destroy();
          resolve(true);
        },
        () => {
          if (Date.now() >= deadline) resolve(false);
          else setTimeout(attempt, pollMs);
        },
      );
    };
    attempt();
  });
}

/** One-shot probe: does `socketPath` accept a connection RIGHT NOW? Dials once
 *  (no polling) and immediately closes — the recycle path uses it to prove a
 *  live gate-pid is actually the daemon (its socket answers) before SIGTERMing
 *  it, so a stale gate over a reused pid can't make us kill a stranger. */
function socketAccepting(socketPath: string): Promise<boolean> {
  return dialSocket(socketPath).then(
    (sock) => {
      sock.destroy();
      return true;
    },
    () => false,
  );
}

/** The OS holders of `socketPath`, EXCLUDING the supervisor's own process. The
 *  supervisor spawns its daemon as a SEPARATE process (the survivable-spawn model),
 *  so its OWN pid holding the rendezvous is never a squatter — only an in-process
 *  serve (a test's in-process daemon) would be — and must never be a kill target.
 *  Single source for that self-exclusion safety invariant, so it can't drift across
 *  the recovery's read sites. */
async function externalHolders(socketPath: string): Promise<SocketHolder[]> {
  return (await socketHolders(socketPath)).filter((h) => h.pid !== process.pid);
}

export function createEndpoint<C, I, M = undefined>(
  spec: EndpointSpec<C, I, M>,
): Endpoint<C, I, M> {
  const socketReadyMs = spec.socketReadyMs ?? 30_000;
  const socketPollMs = spec.socketPollMs ?? 50;
  const adoptConnectAttempts = spec.adoptConnectAttempts ?? 3;
  const adoptConnectRetryMs = spec.adoptConnectRetryMs ?? 100;
  // How many times the gate-less-squatter recovery re-reads the holder + re-runs the
  // handshake when the holder CHANGES between identify and kill. A bounded backstop
  // on a flapping holder; a stable holder is decided on the first pass.
  const RECOVERY_DECISION_ATTEMPTS = 3;
  let conn: DaemonConnection<C, I, M> | undefined;

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
  let held = primaryRv;

  // The `connect` that dials a given rendezvous — framework hands the path.
  // Primary vs adopt-hint dialer chosen by which socket is held.
  const connectFor = (rv: {
    socketPath: string;
  }): (() => Promise<DaemonConnection<C, I, M>>) => {
    const dial =
      rv.socketPath === spec.home.socketPath
        ? spec.connect
        : (spec.adoptHint?.connect ?? spec.connect);
    return () => dial(rv.socketPath);
  };

  // The emit-guard flag: true only while `holdRestarting` is running a
  // supervised restart's inner sequence. See `emit` for what it coerces.
  let restartHold = false;

  // The last state actually published (post-coercion). `holdRestarting` reads it
  // to detect a restart that errored out BEFORE any terminal `connected`/`dead`
  // transition — leaving the surface pinned at `restarting` — and recover it.
  let lastReported: EndpointState | undefined;

  const connectedStatus = (
    next: DaemonConnection<C, I, M>,
  ): ConnectedEndpointStatus<I, M> =>
    ({
      state: "connected",
      identity: next.identity,
      startedAt: next.startedAt,
      metadata: next.metadata,
    }) as ConnectedEndpointStatus<I, M>;

  const emit = (status: EndpointStatus<I, M>): void => {
    // While a restart is held, the recycle's transient transitions — the old
    // connection closing (`degraded`) and the fresh daemon coming up
    // (`connecting`) — are both part of one "restarting", not separate states a
    // consumer should render. Coerce them; let the terminal `connected`/`dead`
    // (and the explicit `restarting` from `holdRestarting`) report honestly.
    // `incompatible` is DELIBERATELY not coerced (SK4): a proven skew inside a
    // restart is that restart's terminal VERDICT — repainting it as
    // "restarting" would show progress against a daemon a restart cannot fix.
    const reported: EndpointStatus<I, M> =
      restartHold &&
      (status.state === "connecting" || status.state === "degraded")
        ? { state: "restarting" }
        : status;
    lastReported = reported.state;
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
  // whose socket is *accepting* (a real daemon — the adopt-or-kill candidate),
  // or undefined. The gate is PID-ONLY: a hard kill (SIGKILL / power loss)
  // leaves the pidfile behind and the OS can later reuse that pid for an
  // UNRELATED process, so a live pid whose socket is dead/absent is a stale gate
  // over a possibly-reused pid — log it and leave that pid alone (never SIGTERM
  // a stranger), letting the freshly-spawned daemon's own `acquirePidGate` reap
  // the stale gate.
  const liveServingHolder = async (rv: {
    gatePath: string;
    socketPath: string;
  }): Promise<number | undefined> => {
    const holder = gatePid(rv.gatePath);
    if (holder === undefined || !isHolderLive(holder)) return undefined;
    if (await socketAccepting(rv.socketPath)) return holder;
    spec.log.warn(
      { hostId: spec.hostId, pid: holder, socketPath: rv.socketPath },
      "gate names a live pid but its socket is dead — treating gate as " +
        "stale (not killing the pid: it may be an unrelated reused pid)",
    );
    return undefined;
  };

  // SIGTERM a proven-live gate holder and wait for it to actually exit. Reports
  // `dead` and throws if it does not exit within the recycle ceiling —
  // respawning over a still-live holder would just yield to it (single
  // instance), a silent no-op recycle, so fail loudly instead.
  const killLiveHolder = async (holder: number): Promise<void> => {
    spec.log.info(
      { hostId: spec.hostId, pid: holder },
      "recycling live daemon (boot policy = always recycle)",
    );
    try {
      process.kill(holder, "SIGTERM");
    } catch {
      // Raced its own exit between the liveness probe and here — fine, the
      // wait below confirms it's gone.
    }
    const gone = await waitForPidGone(holder);
    if (!gone) {
      // Respawning now would just make the new daemon yield to the still-live
      // gate holder (single instance) — a silent no-op recycle. Fail loudly.
      emit({ state: "dead" });
      throw new Error(
        `daemon pid ${holder} did not exit within the recycle ceiling`,
      );
    }
  };

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
    const previous = conn;
    conn = next;
    if (previous !== undefined && previous !== next) previous.dispose();
    next.onClose(() => {
      // Only the CURRENT connection's close demotes us — a stale close from a
      // disposed predecessor must not stomp a fresh `connected`.
      if (conn === next) {
        conn = undefined;
        spec.log.warn(
          { hostId: spec.hostId },
          "daemon connection closed mid-session — degraded",
        );
        emit({ state: "degraded" });
      }
    });
    emit(connectedStatus(next));
  };

  // Resolve an ACCEPTING-but-unattributable rendezvous to a SAFE outcome: `free`
  // (→ the caller may spawn) ONLY when a fresh probe proves the socket NOT accepting
  // (a holder that just closed); otherwise the socket is still accepting and we
  // cannot name who holds it — NOT proof of freedom, so we fail LOUD rather than let
  // the caller spawn onto it (F5). The error names "an unidentifiable process" when
  // the OS still returns no holder.
  const freeOrFailLoud = async (rv: {
    gatePath: string;
    socketPath: string;
  }): Promise<"free"> => {
    if (!(await socketAccepting(rv.socketPath))) return "free";
    const held = await externalHolders(rv.socketPath);
    spec.log.error(
      {
        hostId: spec.hostId,
        socketPath: rv.socketPath,
        holders: held.map((h) => h.pid),
      },
      // The `holders` field carries whatever the OS now names — a set (a holder that
      // reappeared after a flap) or empty (unidentifiable) — so the message doesn't
      // assert which; either way an accepting socket is not proven free.
      "rendezvous socket is still accepting after recovery — failing loud rather than spawning onto it",
    );
    throw new SocketSquatterForeignError(rv.socketPath, held);
  };

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
  // It identifies the holder over the OS (`socketHolders`), then proves what it is
  // over the SAME handshake the adopt path trusts, returning a FOUR-way outcome the
  // caller acts on:
  //   - `free`     → the socket is PROVEN not accepting (nothing holds it), or it is
  //                  held only by our OWN process (an in-process serve): nothing to
  //                  recover (the caller spawns, or falls to a next rendezvous). An
  //                  accepting socket we cannot attribute is NOT `free` — it fails loud.
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
  const recoverGatelessSquatter = async (
    rv: { gatePath: string; socketPath: string },
    connect: () => Promise<DaemonConnection<C, I, M>>,
    skewPolicy: GatelessSkewPolicy,
  ): Promise<"free" | "refused" | "adopted" | "recycled"> => {
    // Bounded re-decision loop: a holder can CHANGE between our identify and our
    // kill (it exits; the pid is reused; a fresh daemon binds). Rather than trust a
    // stale snapshot, each pass re-reads the OS holders and re-runs the handshake,
    // and the kill only fires when a FRESH handshake — followed by a FRESH OS
    // corroboration — still attests the same skewed daemon.
    for (let attempt = 1; attempt <= RECOVERY_DECISION_ATTEMPTS; attempt++) {
      if (!(await socketAccepting(rv.socketPath))) return "free"; // nothing holds it

      // Exclude OUR OWN process from the holder set: the supervisor spawns its
      // daemon as a SEPARATE process (the survivable-spawn model), so a real
      // squatter is never us — but an in-process serve (a test's in-process daemon)
      // would be, and "recovering" it means SIGTERMing ourselves. Never a kill.
      const rawHolders = await socketHolders(rv.socketPath);
      const heldByUs = rawHolders.some((h) => h.pid === process.pid);
      const holders = rawHolders.filter((h) => h.pid !== process.pid);
      if (holders.length === 0) {
        if (heldByUs) {
          // The socket is held by OUR OWN process (an in-process serve) — never a
          // squatter, never a kill. Safe to treat as free.
          spec.log.warn(
            { hostId: spec.hostId, socketPath: rv.socketPath },
            "rendezvous socket is held by our own process — nothing to recover",
          );
          return "free";
        }
        // Accepting, yet the OS names NO holder at all: a race (it just closed) or a
        // holder we cannot attribute. That is NOT proof of freedom — do not let the
        // caller spawn onto it. Re-probe: only a not-accepting socket is `free`;
        // still-accepting fails loud (F5). Never guess a kill.
        return await freeOrFailLoud(rv);
      }
      const holderPids = holders.map((h) => h.pid);

      // Prove what the holder is, reusing the adopt path's three-way handshake
      // verdict (the dial targets `rv.socketPath`; the pids are LOG CONTEXT — a SET,
      // since on darwin the OS lookup may include connected clients, so no member is
      // labelled "the daemon" until a skew self-reports its pid).
      const verdict = await connectSurvivor(holderPids, connect);

      if (verdict.kind === "adopted") {
        // Compatible gate-less orphan → ADOPT the already-proven connection directly
        // (its PTYs preserved). Holding it reports `connected` and returns `adopted`,
        // so the caller RECONCILES the surviving session instead of parking it (F1).
        // Record `rv` as the HELD rendezvous — exactly as `adoptAt` does for a
        // gate-recorded survivor — so a later `ensure()` recycles the daemon we
        // actually adopted (e.g. the legacy hint), never abandons it by operating on
        // the primary (F4).
        held = rv;
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
      const reverify = await connectSurvivor([reportedPid], connect);
      if (reverify.kind === "adopted") {
        // The holder became COMPATIBLE between identify and re-attest — dispose the
        // probe connection we just opened (never leak it, F11) and re-decide.
        reverify.conn.dispose();
        spec.log.warn(
          { hostId: spec.hostId, socketPath: rv.socketPath, pid: reportedPid },
          "gate-less squatter became compatible between identify and kill — re-deciding",
        );
        continue;
      }
      if (reverify.kind !== "skew" || reverify.err.pid !== reportedPid) {
        spec.log.warn(
          { hostId: spec.hostId, socketPath: rv.socketPath, pid: reportedPid },
          "gate-less squatter changed between identify and kill — re-deciding against the fresh snapshot",
        );
        continue;
      }
      // OS corroboration AFTER the fresh handshake (F3 order): the just-attested pid
      // must still be a live holder of THIS socket right now.
      const finalHolders = await externalHolders(rv.socketPath);
      if (!finalHolders.some((h) => h.pid === reportedPid)) {
        spec.log.warn(
          { hostId: spec.hostId, socketPath: rv.socketPath, pid: reportedPid },
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
      await killLiveHolder(reportedPid);
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
    return await freeOrFailLoud(rv);
  };

  // Spawn a fresh daemon, wait for its socket, run the injected handshake, and
  // hold the connection (wiring its mid-session close → `degraded`). Reports
  // `dead` before throwing on any failure (launch, socket-never-up, or a failed
  // handshake), so the UI never sticks at `connecting`.
  const spawnConnectHold = async (): Promise<void> => {
    try {
      await spec.driver.spawn();
    } catch (err) {
      // The launch itself failed (ENOENT/EACCES on the binary, a systemd-run
      // that couldn't fork). The endpoint contract is "failures report `dead`
      // before they throw" — the UI relies on it to leave the indefinite
      // `connecting` state — so flip to `dead` before rethrowing.
      emit({ state: "dead" });
      throw err;
    }

    const up = await waitForSocket(
      spec.home.socketPath,
      socketReadyMs,
      socketPollMs,
    );
    if (!up) {
      emit({ state: "dead" });
      throw new Error(
        `daemon socket ${spec.home.socketPath} never came up within ${socketReadyMs}ms`,
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
    held = primaryRv;
    spec.onSpawned?.();

    let next: DaemonConnection<C, I, M>;
    try {
      next = await spec.connect(spec.home.socketPath);
    } catch (err) {
      // A fresh spawn that STILL skews is the proven-incompatible verdict
      // (SK4): the currently-realised closure has been tried and cannot speak
      // this build's contract — respawning it again can never converge, so
      // report `incompatible` with both versions (never `dead`, whose UI
      // affordance is exactly the retry that just failed). Every OTHER
      // rejection is a genuine boot failure — never an import-time throw,
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
      throw err;
    }

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
  };

  // The kill-then-respawn recycle, defined once: SIGTERM a proven-live holder we
  // cannot use, then spawn + connect + hold a fresh daemon in its place. Both
  // policies that recycle — `ensure`'s always-recycle and `adoptOrEnsure`'s
  // skew-recycle — call this, so the mechanism never drifts between them.
  const recycle = async (holder: number): Promise<void> => {
    await killLiveHolder(holder);
    await spawnConnectHold();
  };

  // `recoverGatelessSquatter` wrapped in the endpoint's "failures report `dead`
  // before they throw" contract (the UI relies on it to leave `connecting`): a
  // foreign-squatter refusal — or a flapping-holder fail-loud — flips to `dead`
  // before rethrowing, unless the recovery already emitted its own terminal `dead`
  // (`killLiveHolder`'s reap-timeout), so one failure never surfaces two `dead`
  // transitions (F10). Returns the recovery's four-way outcome for the caller to act
  // on. Called ONLY where a boot policy found NO live gate holder — never the
  // `recycle` path, which already reaped its holder.
  const recoverGuarded = async (
    rv: { gatePath: string; socketPath: string },
    connect: () => Promise<DaemonConnection<C, I, M>>,
    skewPolicy: GatelessSkewPolicy,
  ): Promise<"free" | "refused" | "adopted" | "recycled"> => {
    try {
      return await recoverGatelessSquatter(rv, connect, skewPolicy);
    } catch (err) {
      if (lastReported !== "dead") emit({ state: "dead" });
      throw err;
    }
  };

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
  const connectSurvivor = async (
    // Candidate holder pid(s), LOG CONTEXT ONLY (the dial targets the rendezvous,
    // not a pid). A SET, not a single pid, because on darwin the OS lookup may
    // include connected clients alongside the listener — logging one of them as
    // "the survivor pid" would mislead; only a skew's self-reported pid names the
    // real daemon. A gate-recorded caller passes its single `[holder]`.
    logHolders: number[],
    connect: () => Promise<DaemonConnection<C, I, M>>,
  ): Promise<SurvivorConnect> => {
    // Seeded so a misconfigured `adoptConnectAttempts <= 0` (the loop never runs)
    // surfaces a loud, meaningful `unreachable` error rather than a bare
    // `undefined` — fail loud over fail silent.
    let lastErr: unknown = new Error(
      `survivor connect made no attempts (adoptConnectAttempts=${adoptConnectAttempts})`,
    );
    for (let attempt = 1; attempt <= adoptConnectAttempts; attempt++) {
      try {
        return { kind: "adopted", conn: await connect() };
      } catch (err) {
        lastErr = err;
        // A genuine contract skew is terminal: an incompatible daemon stays
        // incompatible no matter how many times we re-dial it, so stop retrying
        // and tell the caller to recycle.
        if (isContractSkewError(err)) {
          spec.log.warn(
            { hostId: spec.hostId, holders: logHolders, err: String(err) },
            "survivor connect hit a contract skew — recycling (incompatible daemon)",
          );
          return { kind: "skew", err };
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
        if (!last) await new Promise((r) => setTimeout(r, adoptConnectRetryMs));
      }
    }
    return { kind: "unreachable", err: lastErr };
  };

  // Connect to a live survivor at rendezvous `rv` (via its own `connect`) and act on
  // the verdict: ADOPT (hold it; `onAdopted` records where it lives), RECYCLE/REFUSE a
  // proven contract SKEW (`onSkew` — the ONE volatile choice between the two policies),
  // or leave an `unreachable` survivor STANDING + `degraded` — the F4 data-loss-critical
  // "never kill a survivor we have not PROVEN incompatible" arm. Factored so the PRIMARY
  // (digest) rendezvous and the adopt-HINT (legacy port) rendezvous share ONE
  // adopt/skew/degrade sequence, so the preserve-live-PTYs handling can't drift between
  // them. Records `held = rv` BEFORE connecting, so a later recycle SIGTERMs THIS holder
  // (the legacy port daemon, when adopted off the hint) and converges to the primary.
  const adoptAt = async (
    rv: { gatePath: string; socketPath: string },
    holder: number,
    connect: () => Promise<DaemonConnection<C, I, M>>,
    onAdopted: (() => void) | undefined,
    onSkew: (
      holder: number,
      err: DaemonContractSkewError,
    ) => void | Promise<void>,
    // Which rendezvous this adoption is against — `primary` (the digest socket) or
    // `upgrade-hint` (the pre-W2.2 legacy port socket, the migration bridge). Stamped
    // on the adopted log so an operator can grep "did the W2.2 upgrade bridge fire?"
    // without decoding the socket path.
    via: "primary" | "upgrade-hint",
  ): Promise<boolean> => {
    held = rv;
    // A single failure is NOT proof of skew (F4): only a `DaemonContractSkewError`
    // raised by the soul's `connect` proves incompatibility. A transport-dial or
    // handshake-read failure may be transient, so it is retried, and if it persists
    // the survivor is `unreachable`, not skewed. The endpoint stays soul-agnostic —
    // it never parses an error, only branches on the soul's typed skew marker.
    const outcome = await connectSurvivor([holder], connect);
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
      return true;
    }
    if (outcome.kind === "skew") {
      // Proven incompatible: `adoptOrEnsure` RECYCLES (kill this holder + respawn at
      // the primary — converging a skewed legacy kaval to the digest keying);
      // `adoptOrSpawnOrRefuse` REFUSES (leave standing + report `incompatible`).
      await onSkew(holder, outcome.err);
      return false;
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
    return false;
  };

  // The shared survivor-adoption sequence, factored from `adoptOrEnsure` and
  // `adoptOrSpawnOrRefuse`: the two policies are IDENTICAL except for how they treat
  // a proven contract SKEW (recycle vs refuse), which the caller passes as `onSkew`.
  // Probes the PRIMARY (digest) rendezvous first; only when it has NO live survivor
  // does it fall to the adopt-HINT (legacy port, W2.2 upgrade) — so a compatible
  // digest survivor is always preferred and a standalone endpoint (no hint) behaves
  // exactly as before. The no-survivor fresh spawn is always at the PRIMARY. Returns
  // whether a live survivor was ADOPTED.
  const adoptSurvivor = async (
    // The ONE policy value for a proven contract skew — recycle (kaval) or refuse
    // (padi). BOTH enactment sites derive from it: the gate-recorded `onSkew`
    // handler below, and the gate-less `recoverGuarded(rv, connect, policy)` at the
    // no-gate-holder branches. One statement of the policy, so the two paths can't
    // drift and the illegal cross-pairing (recycle-here + refuse-there) is unrepresentable.
    policy: GatelessSkewPolicy,
  ): Promise<boolean> => {
    // Derived from `policy`, so the gate-recorded skew disposition is the SAME
    // recycle-vs-refuse choice the gate-less path takes — never a hand-synced twin.
    // recycle (kaval): SIGTERM the skewed holder and spawn fresh. refuse (padi):
    // leave it STANDING and report incompatible — #1313, never SIGTERM a running padi.
    const onSkew = async (
      holder: number,
      err: DaemonContractSkewError,
    ): Promise<void> => {
      if (policy === "recycle") {
        spec.log.warn(
          { hostId: spec.hostId, pid: holder },
          "live daemon survivor is a contract skew — recycling it",
        );
        await recycle(holder);
      } else {
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
      }
    };
    emit({ state: "connecting" });
    const primaryHolder = await liveServingHolder(primaryRv);
    if (primaryHolder !== undefined) {
      return adoptAt(
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
    const settle = async (
      outcome: "free" | "refused" | "adopted" | "recycled",
      onAdopted?: () => void,
    ): Promise<boolean | undefined> => {
      switch (outcome) {
        case "adopted":
          runHook(onAdopted, "onAdopted");
          return true;
        case "refused":
          return false;
        case "recycled":
          await spawnConnectHold();
          return false;
        case "free":
          return undefined; // nothing recovered here — the caller falls through
      }
      // Exhaustiveness fence (the file's `satisfies never` idiom): a new recovery
      // outcome compile-fails here until it is handled, rather than silently
      // falling through to "free".
      outcome satisfies never;
      return undefined;
    };

    const primary = await settle(
      await recoverGuarded(primaryRv, connectFor(primaryRv), policy),
    );
    if (primary !== undefined) return primary;

    // PRIMARY is free. On a W2.2 upgrade the pre-W2.2 kaval may still be alive at the
    // adopt-HINT (legacy port) rendezvous the digest primary does not name.
    if (spec.adoptHint) {
      const hintRv = {
        gatePath: spec.adoptHint.home.gatePath,
        socketPath: spec.adoptHint.home.socketPath,
      };
      const hintHolder = await liveServingHolder(hintRv);
      if (hintHolder !== undefined) {
        return adoptAt(
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
      const hint = await settle(
        await recoverGuarded(hintRv, connectFor(hintRv), policy),
        spec.adoptHint.onAdopted,
      );
      if (hint !== undefined) return hint;
    }
    // Nothing live anywhere — a fresh boot; spawn fresh at the PRIMARY.
    await spawnConnectHold();
    return false;
  };

  return {
    current: () => conn,

    async holdRestarting(body: () => Promise<void>): Promise<void> {
      // Emit `restarting` up front so the status flips the instant the restart
      // begins (before the capture/drain the caller runs inside `body`), then
      // hold it across the recycle. Cleared in `finally` so a failed restart's
      // `dead` (emitted by the inner recycle, never coerced) is the last word.
      restartHold = true;
      emit({ state: "restarting" });
      try {
        await body();
      } catch (err) {
        // The recycle (`ensure()`) reports its own terminal `dead`/`connected`
        // before it throws. But a step that runs BEFORE the recycle — `capture`
        // or `drain` — can reject with the surface still pinned at `restarting`,
        // even though the daemon never moved (those steps don't touch the
        // connection). Recover the honest current state so the rail/buttons
        // don't stick in an in-flight state forever: a live connection means the
        // old daemon is still `connected`; no connection means it's `dead`.
        // (Skip if the recycle already emitted a terminal state — `lastReported`
        // is no longer `restarting` — so we never stomp a fresh `connected`/`dead`.)
        if (lastReported === "restarting") {
          // restartHold is still true here, but `connected`/`dead` are never
          // coerced by `emit`, so the recovery reports honestly.
          if (conn) emit(connectedStatus(conn));
          else emit({ state: "dead" });
        }
        throw err;
      } finally {
        restartHold = false;
      }
    },

    async ensure(): Promise<void> {
      emit({ state: "connecting" });
      // ALWAYS RECYCLE (B2, "the door"): a live serving survivor is killed,
      // never adopted, so no survival hazard can open (no orphan, no skew older
      // than one boot). `liveServingHolder` proves a holder is really the daemon
      // before we SIGTERM it; a stale gate over a reused pid is left alone.
      // (Adoption that *preserves* a session is B3's `adoptOrEnsure` — it reuses
      // these same helpers but connects to the survivor instead of killing it.)
      //
      // Probe the HELD rendezvous — the socket the endpoint currently holds a daemon
      // at, which is the adopt-HINT (legacy port) socket after an upgrade adoption,
      // not the primary. So a Restart-kaval recycle SIGTERMs the ADOPTED legacy daemon
      // (never leaks it) and `recycle`'s spawn lands at the PRIMARY (digest) — the
      // bounded migration converges here.
      const holder = await liveServingHolder(held);
      if (holder !== undefined) {
        await recycle(holder);
      } else {
        // No live GATE holder — but a gate-less squatter may still hold the HELD
        // socket (the wedge). Recover it (at the held rendezvous, with its matching
        // dialer); `ensure` is always-recycle, so a gate-less skew is RECYCLED (a
        // foreign holder is still refused loud). Spawn fresh when the recovery reaped
        // a squatter (`recycled`) or the socket was free (`free`); a compatible holder
        // is adopted in place (`adopted`) and `refused` can't arise under recycle.
        const o = await recoverGuarded(held, connectFor(held), "recycle");
        if (o === "free" || o === "recycled") await spawnConnectHold();
      }
    },

    async adoptOrEnsure(): Promise<boolean> {
      // ADOPT-OR-RECYCLE (B3.3): unlike `ensure`'s always-kill, a live serving
      // survivor that is handshake-COMPATIBLE is ADOPTED — connected + held, never
      // killed, so the PTYs it holds (and the session they carry) survive a client
      // redeploy that did not change the daemon's source. Only an absent / dead /
      // skewed survivor is recycled. A proven SKEW is RECYCLED here (kill, then spawn
      // fresh) — the deliberate OPPOSITE of `adoptOrSpawnOrRefuse`, and the only arm
      // that differs from it; everything else is the shared `adoptSurvivor` sequence.
      return adoptSurvivor("recycle");
    },

    async adoptOrSpawnOrRefuse(): Promise<boolean> {
      // ADOPT-OR-SPAWN-OR-REFUSE (W2.2): the padi binder's policy — `adoptOrEnsure`
      // with ONE deliberate difference: a proven contract SKEW is REFUSED, not
      // recycled. Clients never kill a running padi: a second binder (a dev kolu,
      // another worktree) that speaks an incompatible contract must NOT SIGTERM the
      // padi that owns the real PTYs (the #1313 inversion the state-root identity
      // exists to enforce). So a skewed survivor is left STANDING and reported
      // `incompatible` (SK4) — the same NON-KILLING shape an unreachable survivor
      // gets, under its honest verdict — and the operator
      // resolves the skew (upgrade the binder, or drain the daemon through the frozen
      // control core). Only this skew arm differs from `adoptOrEnsure`; the rest is
      // the shared `adoptSurvivor` sequence.
      return adoptSurvivor("refuse");
    },
  };
}
