/**
 * The endpoint state machine — the supervisor's view of one daemon.
 *
 * An endpoint owns the relationship between a supervising process (kolu-server;
 * the odu CLI) and one surface daemon it spawns and watches: it takes the
 * daemon from nothing to a live, handshaken connection, and reports — on every
 * transition — an honest `{ state, identity, startedAt }` the supervisor's
 * surface projects so the UI never lies about whether the daemon is there.
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

import { gatePid, isHolderLive, type Logger } from "@kolu/surface-daemon";
import { dialSocket } from "./dialSocket.ts";
import type { DaemonDriver } from "./driver.ts";
import { ENDPOINT_STATES, type EndpointState } from "./endpointStates.ts";
import { waitForPidGone } from "./waitForPidGone.ts";

// `ENDPOINT_STATES` / `EndpointState` are the single source of truth for the
// reported state set; they live in the zero-dependency `endpointStates.ts` leaf
// so a browser-shared consumer (kolu's `DaemonStatusSchema`) can derive its enum
// from them without pulling this Node-only module's transport/gate graph. The
// endpoint re-exports them so existing supervisor consumers keep their import.
export { ENDPOINT_STATES, type EndpointState };

export interface EndpointStatus<I> {
  state: EndpointState;
  /** Present once `connected`: the daemon's self-declared identity. */
  identity?: I;
  /** Present once `connected`: the daemon's boot time (ms epoch), for uptime. */
  startedAt?: number;
}

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
  constructor(message: string) {
    super(message);
    this.name = "DaemonContractSkewError";
  }
}

/** True iff `err` is a `DaemonContractSkewError` — a genuine contract skew the
 *  soul's `connect` raised. Brand-checked (not `instanceof`) so it holds across
 *  module-instance / realm boundaries, the same robustness oRPC errors use. */
export function isContractSkewError(
  err: unknown,
): err is DaemonContractSkewError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { isContractSkew?: unknown }).isContractSkew === true
  );
}

/** A live, handshaken connection to a daemon. The injected `connect` builds it;
 *  the endpoint holds it and tears it down. */
export interface DaemonConnection<C, I> {
  client: C;
  identity: I;
  startedAt: number;
  /** Drop the transport. */
  dispose(): void;
  /** Subscribe to the transport dropping (the daemon exited / the socket
   *  closed). Fires at most once. The endpoint uses it to flip to `degraded`. */
  onClose(cb: () => void): void;
}

export interface EndpointSpec<C, I> {
  /** Which host this endpoint is for. The status is reported per-host so the
   *  shapes stay host-count-agnostic (one local host today; ssh hosts at R-2). */
  hostId: string;
  /** The daemon's single-instance gate path — the same path the daemon's own
   *  `daemonMain` derives, so the supervisor reads the true current holder. */
  gatePath: string;
  /** The unix socket the daemon serves and we dial. */
  socketPath: string;
  /** Spawns the daemon so it outlives us (the survivable-spawn driver). */
  driver: DaemonDriver;
  /** Dial `socketPath`, run the contract-version handshake, and return the live
   *  connection. On a genuine contract skew (an incompatible daemon) it must
   *  reject with a `DaemonContractSkewError` — the ONE signal `adoptOrEnsure`
   *  trusts to recycle a live survivor. Every other failure (transport dial,
   *  unreadable handshake read) rejects with a plain error, which the endpoint
   *  treats as possibly-transient: `ensure` reports `dead`, and `adoptOrEnsure`
   *  retries it without ever killing the survivor (F4). */
  connect(): Promise<DaemonConnection<C, I>>;
  log: Logger;
  /** Called on every state transition — the supervisor publishes it. */
  onStatus(hostId: string, status: EndpointStatus<I>): void;
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
}

