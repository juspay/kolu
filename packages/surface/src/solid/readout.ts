/**
 * The READOUT — what a connection indicator is allowed to say, folded from BOTH
 * facts the page's liveness actually depends on.
 *
 * The transport reports four states (`./liveSignal`'s
 * {@link SurfaceConnectionStatus}), and every one of them is true about a
 * SOCKET. There is a fifth the transport cannot see, because it is not about the
 * transport: a socket that is open and answering while a subscription riding it
 * is DEAD. `client.health()` (`./health`) has always known — and being a second,
 * DISCARDABLE call, it was discarded. A consumer that rendered `status` alone
 * shipped the lie the whole health fact exists to prevent: a stopped
 * `documents.keys` stream renders as a directory with no documents in it, under
 * a green light (juspay/olai's connection pill, the reference consumer, shipped
 * exactly that).
 *
 * So `connectSurface`/`connectSurfaces` no longer hand back a transport-only
 * `status` for an app to render beside a `health()` an app may forget. They hand
 * back this READOUT, and green here is a claim about what REACHES THE PAGE:
 *
 *   connecting · live · degraded · reconnecting · retired
 *
 * Three rules, and they are the framework's rather than any app's:
 *
 *   1. **`live` is the CONJUNCTION.** The socket is live AND the fact agrees AND
 *      nothing enrolled is erroring. Anything less is not green.
 *   2. **Pending does not degrade.** A subscription still waiting for its first
 *      frame is what every page load looks like (and a per-key subscription is
 *      pending every time somebody opens a row). A readout that ambered on those
 *      would be amber most of the time, and an indicator nobody reads is the
 *      failure this module is about, wearing the opposite hat. This is a
 *      universal default, not app policy — which is why it is not overridable
 *      here. (`gateStatus` in `./health` is the OTHER policy and stays separate:
 *      a GATE decides whether to draw the body at all, so for the gate pending
 *      legitimately blocks.)
 *   3. **`degraded` NAMES what stopped.** Its evidence is a non-empty list of
 *      subscription names, so "something is not arriving" — the least useful
 *      true thing available — is not spellable. A reader who is told a name can
 *      tell what is missing from the screen; a reader told nothing cannot.
 *
 * WHAT THIS DOES NOT OWN: the LOOK. What "degraded" is CALLED on screen, what
 * green claims in words ("the files on disk reach this page" is one app's
 * sentence and must stay one app's sentence), which colour each state paints,
 * whether the names go in a tooltip or a strip — all of that is the consumer's.
 * The framework owns the five states' TRUTH; the app owns their appearance. A
 * `Record<SurfaceReadoutStatus, …>` on the app side is how that stays honest:
 * a new state becomes a type error in the app's own table, not a silent default.
 */

import { type Accessor, createMemo, createRoot } from "solid-js";
import { gracedDown } from "./gracedDown";
import type { SurfaceHealth } from "./health";
import type { SurfaceConnectionStatus } from "./liveSignal";

/** How long the wire may sit not-`live` before a consumer's full-screen
 *  "Disconnected" overlay should appear. A forced reconnect — the half-open
 *  watchdog recovering, the link riding out a Wi-Fi roam — closes and reopens
 *  the socket in well under a second, and flashing a full-screen alarm for that
 *  blink is noise; a genuine sustained outage still surfaces promptly.
 *
 *  It is the framework's number, not an app's, and it is BAKED rather than a
 *  knob: a tunable would just be a way to make the flash reappear. It is the
 *  window {@link createSurfaceReadout} folds `presentingDown` over, so every
 *  consumer of a connect seam gates its overlay on the SAME grace instead of
 *  re-deriving one (or forgetting to). `status` itself stays INSTANTANEOUS — the
 *  header dot, the probe gate and the client all read it without a delay.
 *
 *  `@kolu/surface-app` re-exports this as `DISCONNECT_OVERLAY_GRACE_MS` (its
 *  historical home), so an app that imported it from the provider keeps one
 *  import path. */
export const DISCONNECT_OVERLAY_GRACE_MS = 1_000;

/** The five states an indicator may report — the transport's four, plus the one
 *  it cannot see. `degraded` is spelled the same way `gateStatus` spells it
 *  (`./health`): one word for "live, but something riding the socket has
 *  stopped", across the gate and the readout. */
export type SurfaceReadoutStatus = SurfaceConnectionStatus | "degraded";

/** The readout while the wire itself is the news — the transport's own four
 *  states, passed through under their own names. `stopped` is absent (not
 *  empty): a subscription erroring while the socket is down is a CONSEQUENCE of
 *  the socket being down, not separate news, so naming those subs here would
 *  attribute the outage to whichever of them noticed first. */
