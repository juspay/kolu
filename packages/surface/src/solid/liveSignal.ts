/**
 * `createLiveSignal` — derive a transport-liveness `LiveSignal` for a reconnecting
 * wire AND wire the half-open watchdog that makes it honest, in ONE call. It
 * returns a {@link LiveSignalHandle} that bundles the watchdog-backed `live`, the
 * {@link SurfaceDispatch} it guards, and the `status`/`dispose` handles as ONE
 * inseparable object — and THAT object is the **unforgeable** unit, by every
 * vector:
 *
 *   - The brand is membership in a module-private, **un-reflectable** `WeakSet`
 *     ({@link LIVE_SIGNAL_HANDLES}). A `WeakSet` enumerates nothing, so a consumer
 *     holding a genuine handle cannot read the brand off it and copy it onto a
 *     hand-rolled `{ live, dispatch }` look-alike.
 *   - The only thing that adds to that set is `createLiveSignal` below, AFTER the
 *     watchdog is wired over the dispatch it guards — there is no exported stamper.
 *   - There is no `heartbeat: false` opt-out: `createLiveSignal` ALWAYS wires the
 *     watchdog, so a handle existing is proof a watchdog backs it.
 *   - The probe runs over the dispatch that rides the very wire being watched and
 *     reconnected, because both arrive as ONE {@link WireTransport} that a wire
 *     LINK FACTORY minted together — and this function REFUSES a transport whose
 *     dispatch is not `brandHalfOpenDispatch`-branded, which only such a factory
 *     applies. A consumer once handed back an in-memory probe target that resolved
 *     off a literal (never touching the socket) and so branded a dead link; there
 *     is now no caller-supplied probe target at all.
 *   - The dispatch the client is built over and the dispatch the watchdog probes
 *     are the SAME object — because `surfaceClient`/`surfaceClients` take the WHOLE
 *     handle and read `.dispatch` and `.live` off it themselves (you cannot hand
 *     them a `live` paired with a DIFFERENT, self-rolled wire dispatch). The
 *     pairing holds by construction, so there is nothing to re-prove at runtime.
 *
 * The probe gate reads the SAME `status` `live` reads (not a second, independent
 * reading of the socket), so a wire can't be "open enough to set live, too closed
 * to probe" — the gate and the signal can never disagree.
 *
 * So the half-open-blind transport leg (`() => true`, or an open/close-only
 * `() => status() === "live"`) is not merely refused by the guard — it literally
 * cannot be SPELLED: there is no reachable function that turns such an accessor
 * into a `LiveSignalHandle` (#1564, one seam up from the dot).
 *
 * It lives in `@kolu/surface` (not `@kolu/surface-app`) precisely so the brand set
 * and its sole minter share one module — co-location is what makes the stamp
 * un-namable from anywhere else. `@kolu/surface-app`'s `connectSurface` /
 * `connectSurfaces` wrap it (turnkey socket + client + watchdog); a hand-built
 * `surfaceClient` + wire link calls it directly. It depends only on Solid + the
 * framework-free `@kolu/surface/heartbeat` primitive + the transport-neutral
 * `WatchableWire` seam — no socket library, so the partysocket/`@effect/platform`
 * commitment stays out of this module entirely.
 */

import { Cause, Effect, Exit, type Fiber } from "effect";
import { type Accessor, createSignal } from "solid-js";
import { SURFACE_TAG_PREFIX, siblingTagPrefix, surfaceTag } from "../define";
import { createHeartbeat, type HeartbeatTuning } from "../heartbeat";
import {
  isHalfOpenDispatch,
  type SurfaceDispatch,
  type WireStatus,
  type WireTransport,
} from "../link";
import { LIVENESS_NAMESPACE, LIVENESS_VERB } from "../liveness";
import { onWake } from "./onWake";

export type { HeartbeatTuning };

/** The brand membership set for {@link LiveSignalHandle}s. Module-private and
 *  **un-reflectable**: a `WeakSet` exposes no enumeration, so a consumer holding a
 *  genuine handle cannot read the brand off it and stamp a hand-rolled look-alike.
 *  The only way into this set is {@link createLiveSignal}, which adds the handle it
 *  returns AFTER wiring the watchdog over the dispatch it guards. */
const LIVE_SIGNAL_HANDLES = new WeakSet<object>();