export interface Endpoint<C, I> {
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
  /** The live connection, or `undefined` before `ensure()` or after the daemon
   *  died (`degraded`). */
  current(): DaemonConnection<C, I> | undefined;
  /** Run `body` (a session-preserving restart's inner sequence) with the status
   *  **held at `restarting`** — the emit-guard. While held, the transient
   *  transitions the recycle would otherwise surface (the old connection's
   *  `degraded` close, the fresh daemon's `connecting`) are reported as
   *  `restarting`, so an observer sees one honest "restarting" rather than a
   *  degraded→connecting→connected flicker; only the terminal `connected` /
   *  `dead` pass through to end the hold. Used by `serializeRestart`. */
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

export function createEndpoint<C, I>(spec: EndpointSpec<C, I>): Endpoint<C, I> {
  const socketReadyMs = spec.socketReadyMs ?? 30_000;
  const socketPollMs = spec.socketPollMs ?? 50;
  const adoptConnectAttempts = spec.adoptConnectAttempts ?? 3;
  const adoptConnectRetryMs = spec.adoptConnectRetryMs ?? 100;
  let conn: DaemonConnection<C, I> | undefined;

  // The emit-guard flag: true only while `holdRestarting` is running a
  // supervised restart's inner sequence. See `emit` for what it coerces.
  let restartHold = false;

  // The last state actually published (post-coercion). `holdRestarting` reads it
  // to detect a restart that errored out BEFORE any terminal `connected`/`dead`
  // transition — leaving the surface pinned at `restarting` — and recover it.
  let lastReported: EndpointState | undefined;

  const emit = (
    state: EndpointState,
    identity?: I,
    startedAt?: number,
  ): void => {
    // While a restart is held, the recycle's transient transitions — the old
    // connection closing (`degraded`) and the fresh daemon coming up
    // (`connecting`) — are both part of one "restarting", not separate states a
    // consumer should render. Coerce them; let the terminal `connected`/`dead`
    // (and the explicit `restarting` from `holdRestarting`) report honestly.
    const reported: EndpointState =
      restartHold && (state === "connecting" || state === "degraded")
        ? "restarting"
        : state;
    lastReported = reported;
    spec.onStatus(spec.hostId, { state: reported, identity, startedAt });
  };

  // The gate-holder check shared by every boot policy: return the live holder
  // whose socket is *accepting* (a real daemon — the adopt-or-kill candidate),
  // or undefined. The gate is PID-ONLY: a hard kill (SIGKILL / power loss)
  // leaves the pidfile behind and the OS can later reuse that pid for an
  // UNRELATED process, so a live pid whose socket is dead/absent is a stale gate
  // over a possibly-reused pid — log it and leave that pid alone (never SIGTERM
  // a stranger), letting the freshly-spawned daemon's own `acquirePidGate` reap
  // the stale gate.
  const liveServingHolder = async (): Promise<number | undefined> => {
    const holder = gatePid(spec.gatePath);
    if (holder === undefined || !isHolderLive(holder)) return undefined;
    if (await socketAccepting(spec.socketPath)) return holder;
    spec.log.warn(
      { hostId: spec.hostId, pid: holder, socketPath: spec.socketPath },
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
      emit("dead");
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
  const holdConnection = (next: DaemonConnection<C, I>): void => {
    conn = next;
    next.onClose(() => {
      // Only the CURRENT connection's close demotes us — a stale close from a
      // disposed predecessor must not stomp a fresh `connected`.
      if (conn === next) {
        conn = undefined;
        spec.log.warn(
          { hostId: spec.hostId },
          "daemon connection closed mid-session — degraded",
        );
        emit("degraded");
      }
    });
    emit("connected", next.identity, next.startedAt);
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
      emit("dead");
      throw err;
    }

    const up = await waitForSocket(
      spec.socketPath,
      socketReadyMs,
      socketPollMs,
    );
    if (!up) {
      emit("dead");
      throw new Error(
        `daemon socket ${spec.socketPath} never came up within ${socketReadyMs}ms`,
      );
    }

    let next: DaemonConnection<C, I>;
    try {
      next = await spec.connect();
    } catch (err) {
      // A fresh spawn shouldn't skew (it's the current build), so this is a
      // genuine boot failure — never an import-time throw, just an honest
      // `dead`.
      emit("dead");
      throw err;
    }

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
    | { kind: "adopted"; conn: DaemonConnection<C, I> }
    | { kind: "skew"; err: unknown }
    | { kind: "unreachable"; err: unknown };

  // Connect to a live survivor for adoption, retrying bounded times on a
  // NON-skew failure before declaring it `unreachable` (F4). A skew short-circuits
  // immediately (no retry can make an incompatible contract compatible). A
  // transient transport/read hiccup against a healthy survivor clears on a retry,
  // so a one-off failure never costs the survivor its live PTYs. The survivor's
  // socket stays up across the retries (we never killed it), so each retry
  // re-dials the SAME daemon.
  const connectSurvivor = async (
    holder: number,
  ): Promise<SurvivorConnect> => {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= adoptConnectAttempts; attempt++) {
      try {
        return { kind: "adopted", conn: await spec.connect() };
      } catch (err) {
        lastErr = err;
        // A genuine contract skew is terminal: an incompatible daemon stays
        // incompatible no matter how many times we re-dial it, so stop retrying
        // and tell the caller to recycle.
        if (isContractSkewError(err)) {
          spec.log.warn(
            { hostId: spec.hostId, pid: holder, err: String(err) },
            "survivor connect hit a contract skew — recycling (incompatible daemon)",
          );
          return { kind: "skew", err };
        }
        const last = attempt === adoptConnectAttempts;
        spec.log.warn(
          {
            hostId: spec.hostId,
            pid: holder,
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

  return {
    current: () => conn,

    async holdRestarting(body: () => Promise<void>): Promise<void> {
      // Emit `restarting` up front so the status flips the instant the restart
      // begins (before the capture/drain the caller runs inside `body`), then
      // hold it across the recycle. Cleared in `finally` so a failed restart's
      // `dead` (emitted by the inner recycle, never coerced) is the last word.
      restartHold = true;
      emit("restarting");
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
          if (conn) emit("connected", conn.identity, conn.startedAt);
          else emit("dead");
        }
        throw err;
      } finally {
        restartHold = false;
      }
    },

    async ensure(): Promise<void> {
      emit("connecting");
      // ALWAYS RECYCLE (B2, "the door"): a live serving survivor is killed,
      // never adopted, so no survival hazard can open (no orphan, no skew older
      // than one boot). `liveServingHolder` proves a holder is really the daemon
      // before we SIGTERM it; a stale gate over a reused pid is left alone.
      // (Adoption that *preserves* a session is B3's `adoptOrEnsure` — it reuses
      // these same helpers but connects to the survivor instead of killing it.)
      const holder = await liveServingHolder();
      if (holder !== undefined) {
        await recycle(holder);
      } else {
        await spawnConnectHold();
      }
    },

    async adoptOrEnsure(): Promise<boolean> {
      emit("connecting");
      // ADOPT-OR-RECYCLE (B3.3): unlike `ensure`'s always-kill, a live serving
      // survivor that is handshake-COMPATIBLE is ADOPTED — we connect to it and
      // hold it, never killing it, so the PTYs it holds (and the session they
      // carry) survive a kolu-server redeploy that did not change the daemon's
      // source. Only an absent / dead / skewed survivor is recycled. Reuses the
      // same `liveServingHolder` probe and `holdConnection` tail as the boot
      // recycle, so an adopted daemon reports `connected` identically to a fresh
      // one — with the SURVIVOR's older `startedAt`, the uptime that did not
      // reset being the honest signal that the daemon was reused.
      const holder = await liveServingHolder();
      if (holder !== undefined) {
        // The survivor answered its socket. Try to connect + handshake. A single
        // failure is NOT proof of skew (F4): only a `DaemonContractSkewError`
        // raised by the soul's `connect` proves the daemon is incompatible. A
        // transport-dial or handshake-read failure may just be transient, so it
        // is retried, and if it persists the survivor is `unreachable`, not
        // skewed. The endpoint stays soul-agnostic — it never parses an error,
        // it only branches on the soul's typed skew marker.
        const outcome = await connectSurvivor(holder);
        if (outcome.kind === "adopted") {
          spec.log.info(
            {
              hostId: spec.hostId,
              pid: holder,
              startedAt: outcome.conn.startedAt,
            },
            "adopted a surviving daemon (its PTYs are preserved)",
          );
          holdConnection(outcome.conn);
          return true;
        }
        if (outcome.kind === "skew") {
          // Proven incompatible — recycle it: kill, then spawn fresh. The
          // deliberate OPPOSITE of `spawnConnectHold`'s connect-failure handling:
          // there a failed connect is a fresh spawn's genuine `dead` boot; here it
          // is a survivor we replace because its contract cannot be talked to.
          spec.log.warn(
            { hostId: spec.hostId, pid: holder },
            "live daemon survivor is a contract skew — recycling it",
          );
          await recycle(holder);
          return false;
        }
        // `unreachable`: the survivor is alive but every NON-skew connect attempt
        // failed. We have NOT proven it incompatible, so we must NOT kill it —
        // doing so would destroy the very live PTYs adoption exists to preserve
        // (the F4 data-loss mode). Report `degraded` (a daemon is there but we
        // hold no working connection to it) and leave it standing; the facade
        // throws until a later reconnect, and the survivor's session is intact.
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
        emit("degraded");
        return false;
      }
      // No live survivor — a fresh boot, identical to `ensure` minus the kill.
      await spawnConnectHold();
      return false;
    },
  };
}