export interface TransportReadout {
  readonly status: Exclude<SurfaceReadoutStatus, "degraded">;
  readonly stopped?: undefined;
  /** The grace-windowed "should a consumer present its down-state *now*"? fact:
   *  `true` once the readout has been not-`live` continuously for
   *  {@link DISCONNECT_OVERLAY_GRACE_MS}, and back to `false` the instant it
   *  recovers. This is the bit an OVERLAY gates on — a sub-second watchdog
   *  forced-reconnect never presents, a sustained outage does. It is distinct
   *  from `status`, which stays instantaneous for the dot, the probe gate and
   *  the client. `retired` is a DEFINITIVE down — the wire never re-dials, so
   *  there is nothing a grace window could hold back — and therefore presents
   *  IMMEDIATELY, matching the frozen disposed-connection readout. See
   *  {@link createSurfaceReadout}, which derives it once for every consumer. */
  readonly presentingDown: boolean;
  /** True for `retired`, and ONLY for `retired`: the server closed this tab at
   *  the handshake because the process that served it has been replaced, so the
   *  link will never dial again and there is nothing to wait for. The rule lives
   *  HERE — a consumer wiring a reload button reads this bit rather than
   *  re-deriving which states are terminal (the derivation that once read `down`
   *  as transient and drew "reconnecting…" over a page that never would). */
  readonly needsReload: boolean;
}

/** The readout the transport cannot produce: a live socket over at least one
 *  stopped subscription. `stopped` is non-empty BY TYPE, so an indicator can
 *  always name what is missing. */
export interface DegradedReadout {
  readonly status: "degraded";
  /** Always `false`: a degraded surface has a LIVE socket — the news is a
   *  subscription riding it, not the transport — so it never presents a
   *  transport down-state. The socket's own `status` is `live`. */
  readonly presentingDown: false;
  /** The enrolled subscriptions that have STOPPED (their self-clearing `error()`
   *  is set), in enrolment order — `health().subs`'s own names, which is why
   *  they read as `preferences`, `terminals.keys` or `documents[abc]` rather
   *  than as a framework's paraphrase of them. Self-clearing like the fact
   *  beneath: a sub that re-delivers leaves this list on its next frame. */
  readonly stopped: readonly [string, ...string[]];
  /** Always `false`. A degraded surface heals on its own — the fence
   *  re-subscribes — so offering a reload here would be offering the heaviest
   *  recovery for the lightest failure. */
  readonly needsReload: false;
}

/** What an indicator renders: the wire's own state, unless the wire is fine and
 *  something riding it is not. */
export type SurfaceReadout = TransportReadout | DegradedReadout;

/**
 * The fold, as a pure function of the two facts (exported so a consumer can
 * unit-test its own LOOK table against every state without standing up a wire).
 *
 * The precedence is the point: the transport's non-`live` states are reported
 * FIRST and unchanged. Only over a socket that is up does the fact get to
 * change the answer — and then it changes it in exactly two ways, in order:
 *
 *   - some enrolled subscription is erroring → `degraded`, naming them; then
 *   - the fact itself is not `live` while the socket is → the surface carries a
 *     readiness leg (a `liveWhen` cell — a MIRRORED surface whose upstream is
 *     down) that no subscription name covers, because a readiness cell that has
 *     delivered a "disconnected" value is neither pending nor erroring. Nothing
 *     is arriving and the mirror re-establishes on its own, which is precisely
 *     what `reconnecting` already means one hop down, so that is what it reads.
 *     The alternative — `live`, because the socket to THIS server is fine — is
 *     the green-over-a-dead-link lie with a longer wire.
 */
export function surfaceReadout(
  status: SurfaceConnectionStatus,
  health: SurfaceHealth,
  presentingDown: boolean,
): SurfaceReadout {
  if (status !== "live")
    return { status, needsReload: status === "retired", presentingDown };
  const stopped = health.subs
    .filter((sub) => sub.error !== undefined)
    .map((sub) => sub.name);
  // The cast is the whole narrowing: the guard IS the non-emptiness proof, and
  // there is no other constructor of a `degraded` readout.
  if (stopped.length > 0)
    return {
      status: "degraded",
      stopped: stopped as [string, ...string[]],
      needsReload: false,
      presentingDown: false,
    };
  if (!health.live)
    return { status: "reconnecting", needsReload: false, presentingDown };
  return { status: "live", needsReload: false, presentingDown: false };
}