/** True if `value` is a {@link LiveSignalHandle} minted by {@link createLiveSignal}
 *  — i.e. it carries a watchdog-backed `live` paired (by construction) with the
 *  `dispatch` the watchdog probes. `surfaceClient`/`surfaceClients` consult this to
 *  take the WHOLE handle (reading `.dispatch` and `.live` off it) over a
 *  half-openable wire, instead of accepting a separately-supplied `{ live }` that
 *  would have to be re-proven to belong to the dispatch. Read-only: checking
 *  membership can never add to the WeakSet. */
export function isLiveSignalHandle(value: unknown): value is LiveSignalHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    LIVE_SIGNAL_HANDLES.has(value)
  );
}

/** A transport-liveness accessor `createLiveSignal` mints AFTER wiring the
 *  half-open watchdog and carries on the {@link LiveSignalHandle} it returns.
 *  Structurally an `Accessor<boolean>`; its honesty comes from the handle that
 *  bundles it with the dispatch the watchdog probes — pass the WHOLE handle to
 *  `surfaceClient`/`surfaceClients`, never this accessor alone. */
export type LiveSignal = Accessor<boolean>;

/** The transport-level status of a reconnecting surface wire: `connecting`
 *  until the first `open`, `live` while open, `reconnecting` after a transient
 *  drop (the link re-dials), `retired` after the SERVER retired the wire — a stale
 *  tab bound to a previous server instance (D5/#5), which never re-dials, so the
 *  page must reload to recover.
 *
 *  The terminal arm is named `retired`, not `down`. It used to be `down`, and that
 *  name cost a downstream app the whole seam: "down" reads as a socket that is
 *  currently away — the state `reconnecting` already covers — so an indicator built
 *  on it said "reconnecting…" about a page that would never reconnect, and the app
 *  reached past `status` for a lifecycle it did not otherwise need (olai#61). It
 *  also collided with `@kolu/surface-app`'s `ConnectionStatus.down`, which means the
 *  OPPOSITE (a transient drop). The wire has exactly one terminal state; it is now
 *  spelled the same way the wire spells it. */
export type SurfaceConnectionStatus =
  | "connecting"
  | "live"
  | "reconnecting"
  | "retired";

export interface CreateLiveSignalOptions extends HeartbeatTuning {
  /** For a MULTI-surface combined dispatch, the sibling key whose
   *  framework-reserved `system/live` member the watchdog probes — every surface
   *  answers it, so any sibling works; pass the first. Omit for a single-surface
   *  dispatch, where the reserved member sits at the bare `surface/system/live`.
   *
   *  Note this is a STRING, not a dispatch: `createLiveSignal` probes over the
   *  dispatch it was handed, sliced only by TAG. There is no caller-supplied probe
   *  target to fabricate — which is the whole point (see the module docstring). */
  siblingKey?: string;
}

/** The branded unit `createLiveSignal` returns: the watchdog-backed `live`, the
 *  {@link SurfaceDispatch} it guards, the richer `status`, and `dispose` — ONE
 *  inseparable object, and the unit the brand lives on
 *  ({@link LIVE_SIGNAL_HANDLES}). Pass the WHOLE handle to
 *  `surfaceClient`/`surfaceClients`.
 *
 *  It is NOT generic over a contract any more: the dispatch is the erased,
 *  transport-neutral seam (per-member precision lives in the face's spec-derived
 *  types — D2/#16), so there is no contract type to thread and no `TS2590`-prone
 *  client union to materialise for the multi-surface case. */
export interface LiveSignalHandle {
  /** The watchdog-backed transport-liveness accessor — `true` only while the wire
   *  is `live`; a `down`/`reconnecting` transport (including after the watchdog
   *  forces a reconnect on a half-open wire) flips it `false`. `surfaceClient`/
   *  `surfaceClients` read it off the handle themselves; do not pull it out and
   *  pass it alone. */
  live: LiveSignal;
  /** The richer transport status the brand is derived from — and an INPUT to a
   *  connection indicator, never the indicator itself. It is a fact about a
   *  SOCKET, and a socket can be open and answering while a subscription riding
   *  it is dead; painting this accessor alone is the green-light-over-a-dead-
   *  collection lie one module over from the one this file closes. Fold it with
   *  the client's health fact — `createSurfaceReadout(handle.status,
   *  client.health)` (`./readout`) — and render THAT, so the watchdog's recovery
   *  is visible and green means what reaches the page. (The `connectSurface` /
   *  `connectSurfaces` seams do this fold for you and hand back the readout;
   *  this is the hand-built path's version of the same step.) */
  status: Accessor<SurfaceConnectionStatus>;
  /** The dispatch this handle guards. `surfaceClient`/`surfaceClients` build the
   *  face over THIS dispatch (read off the handle) so the face and the watchdog's
   *  probe share ONE dispatch over ONE wire — and so there is no separate,
   *  fabricatable probe target. */
  dispatch: SurfaceDispatch;
  /** Stop the watchdog (and any in-flight probe timeout). Wire to the consumer's
   *  teardown; a page-lifetime wire needn't call it. */
  dispose: () => void;
}

