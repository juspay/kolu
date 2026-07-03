/**
 * kolu-server's PADI BINDER — the composition root for the W2.2 cutover.
 *
 * Before W2.2 kolu-server served `padiSurface` IN-PROCESS (it ran the terminal
 * domain itself and dialed a kaval daemon). Now kolu-server runs NO terminal
 * domain: it SPAWNS/ADOPTS a separate `padi` PROCESS over padi's digest-keyed
 * unix socket, handshakes the FROZEN control core, and RE-SERVES `padiSurface`
 * to browsers through W2.1's {@link reServeSurface}. This module is the padi twin
 * of `@kolu/padi/ptyHost/{connect,localDriver,index}` (which supervise kaval),
 * but supervising PADI — plus the ONE piece with no kaval analog: a
 * {@link PadiBindingSession} that turns the one-shot supervisor {@link Endpoint}
 * into the reconnect-mirror `HostSession` shape `reServeSurface`'s pump loops
 * over.
 *
 * THREE parts + the adapter:
 *   1. `connectPadi`         — the twin of `connectKaval`: dial + handshake.
 *   2. `localPadiDriver`      — the twin of `localKavalDriver`: how to launch padi.
 *   3. `PadiBindingSession`   — Endpoint → reconnect-mirror `HostSession` (the crux).
 *   4. `ensurePadiBinding`    — the twin of `ensureLocalEndpoint`: boot the binding.
 *
 * padi is NEVER kill-9'd. The boot/reconnect policy is `bindPadiOnce` — the
 * NEWEST-WINS convergence arm the frozen control core was designed for
 * (`controlCore.ts`: "upgrade-me (binder older → refuse) vs drain-you (binder
 * newer → control.drain)"), layered over the endpoint's generic
 * `adoptOrSpawnOrRefuse`:
 *   - a `padiSurface` skew where THIS binder is NEWER than the running padi →
 *     DRAIN it over the frozen control core (persist + exit; its kaval + PTYs
 *     survive), so the spawn path brings up this binder's OWN newer closure —
 *     the padi gate pid changes, the surviving kaval is re-adopted, the session
 *     is intact;
 *   - a skew where the binder is OLDER / major-behind → the endpoint's loud
 *     REFUSE, UNCHANGED (leave padi standing + degraded, never touch it). Older
 *     NEVER drains — that asymmetry is the monotonicity that stops two
 *     mixed-version binders from livelocking (only the strictly-newer one acts).
 * And the "restart" verb DRAINS the running padi (persist + exit; the PTYs
 * survive in kaval) via the frozen control core, then the reconnect loop
 * re-spawns it.
 */

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  padiGatePath,
  padiSocketPath,
  resolvePadiStateRoot,
} from "@kolu/padi/assembly";
import {
  PADI_SURFACE_VERSION,
  type PadiDaemonContract,
  type PadiHello,
  type padiSurface,
} from "@kolu/padi/surface";
import {
  isContractVersionCompatible,
  scopeSibling,
} from "@kolu/surface/define";
import { stdioLink } from "@kolu/surface/links/stdio";
import {
  createEndpoint,
  type DaemonConnection,
  DaemonContractSkewError,
  type DaemonDriver,
  dialSocket,
  type Endpoint,
  type EndpointStatus,
  scrubDaemonNodeOptions,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import type {
  AgentClient,
  HostSessionState,
  RemoteMirrorSession,
} from "@kolu/surface-nix-host";
import { match, P } from "ts-pattern";
import { log } from "./log.ts";

/** The minimal structured logger the convergence arm writes to — the same
 *  `(obj, msg)` shape `@kolu/surface-daemon`'s `Logger` (what the endpoint takes)
 *  declares, so the server's pino `log` passes through unchanged AND a unit test
 *  can supply a silent stub. Narrower than pino's `Logger` on purpose: these
 *  functions log only, so they should not demand pino's full surface. */
type ConvergeLogger = {
  info: (obj: Record<string, unknown>, msg: string) => void;
  warn: (obj: Record<string, unknown>, msg: string) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
};

/** How long `drainBoundPadi` waits for the socket to CLOSE after the drain RPC
 *  rejects, before treating the rejection as a real failure. A drain that reached
 *  padi persists + exits near-instantly, so the close follows within a beat; this
 *  ceiling only bounds the wait for a rejection that is NOT the expected teardown
 *  (a stale link, or an `onDrain` that threw before persisting) so the "restart"
 *  verb reports failure instead of hanging. */
const DRAIN_TEARDOWN_CEILING_MS = 2000;

// ── Types ──────────────────────────────────────────────────────────────────

/** The client the dial produces — typed to the COMBINED contract, so the
 *  handshake reaches `.surface.control.core.hello()` AND the re-serve can scope
 *  `.surface.padi`. */
type PadiDaemonClient = AgentClient<PadiDaemonContract>;

/** The padi-SIBLING-scoped client the re-serve mirrors: `{ surface: <padi> }`, so
 *  the relay's `client.surface.<member>` walk resolves at `/surface/padi/<member>`.
 *  Produced by `scopeSibling(combined, "padi")`. */
type PadiSurfaceClient = AgentClient<typeof padiSurface.contract>;

/** padi's wire identity, from its control-core `hello`. */
type PadiIdentity = { stateRoot: string; surfaceVersion: string } | undefined;
type PadiConnectionMetadata = {
  surfaceVersion: string;
  controlCoreVersion: string;
};
type PadiConnection = DaemonConnection<
  PadiDaemonClient,
  PadiIdentity,
  PadiConnectionMetadata
>;
type PadiEndpoint = Endpoint<
  PadiDaemonClient,
  PadiIdentity,
  PadiConnectionMetadata
>;
type PadiEndpointStatus = EndpointStatus<PadiIdentity, PadiConnectionMetadata>;

// ─────────────────────────────────────────────────────────────────────────────
// 1. connectPadi — the twin of connectKaval (packages/padi/src/ptyHost/connect.ts)
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a `major.minor` version into its two numbers, FAIL-FAST: an
 *  unparseable version is a bug (padi always sends a valid `major.minor`, and
 *  `PADI_SURFACE_VERSION` is a build constant), so crash loudly rather than
 *  silently comparing garbage. Distinct from `isContractVersionCompatible`'s
 *  own tolerant parse (which returns `false` on garbage to fail-closed on a
 *  handshake) — here we are ORDERING two versions already proven to be a skew,
 *  and a silent mis-parse would pick the wrong convergence arm. */
function parseMajorMinor(v: string): [number, number] {
  const m = /^(\d+)\.(\d+)(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/.exec(v);
  if (!m) {
    throw new Error(
      `padi version is not a major.minor string: ${JSON.stringify(v)}`,
    );
  }
  return [Number(m[1]), Number(m[2])];
}

/**
 * Is the binder's expected `padiSurface` version STRICTLY NEWER than a running
 * padi's — the drain-you side of the newest-wins convergence? Both `major.minor`.
 * Newer = a higher major, or an equal major with a higher minor.
 *
 * Only meaningful on a proven SKEW: the compatible case (same major, running
 * minor >= binder minor) already ADOPTS and never reaches here, so on a skew the
 * two versions are never equal and this is a strict ordering. Equal inputs return
 * `false` (not strictly newer) as a defensive floor, so a caller can never
 * mistake "same version" for "drain it".
 *
 * The asymmetry is load-bearing: only the strictly-newer binder ever drains, so
 * two binders at different versions contending over one padi converge to the
 * NEWEST (it drains the older's padi once) and never oscillate — the older binder
 * never drains the newer's padi back (the anti-livelock monotonicity).
 */
export function isBinderNewer(binderVer: string, runningVer: string): boolean {
  const [bMajor, bMinor] = parseMajorMinor(binderVer);
  const [rMajor, rMinor] = parseMajorMinor(runningVer);
  if (bMajor !== rMajor) return bMajor > rMajor;
  return bMinor > rMinor;
}

/** The dialed-but-unjudged result of reaching padi's frozen control core: the
 *  live client, its socket, and the `hello` it answered. The skew judgement
 *  (`isContractVersionCompatible` / `isBinderNewer`) is the CALLER's — this only
 *  opens the link and reads identity. Shared by `connectPadi` (which judges then
 *  holds or refuses) and `probePadiSkew` (which judges then drains or leaves be). */
type PadiDial = {
  socket: Awaited<ReturnType<typeof dialSocket>>;
  client: PadiDaemonClient;
  hello: PadiHello;
};

/** Dial padi at `socketPath` and read the FROZEN control core's `hello` — the
 *  version-agnostic handshake, always reachable even at a `padiSurface` skew (the
 *  control-core schemas never move). Mirrors `connectKaval` on link choice:
 *  `dialSocket` + `stdioLink` (NOT `unixSocketLink`, which hides the socket's
 *  `close` event the endpoint's `onClose` needs). Rejects with a plain Error if
 *  the socket is unreachable or `hello` is unreadable — a non-skew failure. */
async function dialPadiHello(socketPath: string): Promise<PadiDial> {
  const socket = await dialSocket(socketPath);
  const client = stdioLink<PadiDaemonContract>({
    read: socket,
    write: socket,
  }) as PadiDaemonClient;
  try {
    const hello = await client.surface.control.core.hello();
    return { socket, client, hello };
  } catch (err) {
    socket.destroy();
    throw new Error(
      `padi handshake failed — could not read control.core.hello (${(err as Error).message})`,
    );
  }
}

/**
 * Dial padi, handshake the FROZEN control core, and return the live connection.
 * Typed to `PadiDaemonContract` so the handshake reaches
 * `client.surface.control.core.hello()`.
 *
 * The handshake gates on the SURFACE version (`hello.surfaceVersion` vs
 * `PADI_SURFACE_VERSION`), NOT the frozen control-core version (which never
 * moves). Three failure classes, same as connectKaval:
 *   - raw socket error → plain reject (transient);
 *   - unreadable hello → plain Error (non-skew);
 *   - genuine surface skew → `DaemonContractSkewError` — the endpoint's generic
 *     signal to REFUSE (padi left standing + degraded, never recycled — a binder
 *     never kill-9's a running padi, #1313 inversion). The NEWER-binder DRAIN arm
 *     runs BEFORE this, in `bindPadiOnce`'s pre-flight (`probePadiSkew`), so by the
 *     time the endpoint calls `connectPadi` a newer binder's skewed survivor is
 *     already drained + gone and this connect is against the fresh newer closure.
 */
export async function connectPadi(socketPath: string): Promise<PadiConnection> {
  const { socket, client, hello } = await dialPadiHello(socketPath);

  if (
    !isContractVersionCompatible(hello.surfaceVersion, PADI_SURFACE_VERSION)
  ) {
    socket.destroy();
    throw new DaemonContractSkewError(
      `padi contract skew: padi serves padiSurface ${hello.surfaceVersion}, binder needs ${PADI_SURFACE_VERSION}`,
    );
  }

  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    client,
    identity: {
      stateRoot: hello.stateRoot,
      surfaceVersion: hello.surfaceVersion,
    },
    // padi's HONEST boot time — stamped once at padi's daemon init and echoed by
    // the frozen `hello` (W2.2 added `startedAt` to `PadiHelloSchema`), so a
    // reconnect reports true uptime instead of resetting the age to `Date.now()`.
    startedAt: hello.startedAt,
    metadata: {
      surfaceVersion: hello.surfaceVersion,
      controlCoreVersion: hello.controlCoreVersion,
    },
    dispose: () => socket.destroy(),
    onClose: (cb) => {
      if (closed) queueMicrotask(cb);
      else socket.once("close", cb);
    },
  };
}

/** The minimal connection shape the drain plumbing needs: the COMBINED dialed
 *  client (to reach `surface.control.core.drain`) and an `onClose` (the socket
 *  close that is the drain's ground truth). Both a held endpoint connection
 *  (`endpoint.current()`) and a fresh skew probe (`probePadiSkew`) satisfy it. */
type DrainableConn = {
  client: PadiDaemonClient;
  onClose: (cb: () => void) => void;
};

/**
 * DRAIN a padi over the FROZEN control core, then confirm it actually exited by
 * the SOCKET CLOSING within the teardown window. The one drain mechanism, shared
 * by BOTH the user-facing "restart" (`PadiBindingSession.drainBoundPadi`) and the
 * newer-binder convergence drain (`drainSkewedSurvivorIfNewer`) — never re-rolled.
 *
 * GROUND TRUTH is the SOCKET CLOSE (padi actually exited), NOT the drain call's
 * resolve/reject. padi's `onDrain` persists, REPLIES, then triggers the exit that
 * closes the socket — so `drain()` can RESOLVE with padi still momentarily alive
 * (a reply beats the exit), or REJECT (the reply lost as the socket died mid-write),
 * and neither is the completion signal. Waiting only for the resolve would let the
 * convergence pre-flight race `adoptOrSpawnOrRefuse` in and RE-ADOPT the still-live,
 * about-to-exit padi (its gate pid unchanged) — the bug the newer-drain arm exists
 * to avoid. So we ALWAYS wait for the socket to close (the same signal the endpoint
 * reads to flip to `degraded`), and FAIL-FAST if it does not close within the
 * teardown window (a wedged `onDrain`, or a stale link the drain never reached) —
 * so no caller reports success on a drain that did not happen, and the pre-flight
 * never spawns over a padi that did not exit.
 */
async function drainViaControlCore(conn: DrainableConn): Promise<void> {
  // Arm the close wait BEFORE the drain, so a fast exit that closes the socket
  // before `drain()` even settles is never missed.
  let onClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    onClosed = resolve;
  });
  conn.onClose(onClosed);

  // Kick the drain. `.catch` keeps a mid-write rejection from going unhandled and
  // remembers it only to enrich a timeout failure — the call's outcome does not
  // decide completion (the socket close does).
  let drainErr: unknown;
  void conn.client.surface.control.core.drain().catch((e) => {
    drainErr = e;
  });

  let timer!: ReturnType<typeof setTimeout>;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), DRAIN_TEARDOWN_CEILING_MS);
  });
  try {
    const outcome = await Promise.race([
      closed.then(() => "closed" as const),
      timedOut,
    ]);
    if (outcome === "timeout") {
      throw new Error(
        `padi drain did not complete — its socket did not close within ${DRAIN_TEARDOWN_CEILING_MS}ms (padi did not exit)` +
          (drainErr ? `; drain call rejected: ${String(drainErr)}` : ""),
      );
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1b. The newer-binder DRAIN arm (newest-wins convergence) — pre-flight to the
//     endpoint's generic adopt-or-spawn-or-refuse. Reaches padi's FROZEN control
//     core (always live at a skew), decides upgrade-me vs drain-you, and — only
//     when strictly NEWER — drains the running padi so the spawn path below brings
//     up this binder's own newer closure. Older/behind is a no-op here (the
//     endpoint's refuse arm handles it, UNCHANGED).
// ─────────────────────────────────────────────────────────────────────────────

/** A live probe of a running padi's identity + a way to drain it. Its `drain`
 *  reuses {@link drainViaControlCore} (RPC + socket-close window); `dispose` drops
 *  the probe socket. */
export type PadiSkewProbe = {
  hello: PadiHello;
  drain: () => Promise<void>;
  dispose: () => void;
};

/** Dial a possibly-running padi and return a {@link PadiSkewProbe}, or `null` if
 *  none answers (a fresh boot, or padi mid-teardown) — in which case the caller's
 *  `adoptOrSpawnOrRefuse` simply spawns fresh. This is the intended first use of
 *  the frozen control core: "a binder dials the socket, reads control.hello FIRST"
 *  (controlCore.ts), then decides. */
export async function probePadiSkew(
  socketPath: string,
): Promise<PadiSkewProbe | null> {
  let dialed: PadiDial;
  try {
    dialed = await dialPadiHello(socketPath);
  } catch {
    return null; // no live padi answering — nothing to drain; spawn will handle it.
  }
  const { socket, client, hello } = dialed;
  let closed = false;
  socket.once("close", () => {
    closed = true;
  });
  return {
    hello,
    drain: () =>
      drainViaControlCore({
        client,
        onClose: (cb) => {
          if (closed) queueMicrotask(cb);
          else socket.once("close", cb);
        },
      }),
    dispose: () => socket.destroy(),
  };
}

/**
 * The newer-binder DRAIN decision + action. Given a probe of the running padi and
 * THIS binder's expected `padiSurface` version:
 *   - no live survivor            → no-op (spawn path brings a fresh padi up);
 *   - compatible survivor          → no-op (`adoptOrSpawnOrRefuse` ADOPTS it);
 *   - skew, binder OLDER / behind  → no-op (`adoptOrSpawnOrRefuse` REFUSES →
 *                                    degraded, UNCHANGED). Older NEVER drains;
 *   - skew, binder strictly NEWER  → DRAIN the running padi over the frozen
 *                                    control core (persist + exit; its kaval + PTYs
 *                                    survive), so the spawn path that follows brings
 *                                    up this binder's OWN newer closure.
 *
 * FAIL-FAST, NEVER KILL: if the drain RPC never reaches padi, or padi does not exit
 * within the teardown window, this does NOT SIGKILL — it logs the honest error and
 * returns. The `adoptOrSpawnOrRefuse` that follows then re-probes the still-skewed,
 * still-standing survivor and REFUSES → degraded, so the reconnect loop keeps
 * trying to converge without ever nuking a running padi and without a half-drained
 * respawn that could livelock.
 */
async function drainSkewedSurvivorIfNewer(deps: {
  probe: () => Promise<PadiSkewProbe | null>;
  binderVersion: string;
  log: ConvergeLogger;
}): Promise<void> {
  const probe = await deps.probe();
  if (!probe) return;
  try {
    const running = probe.hello.surfaceVersion;
    if (isContractVersionCompatible(running, deps.binderVersion)) return; // adopt
    if (!isBinderNewer(deps.binderVersion, running)) {
      // Skew, but the binder is OLDER / major-behind — REFUSE, never drain. Left
      // to the endpoint's refuse arm (the #1313 inversion + the monotonicity).
      deps.log.warn(
        { binderVersion: deps.binderVersion, running },
        "padi survivor is a padiSurface skew and this binder is OLDER/behind — " +
          "REFUSING (never draining a running padi); adoptOrSpawnOrRefuse leaves " +
          "it standing + degraded. Upgrade this binder to converge.",
      );
      return;
    }
    deps.log.info(
      { binderVersion: deps.binderVersion, running },
      "padi survivor is a padiSurface skew and this binder is NEWER — draining it " +
        "(persist + exit; its kaval + PTYs survive) so the spawn path brings up " +
        "this binder's own newer closure (newest-wins convergence)",
    );
    try {
      await probe.drain();
    } catch (err) {
      deps.log.error(
        { err, binderVersion: deps.binderVersion, running },
        "newer-binder drain of a skewed padi FAILED (padi did not exit in the " +
          "teardown window) — NOT killing it; adoptOrSpawnOrRefuse will refuse " +
          "(degraded) and the reconnect loop will retry, so no livelock, no SIGKILL",
      );
    }
  } finally {
    probe.dispose();
  }
}

/**
 * ONE bind attempt under the NEWEST-WINS convergence policy: pre-flight the
 * newer-binder drain, then run the endpoint's generic adopt-or-spawn-or-refuse.
 *
 * The two-step is the whole arm. The pre-flight ({@link drainSkewedSurvivorIfNewer})
 * is the ONLY place the padi-specific version ORDERING lives (the endpoint stays
 * soul-agnostic — it only knows the typed `DaemonContractSkewError`); it drains a
 * strictly-newer binder's skewed survivor so that the `adoptOrSpawnOrRefuse` that
 * follows finds NO survivor and spawns this binder's own newer closure. In every
 * other case the pre-flight is a no-op and `adoptOrSpawnOrRefuse` does exactly what
 * it does today: adopt a compatible survivor, refuse an older/behind skew
 * (degraded), or spawn fresh when none is running.
 *
 * Exposed (over injectable deps) so the drain-vs-refuse DECISION, the drain→spawn
 * wiring, and the no-flap convergence are unit-testable without a real padi.
 * Resolves whatever `adoptOrSpawnOrRefuse` resolves (whether a survivor was
 * adopted).
 */
export async function bindPadiOnce(deps: {
  endpoint: Pick<PadiEndpoint, "adoptOrSpawnOrRefuse">;
  probe: () => Promise<PadiSkewProbe | null>;
  binderVersion: string;
  log: ConvergeLogger;
}): Promise<boolean> {
  await drainSkewedSurvivorIfNewer({
    probe: deps.probe,
    binderVersion: deps.binderVersion,
    log: deps.log,
  });
  return deps.endpoint.adoptOrSpawnOrRefuse();
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. localPadiDriver — the twin of localKavalDriver (…/ptyHost/localDriver.ts)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The daemon-operational env padi needs that a transient systemd unit's env reset
 * would otherwise drop. Twin of `daemonEnv` (localDriver.ts), carrying padi's
 * state-anchoring vars too:
 *   - `XDG_RUNTIME_DIR`      — decides the digest-keyed socket dir.
 *   - `KOLU_STATE_DIR`       — the LEGACY conf path; padi's one-shot import
 *                              (importLegacy.ts) migrates it into the state-root
 *                              on first boot. Forwarded so the migration finds the
 *                              old `~/.config/kolu` blob.
 *   - `KOLU_PADI_STATE_DIR`  — the RESOLVED state-root, pinned explicitly so the
 *                              digest (socket + kaval) is stable and matches what
 *                              the binder dials.
 *   - `KOLU_KAVAL_SPAWN`     — forwarded so padi's OWN kaval driver honors the
 *                              detached escape for dev/e2e.
 *   - `LOG_LEVEL`            — the effective log level, so padi's OWN pino domain
 *                              logger (`packages/padi/src/log.ts`, what the relocated
 *                              domain code logs through) honors it across the
 *                              transient unit's env reset. `--verbose` forces `debug`
 *                              — the split-process twin of the pre-cutover
 *                              `padiLog.level = "debug"`; else an operator's explicit
 *                              `LOG_LEVEL` crosses the boundary.
 *   - `NODE_OPTIONS` (scrubbed) + `KOLU_DIAG_DIR` — as kaval's driver forwards.
 *
 * The nix-shell env WHITELIST rides padi's CLI flag (`--allow-nix-shell-with-env-
 * whitelist`, see `resolvePadiLaunch`); the whitelisted VARS themselves need no
 * explicit forwarding here — a whitelist only applies under a nix shell, which is
 * always the dev/e2e (`fromSource`) path, and the survivable-spawn driver layers
 * the child env OVER the full parent env on that path (systemd/prod runs off-nix).
 */
function daemonEnv(
  resolvedStateRoot: string,
  verbose: boolean,
): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.XDG_RUNTIME_DIR)
    env.XDG_RUNTIME_DIR = process.env.XDG_RUNTIME_DIR;
  if (process.env.KOLU_STATE_DIR)
    env.KOLU_STATE_DIR = process.env.KOLU_STATE_DIR;
  // Pin padi's state-root explicitly so the digest (socket + kaval) is stable and
  // matches what the binder dials.
  env.KOLU_PADI_STATE_DIR = resolvedStateRoot;
  if (process.env.KOLU_KAVAL_SPAWN)
    env.KOLU_KAVAL_SPAWN = process.env.KOLU_KAVAL_SPAWN;
  // Carry the effective log level to padi's pino domain logger across the unit's env
  // reset — `--verbose` forces `debug` (the split-process twin of the pre-cutover
  // `padiLog.level = "debug"`), else forward an explicit operator `LOG_LEVEL`.
  const logLevel = verbose ? "debug" : process.env.LOG_LEVEL;
  if (logLevel) env.LOG_LEVEL = logLevel;
  const nodeOptions = scrubDaemonNodeOptions(process.env.NODE_OPTIONS);
  if (nodeOptions !== undefined) env.NODE_OPTIONS = nodeOptions;
  if (process.env.KOLU_DIAG_DIR) env.KOLU_DIAG_DIR = process.env.KOLU_DIAG_DIR;
  // Forward kaval's build identity for the FROM-SOURCE / dev path ONLY: the nix-built
  // padi wrapper BAKES `KAVAL_BUILD_ID` / `KAVAL_COMMIT_HASH` (padi owns kaval — its
  // closure knows them at build time; see default.nix), so a production padi already
  // has them. But a from-source padi (e2e / dev, no wrapper) would otherwise inherit
  // nothing, leaving its kaval-currency check (`expectedKaval`, terminalEndpoint/
  // reattach.ts) reading "" so the "update available" nudge can never fire. Forward
  // kolu-server's own baked value so dev matches production.
  if (process.env.KAVAL_BUILD_ID)
    env.KAVAL_BUILD_ID = process.env.KAVAL_BUILD_ID;
  if (process.env.KAVAL_COMMIT_HASH)
    env.KAVAL_COMMIT_HASH = process.env.KAVAL_COMMIT_HASH;
  return env;
}

/** Resolve how to launch padi: the built wrapper in production (`KOLU_PADI_BIN`),
 *  or the from-source `node --import <tsx> packages/padi/src/bin.ts` shape in
 *  dev/e2e. Twin of `resolveKavalLaunch`. padi is ALWAYS told its state-root via
 *  `--state-root` (so the digest, socket, and its kaval all follow it), the
 *  nix-shell whitelist via `--allow-nix-shell-with-env-whitelist` when set, and the
 *  kolu app version via `--spawn-version` — so spawned PTYs' `TERM_PROGRAM_VERSION`
 *  stays the kolu app version (byte-identical to the pre-cutover in-process spawn),
 *  not padi's own commit hash. Omit the version → padi falls back to its own commit
 *  (a standalone padi with no binder to forward the app version). */
export function resolvePadiLaunch(
  stateRoot: string,
  nixShellWhitelist: string | undefined,
  spawnVersion: string | undefined,
): { binPath: string; args: string[] } {
  const baseArgs = ["--state-root", stateRoot];
  if (nixShellWhitelist != null)
    baseArgs.push("--allow-nix-shell-with-env-whitelist", nixShellWhitelist);
  if (spawnVersion != null) baseArgs.push("--spawn-version", spawnVersion);

  const wrapper = process.env.KOLU_PADI_BIN;
  if (wrapper) return { binPath: wrapper, args: baseArgs };

  // Dev/e2e: reproduce padi's launcher from source. tsx resolved via the package
  // (not a hoisted .bin), exactly as localDriver.ts does for kaval.
  const require = createRequire(import.meta.url);
  const tsxLoader = pathToFileURL(require.resolve("tsx")).href;
  // packages/server/src/padiBinding.ts → packages/padi/src/bin.ts
  const binTs = fileURLToPath(
    new URL("../../padi/src/bin.ts", import.meta.url),
  );
  return {
    binPath: process.execPath,
    args: ["--import", tsxLoader, binTs, ...baseArgs],
  };
}

/** The padi driver: `survivableSpawnDriver` bound to padi's values. Twin of
 *  `localKavalDriver`. Under systemd-run (`--user`, INVOCATION_ID) so padi's
 *  NESTED kaval lands in its OWN unit that outlives padi restarts; `fromSource`
 *  is the detached escape (`KOLU_PADI_SPAWN=detached` OR no `KOLU_PADI_BIN`) — the
 *  exact twin of kaval's `KOLU_KAVAL_SPAWN`, not a new knob class. It covers dev/
 *  e2e (from-source, already detached) AND a nix-built kolu on a **bare,
 *  non-systemd box** (a `pu` box, a bare container): there `KOLU_PADI_BIN` is
 *  baked so the driver would try `systemd-run --user`, but with no user session
 *  that fails — set `KOLU_PADI_SPAWN=detached` to spawn detached instead. A real
 *  systemd host (kolu under `kolu.service`) needs neither. */
export function localPadiDriver(
  stateRoot: string,
  nixShellWhitelist: string | undefined,
  spawnVersion: string | undefined,
  verbose: boolean,
): DaemonDriver {
  const { binPath, args } = resolvePadiLaunch(
    stateRoot,
    nixShellWhitelist,
    spawnVersion,
  );
  const fromSource =
    !process.env.KOLU_PADI_BIN || process.env.KOLU_PADI_SPAWN === "detached";
  return survivableSpawnDriver({
    binPath,
    args,
    env: daemonEnv(stateRoot, verbose),
    unitPrefix: "padi",
    fromSource,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. PadiBindingSession — Endpoint → reconnect-mirror `HostSession` adapter.
//    ⚠️ NO kaval analog. THIS is the crux the cutover adds. `reServeSurface`'s
//    pump loops on the `currentClient()` promise identity + `onState`; the
//    supervisor Endpoint holds ONE connection and flips to `degraded` on close
//    WITHOUT re-dialing. This adapter DRIVES the re-dial loop (`adoptOrSpawnOr-
//    Refuse` on degraded/dead) and projects endpoint status onto HostSessionState,
//    so the pump sees a fresh client per (re)bind.
// ─────────────────────────────────────────────────────────────────────────────

/** Project an endpoint status onto the browser-facing `HostSessionState` the
 *  connection cell reads (via `pipeSessionStateToCell`). The endpoint's
 *  connecting|connected|degraded|dead|restarting collapse onto the cell's
 *  connecting|connected|disconnected — degraded/dead stays "disconnected" so the
 *  re-serve reads as honestly reconnecting (the loop always re-dials). */
function projectEndpointStatus(s: PadiEndpointStatus): HostSessionState {
  const connection = match(s.state)
    .with("connected", () => "connected" as const)
    .with(P.union("connecting", "restarting"), () => "connecting" as const)
    // degraded | dead → disconnected: the loop always re-dials.
    .with(P.union("degraded", "dead"), () => "disconnected" as const)
    .exhaustive();
  return {
    connection,
    progressLines: [],
    remoteProgressLines: [],
    lastError: null,
    failureCause: null,
  };
}

export interface PadiBindingSessionDeps {
  endpoint: PadiEndpoint;
  /** Kick the boot/reconnect: `adoptOrSpawnOrRefuse` on boot, and again after a
   *  degraded close (re-adopt the surviving padi, or spawn fresh if it died). */
  connectOnce: () => Promise<boolean>;
  /** Backoff between a degraded close and the next reconnect attempt. */
  reconnectDelayMs?: number;
}

/**
 * The reconnect-mirror session over the supervisor Endpoint. Drives:
 *   - boot: `connectOnce()` → `endpoint.current()` holds the live connection.
 *   - reconnect: on the endpoint reporting degraded/dead, wait a backoff then
 *     `connectOnce()` again → a FRESH `currentClient()` promise → the pump rebinds.
 *   - onState: projected from the endpoint's onStatus (wired in ensurePadiBinding).
 *
 * Each successful connect swaps `clientPromise` to a NEW resolved promise so the
 * pump's client cursor advances on identity. `currentClient()`/`pin()` return the
 * padi-SIBLING-scoped client (`scopeSibling(combined, "padi")`).
 */
export class PadiBindingSession
  implements RemoteMirrorSession<typeof padiSurface.contract>
{
  private clientPromise: Promise<PadiSurfaceClient> | null = null;
  private destroyed = false;
  /** The bound padi's HONEST boot time (ms epoch) off its control-core `hello`
   *  (echoed on every `connected` endpoint status as `startedAt`), or `null` while
   *  padi is unbound. Managed on the SAME lifecycle as `clientPromise` — set on a
   *  fresh `connected` (a respawned padi is a new process, so its boot time is
   *  fresh), cleared to `null` on a degraded/dead close — so `padiStartedAt()` reports
   *  a real uptime or an honest "unknown", never a stale boot time from the old
   *  process. Feeds koluSurface's `processStartedAt` cell (the rail's padi uptime). */
  private padiStartedAtMs: number | null = null;
  /** The bound padi's HONEST `padiSurface` version off its control-core `hello`
   *  (`connectPadi` reads it into `identity.surfaceVersion`; the handshake proved
   *  it compatible), or `null` while padi is unbound. Managed on the SAME lifecycle
   *  as `clientPromise`/`padiStartedAtMs` — set on a fresh `connected`, cleared on a
   *  degraded/dead close — so `padiSurfaceVersion()` reports the version the LIVE
   *  padi actually serves or an honest "unknown", never a stale value from the old
   *  process. Feeds koluSurface's `daemonInventory` cell (the Padi dialog + rail
   *  chip's "contract v<x.y>" readout). */
  private padiSurfaceVersionStr: string | null = null;
  /** A reconnect timer is already scheduled — so overlapping degraded/dead events
   *  (a close, then the endpoint's own `dead` emit) don't STACK timers, each firing
   *  its own `adoptOrSpawnOrRefuse`. Cleared when the scheduled attempt fires. */
  private reconnectPending = false;
  private readonly stateListeners = new Set<(s: HostSessionState) => void>();
  private state: HostSessionState = projectEndpointStatus({
    state: "connecting",
  });

  constructor(private readonly deps: PadiBindingSessionDeps) {}

  /** Called by ensurePadiBinding on each endpoint status. Re-derives the scoped
   *  client on a fresh `connected`, and schedules a reconnect on degraded/dead. */
  onEndpointStatus(s: PadiEndpointStatus): void {
    // Manage the client handle FIRST (so a listener woken by fire() sees the fresh
    // currentClient()), then project + fire ONCE for every transition.
    match(s.state)
      .with("connected", () => {
        // padi's honest boot time rides the connected status (`hello.startedAt` →
        // endpoint `startedAt`). Read it off the STATUS, not `endpoint.current()`, so
        // a respawned padi's FRESH boot time lands (never the old process's).
        this.padiStartedAtMs = s.startedAt ?? null;
        const conn = this.deps.endpoint.current();
        if (conn) {
          // The bound padi's honest surface version off the handshake `hello`
          // (`connectPadi` → `identity.surfaceVersion`) — the version the LIVE padi
          // actually serves, so the Padi dialog/rail read it rather than the binder's
          // build constant.
          this.padiSurfaceVersionStr = conn.identity?.surfaceVersion ?? null;
          // Scope the COMBINED dialed client down to the padi sibling so the relay's
          // `client.surface.<member>` resolves at /surface/padi/<member>.
          const scoped = scopeSibling(
            conn.client,
            "padi",
          ) as unknown as PadiSurfaceClient;
          this.clientPromise = Promise.resolve(scoped);
        }
      })
      .with(P.union("degraded", "dead"), () => {
        // The live link dropped. Clear the client so a forward in the gap fails
        // honestly, clear padi's boot time so its uptime reads the honest "unknown"
        // (never a stale age), then schedule ONE reconnect (padi survives its own
        // unit; the re-adopt re-attaches the surviving kaval + PTYs).
        this.clientPromise = null;
        this.padiStartedAtMs = null;
        this.padiSurfaceVersionStr = null;
        this.scheduleReconnect();
      })
      // connecting | restarting: transient warming — no client-handle change; the
      // projected state below carries the frame.
      .with(P.union("connecting", "restarting"), () => {})
      .exhaustive();
    this.setState(projectEndpointStatus(s));
    this.fire();
  }

  /** Schedule a single reconnect, guarded so overlapping degraded/dead events
   *  don't stack timers. A fixed backoff is enough — `adoptOrSpawnOrRefuse` is
   *  itself idempotent (adopt the survivor, or spawn fresh). */
  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectPending) return;
    this.reconnectPending = true;
    setTimeout(() => {
      this.reconnectPending = false;
      if (this.destroyed) return;
      void this.deps.connectOnce().catch((err) => {
        // A failed reconnect leaves the endpoint reporting degraded/dead, which
        // fires onEndpointStatus again → the next scheduleReconnect keeps trying.
        log.error({ err }, "padi reconnect attempt failed");
      });
    }, this.deps.reconnectDelayMs ?? 2000);
  }

  pin(): Promise<PadiSurfaceClient> {
    // The pump pins ONCE. If no client yet, reject harmlessly — the cursor falls
    // through to currentClient() on the next onState fire.
    return (
      this.clientPromise ?? Promise.reject(new Error("padi not connected yet"))
    );
  }

  currentClient(): Promise<PadiSurfaceClient> | null {
    return this.destroyed ? null : this.clientPromise;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  /** The bound padi's boot time (ms epoch), or `null` while padi is unbound (or the
   *  session is destroyed). kolu-server publishes `now`-relative uptime from this onto
   *  koluSurface's `processStartedAt` cell; `null` renders as the honest "unknown". */
  padiStartedAt(): number | null {
    return this.destroyed ? null : this.padiStartedAtMs;
  }

  /** The bound padi's `padiSurface` version off its control-core `hello`, or `null`
   *  while padi is unbound (or the session is destroyed). koluSurface's
   *  `daemonInventory` cell carries it as the active padi's `surfaceVersion`; `null`
   *  renders as the honest "—". */
  padiSurfaceVersion(): string | null {
    return this.destroyed ? null : this.padiSurfaceVersionStr;
  }

  onState(cb: (s: HostSessionState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.state); // snapshot-then-delta, like an inMemoryCell-backed onState.
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  markConnected(): void {
    // The pump calls this on the first folded frame. The endpoint already knows
    // it's connected (the handshake proved the link) and the connection cell is
    // driven by onState → projectConnection, so this is a no-op hook.
  }

  destroy(): void {
    this.destroyed = true;
    this.clientPromise = null;
    this.padiStartedAtMs = null;
    this.padiSurfaceVersionStr = null;
    this.deps.endpoint.current()?.dispose();
    // Re-publish to wake any cursor blocked on the next client so the pump exits.
    this.fire();
  }

  /** DRAIN the bound padi (the re-targeted "restart kaval" button, W2.2 gotcha 7):
   *  invoke the FROZEN control core's `drain` over the COMBINED dialed client —
   *  padi persists its layout + exits, its kaval + PTYs survive, the socket closes
   *  → the endpoint flips to degraded → the reconnect loop re-spawns padi onto the
   *  surviving kaval. NEVER a kill-9. The RPC/socket-close race is handled by the
   *  shared {@link drainViaControlCore} (the same plumbing the newer-binder
   *  convergence drain reuses), so the "restart" verb never reports success on a
   *  drain that did not happen. */
  async drainBoundPadi(): Promise<void> {
    const conn = this.deps.endpoint.current();
    if (!conn) {
      throw new Error("padi is not bound — cannot drain (the daemon is down)");
    }
    await drainViaControlCore(conn);
  }

  private setState(s: HostSessionState): void {
    this.state = s;
  }
  private fire(): void {
    // Guard each listener at the funnel: a throwing subscriber must NOT abort the
    // fan-out and silently drop this transition for the listeners after it. One
    // registrant exists today (`reServeSurface`'s state→cell pipe), but the public
    // `onState` Set can hold more. Log the throw (a listener that throws is a real
    // error, errors-must-log-at-error) and carry on. (callback-fanout-guarded-at-funnel.)
    for (const cb of [...this.stateListeners]) {
      try {
        cb(this.state);
      } catch (err) {
        log.error({ err }, "padi binding state listener threw");
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. ensurePadiBinding — the twin of ensureLocalEndpoint (…/ptyHost/index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export interface EnsurePadiBindingOptions {
  /** Explicit state-root override (dev/e2e); else `resolvePadiStateRoot`'s default
   *  (`KOLU_PADI_STATE_DIR` else the binary default). */
  stateRoot?: string;
  /** The nix-shell env whitelist forwarded to padi as its CLI flag. */
  nixShellWhitelist?: string;
  /** The kolu app version to stamp as spawned PTYs' `TERM_PROGRAM_VERSION`,
   *  forwarded to padi's `--spawn-version` so the terminal identity stays the kolu
   *  app version (not padi's own commit). Omitted → padi falls back to its own
   *  commit/`dev` (a standalone padi with no binder forwarding the app version). */
  spawnVersion?: string;
  /** Forward the server's `--verbose` intent to padi's process as `LOG_LEVEL=debug`
   *  so padi's OWN pino domain logger emits debug — the split-process twin of the
   *  pre-cutover `padiLog.level = "debug"`. Omitted/false → padi honors an explicit
   *  operator `LOG_LEVEL`, else its `info` default. */
  verbose?: boolean;
  /** Reconnect backoff (test hook). */
  reconnectDelayMs?: number;
}

/** The single local padi host id — the endpoint's status key. Distinct from
 *  kaval's `LOCAL_HOST_ID` (kaval now lives INSIDE padi). */
export const PADI_HOST_ID = "padi-local";

/**
 * Boot the padi binding under the ADOPT-OR-SPAWN-OR-REFUSE policy and return the
 * reconnect-mirror session `reServeSurface` consumes. Twin of `ensureLocalEndpoint`,
 * but:
 *   - calls `ep.adoptOrSpawnOrRefuse()` — a proven `padiSurface` skew REFUSES
 *     (leaves padi standing + degraded), NEVER recycles a running padi (#1313);
 *   - has NO onAdopted/onNotAdopted/onBootSettled hooks — those are padi's OWN
 *     concern now (they run inside `runPadiDaemon`). The binder only establishes +
 *     re-serves the link;
 *   - the binder's own health (padi up/down) rides the re-serve's `connection`
 *     cell, NOT padi's `daemonStatus` collection (padi's own kaval publishes to
 *     THAT, and the re-serve mirrors it) — so this endpoint does not double-publish.
 *
 * Fail-open on boot error: the endpoint already reported `dead`; don't crash the
 * server boot (same stance as `ensureLocalEndpoint`).
 */
export async function ensurePadiBinding(
  opts: EnsurePadiBindingOptions,
): Promise<PadiBindingSession> {
  const stateRoot = resolvePadiStateRoot(opts.stateRoot);
  const socketPath = padiSocketPath(stateRoot);
  const gatePath = padiGatePath(socketPath);

  // The session is created after the endpoint (its onStatus drives the session),
  // but the endpoint's onStatus closure references `session` — assigned before the
  // first `adoptOrSpawnOrRefuse` await below, so no status can fire before it exists.
  let session!: PadiBindingSession;

  const ep = createEndpoint<
    PadiDaemonClient,
    PadiIdentity,
    PadiConnectionMetadata
  >({
    hostId: PADI_HOST_ID,
    gatePath, // reuse padi's pid gate as-is.
    socketPath,
    driver: localPadiDriver(
      stateRoot,
      opts.nixShellWhitelist,
      opts.spawnVersion,
      opts.verbose ?? false,
    ),
    connect: () => connectPadi(socketPath),
    log,
    onStatus: (_hostId, status) => {
      // Drive the reconnect-mirror session; the binder's link health rides the
      // re-serve `connection` cell, so there is nothing to publish to daemonStatus.
      session?.onEndpointStatus(status);
    },
  });

  // One bind attempt under the newest-wins convergence policy: pre-flight the
  // newer-binder drain (this binder's `PADI_SURFACE_VERSION` vs the running padi's
  // `hello.surfaceVersion`), then the endpoint's generic adopt-or-spawn-or-refuse.
  // Used for BOTH boot and reconnect — a fresh deploy dialing a running older padi
  // is the primary case (drain it → spawn our own newer closure); a skew where we
  // are older/behind refuses, UNCHANGED.
  const connectOnce = (): Promise<boolean> =>
    bindPadiOnce({
      endpoint: ep,
      probe: () => probePadiSkew(socketPath),
      binderVersion: PADI_SURFACE_VERSION,
      log,
    });

  session = new PadiBindingSession({
    endpoint: ep,
    // Reconnect = re-run the boot policy: drain-if-newer, then adopt the surviving
    // padi (its socket + its kaval's PTYs persist), or spawn fresh if it died.
    // NEVER recycles on skew; older never drains.
    connectOnce,
    reconnectDelayMs: opts.reconnectDelayMs,
  });

  try {
    await connectOnce(); // newer → drain + spawn; older skew → REFUSE (degraded).
  } catch (err) {
    // The endpoint already reported `dead`; don't crash the server boot.
    log.error({ err }, "padi endpoint failed to come up at boot");
  }

  return session;
}
