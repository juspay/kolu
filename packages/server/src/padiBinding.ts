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
 * The DIAL itself (`connectPadi` / `dialPadiHello` — dial + control-core
 * handshake + typed skew refusal) is imported from `@kolu/padi/dial`: W2.3 carved
 * it into padi's package as the client-side dial kit `padi-tui` shares. What stays
 * here is SUPERVISION over that dial — the parts that mutate padi's lifecycle:
 *   1. the version ORDERING + `bindPadiOnce` — the drain-vs-refuse convergence.
 *   2. `localPadiDriver`      — the twin of `localKavalDriver`: how to launch padi.
 *   3. `PadiBindingSession`   — Endpoint → reconnect-mirror `HostSession` (the crux).
 *   4. `ensurePadiBinding`    — the twin of `ensureLocalEndpoint`: boot the binding.
 *
 * padi is NEVER kill-9'd. The boot/reconnect policy is `bindPadiOnce` — the
 * convergence pre-flight the frozen control core was designed for
 * (`controlCore.ts`: "upgrade-me (binder older → refuse) vs drain-you (binder
 * newer → control.drain)"), layered over the endpoint's generic
 * `adoptOrSpawnOrRefuse`. It converges on TWO independent axes:
 *   - CONTRACT (`padiSurface` version): a skew where THIS binder is NEWER →
 *     DRAIN it over the frozen control core (persist + exit; its kaval + PTYs
 *     survive), so the spawn path brings up this binder's OWN newer closure —
 *     the padi gate pid changes, the surviving kaval is re-adopted, the session
 *     is intact; a skew where the binder is OLDER / major-behind → the endpoint's
 *     loud REFUSE, UNCHANGED (leave padi standing + degraded, never touch it).
 *     Older NEVER drains — that asymmetry is the monotonicity that stops two
 *     mixed-version binders from livelocking (only the strictly-newer one acts).
 *   - BUILD (same contract, different closure; #1670): when the handshake would
 *     otherwise ADOPT, a survivor whose baked `PADI_BUILD_ID` differs from this
 *     binder's expected one (or is ABSENT — a pre-field survivor, an older build)
 *     is DRAINED ONCE at boot so the spawn brings up this binder's build. Store
 *     hashes don't order, so the anti-livelock guarantee here is a once-per-binder-
 *     boot fence ({@link BuildDrainFence}) rather than a version comparison — a
 *     reconnect never re-drains, so sequential deploys converge to last-deployed.
 * And the "restart" verb DRAINS the running padi (persist + exit; the PTYs
 * survive in kaval) via the frozen control core, then the reconnect loop
 * re-spawns it.
 */

import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  currentPadiBuildId,
  padiGatePath,
  padiSocketPath,
  resolvePadiStateRoot,
} from "@kolu/padi/assembly";
// The client-side dial kit — carved out of THIS module in W2.3 so `padi-tui` and
// the binder share it (`@kolu/padi/dial`). What stays here is SUPERVISION: the
// drivers, the newer-binder drain convergence, the reconnect-mirror session, and
// the re-serve — everything that mutates padi's lifecycle, never a mere dial.
import {
  connectPadi,
  dialPadiHello,
  type PadiConnectionMetadata,
  type PadiDaemonClient,
  type PadiDial,
  type PadiIdentity,
  scopePadiSurface,
  type PadiSurfaceClient,
} from "@kolu/padi/dial";
import {
  PADI_SURFACE_VERSION,
  type PadiHello,
  type padiSurface,
} from "@kolu/padi/surface";
import { isContractVersionCompatible } from "@kolu/surface/define";
import {
  createEndpoint,
  type DaemonDriver,
  type Endpoint,
  type EndpointStatus,
  scrubDaemonNodeOptions,
  survivableSpawnDriver,
} from "@kolu/surface-daemon-supervisor";
import type {
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
//
// The connection/identity/client types (`PadiDaemonClient`, `PadiSurfaceClient`,
// `PadiIdentity`, `PadiConnectionMetadata`, `PadiConnection`, `PadiDial`) moved
// into `@kolu/padi/dial` with `connectPadi` in W2.3 and are imported above. The
// SUPERVISION-only endpoint types stay here — they parameterize the supervisor
// `Endpoint` a binder owns, which a plain dial has no business naming.

type PadiEndpoint = Endpoint<
  PadiDaemonClient,
  PadiIdentity,
  PadiConnectionMetadata
>;
type PadiEndpointStatus = EndpointStatus<PadiIdentity, PadiConnectionMetadata>;

// ─────────────────────────────────────────────────────────────────────────────
// 1. The version ORDERING (drain-vs-refuse) — the SUPERVISION half of the
//    newest-wins convergence the dial kit (`@kolu/padi/dial`) deliberately omits.
//    A plain dial only judges COMPATIBILITY (`connectPadi` refuses a skew it can't
//    speak to); ORDERING two proven-skewed versions to decide which side drains is
//    a supervisor's call, so it stays here beside `probePadiSkew`/`bindPadiOnce`.
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

// `connectPadi` + `dialPadiHello` (dial + control-core handshake + typed skew
// refusal) live in `@kolu/padi/dial` now (imported above) — the shared dial kit.
// `probePadiSkew` below reuses `dialPadiHello` and layers the SUPERVISION judgement
// (`isBinderNewer` ordering → drain-vs-refuse) the dial kit deliberately excludes.

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
 * The once-per-binder-boot fence for the BUILD-mismatch drain arm (#1670).
 *
 * A binder drains a same-contract, DIFFERENT-BUILD survivor at most ONCE across its
 * whole process lifetime — a reconnect within the same binder process NEVER re-drains.
 * This is the anti-livelock guarantee for the build axis: store hashes DON'T order, so
 * a repeated mismatch-drain between two persistent binders at different builds would
 * livelock; the fence makes each binder drain at most once at ITS boot, so sequential
 * deploys converge to last-deployed and can never flap. It lives with the BINDER
 * PROCESS (created once in `ensurePadiBinding`), NOT the connection — so every
 * reconnect shares the one fence.
 *
 * Deliberately distinct from the CONTRACT newest-wins arm, which needs NO fence: its
 * monotone version ordering IS the anti-livelock guarantee (only the strictly-newer
 * binder ever drains, so an older binder never drains the newer's padi back).
 */
export type BuildDrainFence = {
  /** Has this binder already performed (or committed to) its ONE build-mismatch drain? */
  hasFired: () => boolean;
  /** Mark the one build-mismatch drain as done — no reconnect re-drains after this. */
  markFired: () => void;
};

/** A fresh, un-fired {@link BuildDrainFence}. Exactly one per binder boot. */
export function createBuildDrainFence(): BuildDrainFence {
  let fired = false;
  return {
    hasFired: () => fired,
    markFired: () => {
      fired = true;
    },
  };
}

/**
 * The SUPERSEDED-survivor DRAIN decision + action — the pre-flight to the endpoint's
 * generic adopt-or-spawn-or-refuse. Two independent axes, evaluated in order:
 *
 *   Axis 1 — the CONTRACT (`padiSurface` version). W2.2 newest-wins, UNCHANGED:
 *     - no live survivor            → no-op (spawn path brings a fresh padi up);
 *     - contract SKEW, binder NEWER → DRAIN (persist + exit; kaval + PTYs survive) so
 *                                     the spawn brings up this binder's newer closure;
 *     - contract SKEW, binder OLDER → no-op REFUSE (degraded, UNCHANGED). Older NEVER
 *                                     drains (the #1313 inversion + the monotonicity).
 *
 *   Axis 2 — the BUILD (same contract, different closure; #1670). Reached ONLY when
 *   the contract handshake would ADOPT (compatible). A same-contract but DIFFERENT-
 *   BUILD survivor is a padi-churn deploy: adopting it silently keeps the OLD padi
 *   code running (and there is no manual padi-restart to fall back on). So DRAIN it
 *   ONCE per binder boot so the spawn brings up THIS binder's build. Store hashes
 *   don't order → no "newer" build → the fence, not a version compare, is the
 *   anti-livelock guarantee.
 *
 *   The ABSENT case is load-bearing: a survivor whose hello carries NO `buildId`
 *   predates the field, so it is by definition an OLDER build than this (nix-built)
 *   binder — treat it as a MISMATCH and DRAIN, or the fix would fail to fire on the
 *   very first upgrade past a pre-field padi (the zest class it exists for). Only an
 *   OFF-NIX binder (its own `binderBuildId` is `""`) never drains on build grounds —
 *   it cannot judge builds.
 *
 * FAIL-FAST, NEVER KILL, on EITHER axis: if the drain RPC never reaches padi, or padi
 * does not exit within the teardown window, this does NOT SIGKILL — it logs the honest
 * error and returns. The `adoptOrSpawnOrRefuse` that follows re-probes the still-
 * standing survivor (a contract skew → REFUSE/degraded; a build mismatch → ADOPT the
 * old build, degraded and logged loudly), so the loop keeps converging without ever
 * nuking a running padi. On the build axis the fence is spent even on failure, so no
 * reconnect re-drains (#1034: drain-only, degraded-loudly, no livelock).
 */
async function drainSupersededSurvivor(deps: {
  probe: () => Promise<PadiSkewProbe | null>;
  binderVersion: string;
  binderBuildId: string;
  buildDrainFence: BuildDrainFence;
  log: ConvergeLogger;
}): Promise<void> {
  const probe = await deps.probe();
  if (!probe) return;
  try {
    const running = probe.hello.surfaceVersion;

    // ── Axis 1 — the CONTRACT. On a skew the contract decides; the build id is
    // irrelevant (a contract change always drains-if-newer / refuses-if-older). ──
    if (!isContractVersionCompatible(running, deps.binderVersion)) {
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
      return;
    }

    // ── Axis 2 — the BUILD (same contract; #1670). ADOPT (no build drain) only when
    // we cannot or need not converge: an off-nix binder can't judge builds, a
    // provably-equal build is already ours, or the fence already fired this boot.
    // Everything else — a different id, OR an ABSENT id (a pre-field survivor, which
    // is by definition an older build than this nix-built binder) — is a MISMATCH we
    // drain once. `?? ""` folds absent → "", which never equals a nix binder's own
    // non-empty id, so absent correctly falls through to the drain. ──
    const runningBuild = probe.hello.buildId ?? "";
    if (
      deps.binderBuildId === "" || // off-nix binder: cannot judge builds → never drains
      runningBuild === deps.binderBuildId || // provably the same build → adopt
      deps.buildDrainFence.hasFired() // already drained once this binder boot → adopt
    ) {
      return; // adopt the compatible survivor
    }

    // Commit the ONE build-mismatch drain this binder will ever do — marked BEFORE the
    // await, so even a drain failure spends the fence (degraded-loudly, never a retry
    // that could livelock two binders). The message text is a stable breadcrumb the
    // adoption VM arm greps: `padi build change on boot: running=<X> expected=<Y>`.
    deps.buildDrainFence.markFired();
    deps.log.info(
      { binderBuildId: deps.binderBuildId, runningBuild, running },
      `padi build change on boot: running=${runningBuild} expected=${deps.binderBuildId}` +
        " — draining the survivor once (persist + exit; its kaval + PTYs survive) and " +
        "respawning this binder's own build (drain-on-build-mismatch, #1670; store " +
        "hashes don't order, so this fires at most once per binder boot)",
    );
    try {
      await probe.drain();
    } catch (err) {
      deps.log.error(
        { err, binderBuildId: deps.binderBuildId, runningBuild },
        "build-mismatch drain FAILED (padi did not exit in the teardown window) — " +
          "NOT killing it; adoptOrSpawnOrRefuse will ADOPT the compatible (old-build) " +
          "survivor, degraded to the old build and logged loudly, and the fence stays " +
          "spent so no reconnect re-drains (#1034: drain-only, degraded-loudly, no livelock)",
      );
    }
  } finally {
    probe.dispose();
  }
}

/**
 * ONE bind attempt under the convergence policy: pre-flight the superseded-survivor
 * drain (contract axis + build axis), then run the endpoint's generic
 * adopt-or-spawn-or-refuse.
 *
 * The two-step is the whole arm. The pre-flight ({@link drainSupersededSurvivor}) is
 * the ONLY place the padi-specific version ORDERING and build-identity comparison live
 * (the endpoint stays soul-agnostic — it only knows the typed `DaemonContractSkewError`);
 * it drains a strictly-newer binder's contract-skewed survivor, OR a same-contract but
 * different-BUILD survivor (once per binder boot, guarded by `buildDrainFence`), so
 * that the `adoptOrSpawnOrRefuse` that follows finds NO survivor and spawns this
 * binder's own closure. In every other case the pre-flight is a no-op and
 * `adoptOrSpawnOrRefuse` does exactly what it does today: adopt a compatible
 * same-build survivor, refuse an older/behind contract skew (degraded), or spawn fresh
 * when none is running.
 *
 * Exposed (over injectable deps) so the drain-vs-refuse DECISION, the build fence, the
 * drain→spawn wiring, and the no-flap convergence are unit-testable without a real
 * padi. Resolves whatever `adoptOrSpawnOrRefuse` resolves (whether a survivor was
 * adopted).
 */
export async function bindPadiOnce(deps: {
  endpoint: Pick<PadiEndpoint, "adoptOrSpawnOrRefuse">;
  probe: () => Promise<PadiSkewProbe | null>;
  binderVersion: string;
  binderBuildId: string;
  buildDrainFence: BuildDrainFence;
  log: ConvergeLogger;
}): Promise<boolean> {
  await drainSupersededSurvivor({
    probe: deps.probe,
    binderVersion: deps.binderVersion,
    binderBuildId: deps.binderBuildId,
    buildDrainFence: deps.buildDrainFence,
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
  legacyKavalSocket: string | undefined,
): { binPath: string; args: string[] } {
  const baseArgs = ["--state-root", stateRoot];
  if (nixShellWhitelist != null)
    baseArgs.push("--allow-nix-shell-with-env-whitelist", nixShellWhitelist);
  if (spawnVersion != null) baseArgs.push("--spawn-version", spawnVersion);
  // The W2.2 upgrade bridge: hand padi the binder's OWN listen-port legacy kaval
  // socket so a first W2.2 boot ADOPTS a running pre-W2.2 kaval instead of leaking
  // it. Passed on EVERY spawn (never import-gated); padi ignores it once its own
  // digest kaval is live, so it is a harmless no-op after the migration converges.
  if (legacyKavalSocket != null)
    baseArgs.push("--legacy-kaval-socket", legacyKavalSocket);

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
  legacyKavalSocket: string | undefined,
): DaemonDriver {
  const { binPath, args } = resolvePadiLaunch(
    stateRoot,
    nixShellWhitelist,
    spawnVersion,
    legacyKavalSocket,
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

/**
 * What kolu-server needs from a bound padi, LOCAL or REMOTE: the
 * `RemoteMirrorSession` role `reServeSurface` consumes (pin · currentClient ·
 * onState · markConnected · isDestroyed · destroy) PLUS the four kolu-server-facing
 * readouts/verbs — the bound padi's honest identity (uptime · contract version ·
 * build commit, off the control-core `hello`) and the "restart" drain. index.ts
 * types `padiSession` as this, so the {@link PadiBindingSession} (local Endpoint)
 * and W3.1's `RemotePadiSession` (ssh HostSession) are interchangeable at the
 * composition root — the knob picks one, the re-serve and the router are identical.
 */
export interface BoundPadi
  extends RemoteMirrorSession<typeof padiSurface.contract> {
  /** Narrowed from the role's `Promise<unknown>` to the padi-scoped client: both
   *  arms yield exactly this, and kolu-server's iframe-preview + memory-sampler
   *  routes call `.surface.padi.*` on it (a return-type narrowing is legal — the
   *  role stays satisfied). */
  pin(): Promise<PadiSurfaceClient>;
  currentClient(): Promise<PadiSurfaceClient> | null;
  /** DRAIN the bound padi (the "restart" verb): persist + exit; its kaval + PTYs
   *  survive; the reconnect loop re-adopts/re-spawns. Never a kill-9. */
  drainBoundPadi(): Promise<void>;
  /** The bound padi's boot time (ms epoch), or `null` while unbound — the rail's
   *  padi uptime. */
  padiStartedAt(): number | null;
  /** The bound padi's `padiSurface` version off its control-core `hello`, or `null`
   *  while unbound — the daemonInventory "contract v<x.y>" readout. */
  padiSurfaceVersion(): string | null;
  /** The bound padi's navigable git build commit off its control-core `hello`, or
   *  `null` while unbound / when a survivor padi predates the field. */
  padiBuildCommit(): string | null;
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
 * padi-SIBLING-scoped client (the dial kit's `scopePadiSurface(combined)`).
 */
export class PadiBindingSession implements BoundPadi {
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
  /** The bound padi's navigable git commit off its control-core `hello`
   *  (`connectPadi` reads it into `identity.commit`), or `null` while unbound / when a
   *  survivor padi predates the field. Managed on the SAME lifecycle as
   *  `padiSurfaceVersionStr` — set on a fresh `connected`, cleared on close — so
   *  `padiBuildCommit()` reports the LIVE padi's build or an honest "unknown". Feeds
   *  koluSurface's `daemonInventory` cell (the Padi dialog's "build commit"). */
  private padiBuildCommitStr: string | null = null;
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
          // The RUNNING padi's build commit off the same hello identity (empty "" →
          // null, the honest "unknown", so off-nix reads "—" not a blank link).
          this.padiBuildCommitStr = conn.identity?.commit || null;
          // Scope the COMBINED dialed client down to the padi sibling so the relay's
          // `client.surface.<member>` resolves at /surface/padi/<member>. The binder
          // keeps `conn.client` (combined) for supervision (`control.core.drain`) and
          // uses the dial kit's projection only for the relay's scoped client.
          const scoped = scopePadiSurface(conn.client);
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
        this.padiBuildCommitStr = null;
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

  /** The bound padi's navigable git commit off its control-core `hello`, or `null`
   *  while unbound / when a survivor padi predates the field (or the session is
   *  destroyed). koluSurface's `daemonInventory` cell carries it as the active padi's
   *  `buildCommit`; `null` renders as the honest "—". */
  padiBuildCommit(): string | null {
    return this.destroyed ? null : this.padiBuildCommitStr;
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
    this.padiBuildCommitStr = null;
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
  /** The LEGACY per-port kaval socket to hint padi — the binder computes it from its
   *  OWN listen port (`legacyKavalSocketPath(port)`), so a first W2.2 boot ADOPTS the
   *  running pre-W2.2 kaval instead of leaking it. Forwarded to padi's
   *  `--legacy-kaval-socket` on EVERY spawn. Omitting it (a standalone padi bring-up)
   *  disables legacy adoption entirely — the binder is the ONLY hinter, and only of
   *  its own port, so a dev instance at another port is never adopted. */
  legacyKavalSocket?: string;
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
      opts.legacyKavalSocket,
    ),
    connect: () => connectPadi(socketPath),
    log,
    onStatus: (_hostId, status) => {
      // Drive the reconnect-mirror session; the binder's link health rides the
      // re-serve `connection` cell, so there is nothing to publish to daemonStatus.
      session?.onEndpointStatus(status);
    },
  });

  // The build axis's once-per-binder-boot fence + this binder's baked expected padi
  // build id (`PADI_BUILD_ID` — the id of the padi this binder would spawn, off the
  // koluBin wrapper). Created ONCE here (per server boot) and closed over by
  // `connectOnce`, so every reconnect shares the SAME fence and the build-mismatch
  // drain fires at most once across this binder's life (#1670).
  const buildDrainFence = createBuildDrainFence();
  const binderBuildId = currentPadiBuildId();

  // One bind attempt under the convergence policy: pre-flight the superseded-survivor
  // drain (contract axis — this binder's `PADI_SURFACE_VERSION` vs the running padi's
  // `hello.surfaceVersion`; AND build axis — `binderBuildId` vs `hello.buildId`), then
  // the endpoint's generic adopt-or-spawn-or-refuse. Used for BOTH boot and reconnect
  // — a fresh deploy dialing a running padi is the primary case (a contract skew drains
  // if newer / refuses if older; a same-contract build change drains once → spawn our
  // own build); an unchanged redeploy adopts, UNCHANGED.
  const connectOnce = (): Promise<boolean> =>
    bindPadiOnce({
      endpoint: ep,
      probe: () => probePadiSkew(socketPath),
      binderVersion: PADI_SURFACE_VERSION,
      binderBuildId,
      buildDrainFence,
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