const warnStale = () =>
  console.warn(
    "surface: heartbeat probe timed out — forcing reconnect (half-open wire)",
  );

// `error` level, not `warn`: a synchronous throw from the probe is an unexpected
// exception that leaves the watchdog permanently INERT (a half-open wire then goes
// undetected — the exact failure this whole primitive exists to prevent), not a
// degraded-but-recoverable blip like a timed-out probe (`warnStale`, which recovers
// by reconnecting).
const warnProbeThrew = (error: unknown) =>
  console.error(
    "surface: heartbeat probe threw synchronously — no round-trip was made; " +
      "the probe is likely miswired (heartbeat is inert until fixed)",
    error,
  );

/** Project a raw {@link WireStatus} onto the richer, consumer-facing
 *  {@link SurfaceConnectionStatus}. The one asymmetry: `closed`/`connecting`
 *  BEFORE the wire has ever opened is a cold start (`connecting`), while the same
 *  raw status AFTER a successful open is a drop the link is healing
 *  (`reconnecting`) — the distinction a first-paint gate needs and the raw wire
 *  status cannot carry. `retired` is terminal and passes through under its own
 *  name, so a reader can tell "will never reconnect" from "reconnecting". */
function projectStatus(
  wire: WireStatus,
  everOpened: boolean,
): SurfaceConnectionStatus {
  if (wire === "open") return "live";
  if (wire === "retired") return "retired";
  return everOpened ? "reconnecting" : "connecting";
}