/** Two readouts that say the same thing. The name list is compared by VALUE:
 *  the healthy case folds to the same (empty) evidence on every recompute, so
 *  this is what keeps a healthy page from handing every bound indicator a fresh
 *  object to re-render on. `presentingDown` is compared so the graced edge —
 *  which flips while `status` is otherwise unchanged — still notifies. */
function sameReadout(was: SurfaceReadout, now: SurfaceReadout): boolean {
  if (
    was.status !== now.status ||
    was.needsReload !== now.needsReload ||
    was.presentingDown !== now.presentingDown
  )
    return false;
  const a = was.stopped ?? [];
  const b = now.stopped ?? [];
  return a.length === b.length && a.every((name, at) => name === b[at]);
}

/** A readout accessor with the owner that keeps it alive — the shape the connect
 *  seams fold into their own teardown. */
export interface SurfaceReadoutHandle {
  /** The reactive readout. Read it anywhere, as often as you like: it is a memo,
   *  so the fold runs when a fact CHANGES, not when a consumer reads. */
  readout: Accessor<SurfaceReadout>;
  /** Drop the memo (and its subscriptions to the fact). The connect seams call
   *  it from their own `dispose`. */
  dispose: () => void;
}

/**
 * Fold a transport `status` and a health fact into ONE reactive readout —
 * MEMOIZED, which is the whole ergonomic difference between this and the
 * two-call walk every consumer wrote by hand.
 *
 * `health()` is deliberately a plain accessor (`./health`): it re-folds the
 * WHOLE registry — walking every enrolled sub and allocating a record per sub —
 * on each read, and enrolment is per KEY, so a page with a row per document
 * enrols one sub per open row. Read straight from JSX, each expression compiles
 * to its own computation and that walk runs once per expression per update; the
 * reference consumer measured it as a per-row tax on a streaming turn and
 * answered with a hand-rolled memo carrying a hand-rolled `equals` on the name
 * list. That memo is HERE now, folded once per connection: N reads cost one
 * fold, and a fold whose names are unchanged notifies nobody.
 *
 * It is not folded per-SUBSCRIPTION (a computation per enrolled sub, updating a
 * shared set) deliberately: that trades an O(subs) pass that runs only when the
 * fact changes for O(subs) standing computations that must each be created,
 * tracked and disposed — more machinery, more lifecycle, and no cheaper on the
 * path that actually runs.
 *
 * It takes a `createRoot` of its own because the seams that call it run OUTSIDE
 * any reactive owner (an app's `await connectSurface(...)` at module top level),
 * where an unowned memo would leak.
 *
 * It also derives `presentingDown` ONCE for every consumer: the raw fold is
 * wrapped through {@link gracedDown} over "the readout is not `live`", so a
 * sub-second drop/reconnect never presents and a sustained one does — the same
 * policy every app had to remember to wire, now un-forgettable. That is why the
 * graced predicate reads the FOLDED status (so a mirror whose upstream is down
 * presents too), while the underlying `status` the dot/probe/client read stays
 * instantaneous. `retired` bypasses the window (it is terminal — present it at
 * once, as the frozen disposed readout does); every other not-live state waits
 * it out.
 */
export function createSurfaceReadout(
  status: Accessor<SurfaceConnectionStatus>,
  health: Accessor<SurfaceHealth>,
): SurfaceReadoutHandle {
  return createRoot((dispose) => {
    // The raw fold WITHOUT the graced bit — the input to both the grace window
    // and the final readout. Folded through the same `equals` gate as the final
    // one, so a healthy page's churn notifies neither.
    const raw = createMemo(
      () => surfaceReadout(status(), health(), false),
      undefined,
      {
        equals: sameReadout,
      },
    );
    // The grace-windowed "should a consumer present its down-state now?" fact.
    // Reads the FOLDED status so a mirror (live socket, upstream down → folds to
    // `reconnecting`) is graced like any other not-live readout.
    const down = gracedDown(
      () => raw().status !== "live",
      DISCONNECT_OVERLAY_GRACE_MS,
    );
    return {
      readout: createMemo(
        (): SurfaceReadout => {
          const base = raw();
          if (base.status === "live" || base.status === "degraded") return base;
          // `retired` is TERMINAL — the wire never re-dials, so there is nothing a
          // grace window could hold back; present it IMMEDIATELY, exactly as the
          // frozen disposed-connection readout (`connectSurfaces`' `retiredReadout`)
          // does. Every OTHER not-live state is graced, so a sub-second forced
          // reconnect never flashes an overlay.
          const presentingDown = base.status === "retired" ? true : down();
          return { ...base, presentingDown };
        },
        undefined,
        { equals: sameReadout },
      ),
      dispose,
    };
  });
}
