/**
 * `client.health()` — the framework's subscription-health FACT, the client-side
 * twin to the reserved `system.live` probe.
 *
 * `system.live` (`../liveness`) answers ONE question on every surface: *is the
 * link alive?* — a discarded round-trip a transport watchdog calls. It has no
 * twin for the other half of "is this surface usable right now?": *is any
 * subscription erroring, or still waiting for its first frame?* Without that
 * twin, every mirror consumer hand-folds it — and that hand-fold is exactly
 * where pulam-web's stale-"Internal server error" latch lived (#1564 follow-up):
 * a one-shot `onError` funneled into `setError(prev ?? msg)` that never cleared.
 * drishti, gating on the cell's live value instead, dodged it — two consumers,
 * two divergent folds, one coin-flip each.
 *
 * This module is that twin. A per-client REGISTRY every subscription enrols into
 * vends a single reactive FACT:
 *
 *   health(): { live: boolean; subs: { name, pending, error }[] }
 *
 * Two properties are load-bearing:
 *
 *   1. It is a FACT, not a verdict. No `{connecting|degraded|ready}` triage, no
 *      human copy. Policy — why liveness outranks a sub error, whether one
 *      erroring stream is "degraded" or "dead" — is the consumer's (`SurfaceGate`
 *      owns the default), because two consumers legitimately disagree:
 *      stale-while-degraded (drishti) vs hard-gate (pulam-web). Braiding the two
 *      is what forced every consumer to re-derive both.
 *
 *   2. It folds each sub's OWN self-clearing `error()` / `pending()` LEVEL
 *      accessors (`createSubscription` clears `error()` on the next good frame),
 *      NEVER the one-shot `onError` EDGE. So a transient blip is un-latchable
 *      *by construction* for every enrolled sub — the bug can't recur per-consumer
 *      because no consumer hand-folds the edge anymore.
 *
 * The registry must be TOTAL: a `health()` that reads `ready` while a real
 * subscription is dead — sitting behind a confident `<SurfaceGate>` — is worse
 * than an honest hand-rolled gate. Every subscription birth site enrols (cells,
 * the collection keys-stream, per-key collection subs, streams), and raw
 * `unenrolledStreamCall` consumers — which own their own loop and error state — enrol
 * through {@link SurfaceHealthRegistry.enroll} explicitly (the honest residue of
 * a blessed escape hatch that owns no `Subscription`).
 */

import { type Accessor, createSignal, onCleanup } from "solid-js";

/** One enrolled subscription's health, read straight off its own reactive,
 *  self-clearing accessors. */
export interface SubHealth {
  /** The subscription's identity — its primitive key, disambiguated for the
   *  fan-out shapes: a cell/stream is its bare key (`"connection"`), the
   *  collection keys-stream is `"<key>.keys"`, a per-key value sub is
   *  `"<key>[<id>]"`, and a raw `unenrolledStreamCall` enrols under a caller-chosen name. */
  readonly name: string;
  /** True while the sub is waiting for its first frame (never yielded yet). */
  readonly pending: boolean;
  /** The sub's current error, or `undefined` when healthy. Self-clearing: it
   *  disappears the instant the stream re-delivers, so a transient blip can't
   *  latch here the way a one-shot `onError` would. */
  readonly error: Error | undefined;
}

/** The subscription-health FACT — flat, no policy, no copy. */
export interface SurfaceHealth {
  /** Transport liveness — the socket/heartbeat watchdog's answer, or `true` for
   *  a link with no observable transport (a direct/stdio link can't be
   *  half-open). This is NOT a per-subscription fact; it is the `system.live`
   *  twin's other half, threaded in from the transport layer that owns it. */
  readonly live: boolean;
  /** Every currently-enrolled subscription's pending/error, self-clearing. */
  readonly subs: readonly SubHealth[];
}

/** The minimal reactive shape the registry folds — anything exposing a
 *  self-clearing `pending()` / `error()`. A `Subscription<unknown>` satisfies it
 *  structurally; a raw `unenrolledStreamCall` consumer enrols its own two signals. */
export interface HealthSource {
  readonly pending: Accessor<boolean>;
  readonly error: Accessor<Error | undefined>;
}

export interface SurfaceHealthRegistry {
  /** Enrol a subscription under `name`; returns a disposer that drops it. Also
   *  auto-drops via `onCleanup` when called inside a reactive owner (every
   *  framework birth site is), so a consumer that unmounts stops contributing —
   *  the registry tracks what is *live on screen*, never a leaked stale sub.
   *  The explicit return is for the rare imperative call site (a raw
   *  `unenrolledStreamCall` whose lifetime is an `AbortController`, not an owner). */
  enroll(name: string, source: HealthSource): () => void;
  /** The reactive FACT. A plain accessor (not a `createMemo`) so the registry
   *  allocates no computation at client-build time — `surfaceClient` runs once,
   *  often outside any root, and an undisposed memo there would warn/leak. Read
   *  it inside a tracking scope (a component memo, JSX, `<SurfaceGate>`) and it
   *  tracks both membership and every enrolled sub's `error()`/`pending()`. */
  health: Accessor<SurfaceHealth>;
}

/** Build a per-client subscription-health registry over a transport-`live`
 *  accessor. One per `surfaceClient`; every `.use()` enrols into it. */
export function createSurfaceHealthRegistry(
  live: Accessor<boolean>,
): SurfaceHealthRegistry {
  // Id-keyed, NOT name-keyed: two `byKey` subs of one collection, or a
  // component that remounts before its predecessor's cleanup runs, share a name
  // but must each hold their own slot — a name-keyed map would clobber one.
  const entries = new Map<number, { name: string; source: HealthSource }>();
  // Bumped on every add/remove so `health` re-folds on membership change.
  // `equals: false` makes each bump a distinct notification even though the
  // value is constant.
  const [membership, bumpMembership] = createSignal(0, { equals: false });
  let nextId = 0;

  function enroll(name: string, source: HealthSource): () => void {
    const id = nextId++;
    entries.set(id, { name, source });
    bumpMembership(0);
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      entries.delete(id);
      bumpMembership(0);
    };
    // Rides the consumer's reactive owner — a no-op (with a dev warning) outside
    // one, which is why imperative callers also get the returned disposer.
    onCleanup(dispose);
    return dispose;
  }

  const health: Accessor<SurfaceHealth> = () => {
    membership(); // track add/remove
    const subs: SubHealth[] = [];
    for (const { name, source } of entries.values()) {
      // Each read tracks that sub's self-clearing error()/pending(), so the
      // fact re-folds the instant any enrolled sub errors OR recovers.
      subs.push({ name, pending: source.pending(), error: source.error() });
    }
    return { live: live(), subs };
  };

  return { enroll, health };
}

/** Merge several clients' facts into one (the `surfaceClients` / multi-surface
 *  shape — Leak D). `live` AND-reduces (every link must be alive); `subs`
 *  concatenate with each sub's name prefixed by its surface key so a composed
 *  app reads one fact instead of N hand-folded ones. An empty set is vacuously
 *  live with no subs. */
export function mergeSurfaceHealth(
  entries: Iterable<readonly [string, Accessor<SurfaceHealth>]>,
): SurfaceHealth {
  let live = true;
  const subs: SubHealth[] = [];
  for (const [key, health] of entries) {
    const h = health();
    live = live && h.live;
    for (const sub of h.subs) subs.push({ ...sub, name: `${key}/${sub.name}` });
  }
  return { live, subs };
}