export function createLiveSignal(
  transport: WireTransport,
  opts: CreateLiveSignalOptions,
): LiveSignalHandle {
  const { dispatch, wire } = transport;
  // FAIL FAST on a transport that no wire link factory minted. The brand is applied
  // at the ONE seam every wire link crosses, so an unbranded dispatch here means
  // either an in-process dispatch (which needs no watchdog — pass it to
  // `surfaceClient` bare) or a hand-assembled `{ dispatch, wire }` pairing the two
  // halves of DIFFERENT transports, which is precisely the "watch ws1, dispatch
  // over ws2" forge this primitive exists to make unspellable.
  if (!isHalfOpenDispatch(dispatch)) {
    throw new Error(
      "createLiveSignal: this dispatch was not minted by a wire link factory " +
        "(it carries no half-open brand), so pairing it with a `WatchableWire` " +
        "would let the watchdog probe a DIFFERENT transport than the one it " +
        "reconnects — the exact forgery the handle exists to prevent. Pass the " +
        "whole `{ dispatch, wire }` a wire link factory returned. An in-process " +
        "`directDispatch` needs no watchdog at all: hand it to `surfaceClient` " +
        "directly (it cannot half-open, so its constant-`true` leg is honest).",
    );
  }
  // Derive the reactive transport `status` from the wire's own status events. This
  // alone is half-open-BLIND (a silently dead wire reports nothing), which is
  // exactly why the watchdog below is mandatory — and why a bare
  // `() => status() === "live"` must never stand in for a `LiveSignalHandle`.
  let everOpened = wire.status() === "open";
  const [status, setStatus] = createSignal<SurfaceConnectionStatus>(
    projectStatus(wire.status(), everOpened),
  );
  // `detachStatus` is named so `dispose()` can run it — otherwise this subscription
  // outlives the handle and leaks across a remount (drishti's per-host wires, a
  // test re-creating one).
  const detachStatus = wire.onStatus((next) => {
    if (next === "open") everOpened = true;
    setStatus(projectStatus(next, everOpened));
  });
  // The reserved liveness member's TAG, minted through the SAME tag algebra
  // `defineSurface` mints it with — so the probe can never address a member the
  // surface does not carry, and a sibling-scoped probe is a tag prefix rather than
  // a walk through a nested client.
  const liveTag = surfaceTag(
    opts.siblingKey === undefined
      ? SURFACE_TAG_PREFIX
      : siblingTagPrefix(opts.siblingKey),
    LIVENESS_NAMESPACE,
    LIVENESS_VERB,
  );
  // The half-open watchdog — ALWAYS wired (there is no disable knob). It probes the
  // reserved liveness member over the owned dispatch while the wire is OPEN and, on
  // a TIMEOUT, forces `status` to `reconnecting` (so `live` flips false even if the
  // wire's own re-dial somehow never reports a close) AND calls
  // `wire.forceReconnect()` to recover. The race/settle/skip-overlap/dispose
  // algorithm is the framework-free `@kolu/surface/heartbeat` primitive.
  //
  // ONE source of truth for "is the wire live": the heartbeat's probe gate AND the
  // handle's `live` are the SAME closure, not two that merely happen to match. It
  // reads `status` (NOT a second, independent `wire.status()`): the two readings
  // could disagree — a wire whose open event fired while its own status getter
  // lagged would freeze the gate shut forever, so the probe never runs and `live`
  // stays `true` over a dead wire. One closure makes "the gate and the signal can
  // never diverge" true by construction.
  const isLive = () => status() === "live";
  // The fiber of the CURRENT probe, so an ABANDONED probe can be interrupted rather
  // than left running. The heartbeat is a Promise-shaped primitive: when it times a
  // probe out (or abandons one on a suspension-void / `wake()`) it stops WAITING,
  // and has no way to cancel. Over a half-open wire that is exactly the case that
  // recurs every interval, so without this each stale verdict would strand a fiber
  // and an unanswered request entry for the life of the page. A probe is only ever
  // abandoned by the NEXT probe starting (the heartbeat skips overlapping ticks) or
  // by `dispose()`, so those are the two places that interrupt.
  let probeFiber: Fiber.Fiber<unknown, unknown> | undefined;
  const abandonProbe = () => {
    probeFiber?.interruptUnsafe();
    probeFiber = undefined;
  };
  const heartbeat = createHeartbeat({
    isLive,
    onStale: () => {
      setStatus("reconnecting");
      wire.forceReconnect();
    },
    // The heartbeat is framework-free and Promise-shaped (it races a probe against a
    // timer and is shared with non-Effect consumers), so bridging the dispatch to a
    // Promise here is a sanctioned run edge. A REJECTION still counts as alive: the
    // round-trip completed, which is all liveness asks — only silence is stale. (An
    // interruption from `abandonProbe` also rejects, and the heartbeat's own
    // generation guard drops that settle as stale, so it can never answer for the
    // probe that replaced it.)
    probe: () => {
      abandonProbe();
      const fiber = Effect.runFork(dispatch.unary(liveTag, {}));
      probeFiber = fiber;
      return new Promise<unknown>((resolve, reject) => {
        fiber.addObserver((exit) => {
          if (probeFiber === fiber) probeFiber = undefined;
          if (Exit.isSuccess(exit)) resolve(exit.value);
          else reject(Cause.squash(exit.cause));
        });
      });
    },
    intervalMs: opts.intervalMs,
    timeoutMs: opts.timeoutMs,
    onStaleReport: opts.onStale ?? warnStale,
    onProbeError: warnProbeThrew,
    // Pass-through observability (kolu#2101 J2): the app records the last probe
    // verdict for its diagnostic snapshot. Undefined when the app wants none.
    onProbeSettled: opts.onProbeSettled,
  });
  // Latency optimization (browser only): a wake event — window focus on app-switch
  // return, or a tab becoming visible — means the runtime may have just resumed, so
  // probe NOW rather than wait up to a full interval for the next tick to catch a
  // wire the suspension actually killed. `wake()` only ever PROBES (never voids,
  // never declares stale), and `onWake` is a no-op off-DOM (the node unit suite),
  // so this is pure recovery-latency, not a correctness leg — the measured clock-gap
  // void inside the heartbeat is what keeps a *healthy* resumed wire from a
  // spurious reconnect, with or without a wake event firing.
  const detachWake = onWake(heartbeat.wake);
  // Assemble the handle ONLY now — after the watchdog above is wired over the owned
  // dispatch. Because this is the one place that validates the pairing, wires the
  // watchdog, AND mints the handle, a handle existing IS proof a watchdog probes the
  // wire it guards. Brand the handle object itself (not the `live` accessor): the
  // dispatch and the live travel together on it, so the pairing holds by
  // construction and `surfaceClient`/`surfaceClients` need re-prove nothing — they
  // read both legs off this one object.
  const handle: LiveSignalHandle = {
    live: isLive,
    status,
    dispatch,
    dispose: () => {
      heartbeat.dispose();
      // The heartbeat stops waiting on an in-flight probe; only this interrupts the
      // fiber (and the request) behind it, so a disposed handle leaves nothing
      // running over a socket the consumer is done with.
      abandonProbe();
      detachWake();
      detachStatus();
    },
  };
  LIVE_SIGNAL_HANDLES.add(handle);
  return handle;
}
