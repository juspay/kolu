/**
 * `client.health()` — the framework's subscription-health FACT, the client-side
 * twin to the reserved `system.live` probe.
 *
 * `system.live` (`../liveness`) answers ONE question on every surface: *is the
 * link alive?* — a discarded round-trip a transport watchdog calls. It has no
 * twin for the other half of "is this surface usable right now?": *is any
 * subscription erroring, or still waiting for its first frame?* Without that
 * twin, every mirror consumer hand-folds it — and that hand-fold is exactly
 * where the retired pulam-web's stale-"Internal server error" latch lived (#1564 follow-up):
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
 *      stale-while-degraded (drishti) vs hard-gate (the retired pulam-web). Braiding the two
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

import {
  type Accessor,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  mapArray,
  onCleanup,
  runWithOwner,
} from "solid-js";

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
  /** Fully live end-to-end — the ONE folded "is it connected?" boolean, read
   *  WHOLE so there is no transport-only half a widget can bind and paint green
   *  over a dead downstream link (the round-5 collapse). It is the conjunction of
   *  every liveness leg the client carries:
   *
   *    - the transport leg — the socket/heartbeat watchdog's answer (or `true`
   *      for a direct/stdio link that can't be half-open), threaded in via
   *      `surfaceClient`'s `{ live }`; AND
   *    - every readiness leg — each `liveWhen` cell's predicate over its own
   *      current value (a mirrored surface's `connection` cell reads `connected`),
   *      folded in by construction the instant the surface composes such a cell
   *      (see {@link SurfaceHealthRegistry.enrollReadiness}). No consumer re-ANDs
   *      the mirror state by hand — the fact already carries it.
   *
   *  `true` only when transport-live AND every readiness predicate holds. A
   *  base/connection-free surface (no `liveWhen` cell) carries only the transport
   *  leg, so `live` is exactly its socket liveness as before. */
  readonly live: boolean;
  /** Every currently-enrolled subscription's pending/error, self-clearing —
   *  including each readiness cell, enrolled EAGERLY at client-build time (not at
   *  `.use()` time), so a not-yet-arrived or erroring readiness cell reads
   *  `pending`/`degraded` in the fact even with zero presentation `.use()`. */
  readonly subs: readonly SubHealth[];
}

/** The readiness verdict derived from a health fact — the SINGLE triage both
 *  `<SurfaceGate>` (the body gate) and `<HostStatusPip>` (the dot color) read, so
 *  the gate's "ready" and the dot's "green" are provably the same decision. Lives
 *  HERE in the JSX-free fact module (re-exported from `./SurfaceGate` for
 *  back-compat) so the pip imports the verdict without pulling in the gate
 *  component. */
export type GateStatus = "connecting" | "degraded" | "ready";

/** Derive the default verdict from the health FACT:
 *   - `connecting` — not fully `live` (transport down/half-open OR a readiness
 *     cell not yet `connected`), OR live-and-error-free but some subscription is
 *     still waiting for its first frame (a fresh or reconnecting surface);
 *   - `degraded`  — live, but some subscription is erroring — even if ANOTHER sub
 *     is still pending (an error OUTRANKS a concurrent pending, below);
 *   - `ready`     — live, every sub past first-frame, none erroring.
 *  This is POLICY: an app overrides it via `<SurfaceGate ready={…}>`. Exported so
 *  a consumer can reuse the same triage when rendering its own fallback.
 *
 *  Precedence note (load-bearing): a present `error` is reported BEFORE a concurrent
 *  `pending`. Checking pending first would MASK an error behind a still-loading
 *  sibling — a live host with one sub erroring AND one sub pending would read
 *  `connecting`, hiding the error. That masking was the round-5-found relocation of
 *  the #1564 lie: a consumer coloring the `connecting` verdict from a transport∘
 *  mirror-only signal painted a green dot while a sub was silently dead. So an error
 *  always surfaces as `degraded` while live, never collapses into `connecting`. */
export function gateStatus(health: SurfaceHealth): GateStatus {
  if (!health.live) return "connecting";
  if (health.subs.some((s) => s.error)) return "degraded";
  if (health.subs.some((s) => s.pending)) return "connecting";
  return "ready";
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
  /** AND-fold an extra reactive liveness LEG into `health().live` while enrolled —
   *  the readiness counterpart to {@link enroll}. `surfaceClient` calls this for
   *  every cell declaring a `liveWhen` predicate, threading
   *  `() => liveWhen(cell.value())`, so a mirrored surface's `connection` cell
   *  reading anything but `connected` flips `live` false WITHOUT any consumer
   *  hand-ANDing it. `name` is for debugging/symmetry only (the legs are folded as
   *  a flat AND, not surfaced per-name). Returns a disposer; also auto-drops via
   *  `onCleanup` inside a reactive owner (the eager standing subscription's
   *  `createRoot`), so the leg leaves the fact when its cell's client is disposed. */
  enrollReadiness(name: string, live: Accessor<boolean>): () => void;
  /** The reactive FACT. A plain accessor (not a `createMemo`) so the registry
   *  allocates no computation at client-build time — `surfaceClient` runs once,
   *  often outside any root, and an undisposed memo there would warn/leak. Read
   *  it inside a tracking scope (a component memo, JSX, `<SurfaceGate>`) and it
   *  tracks membership, every enrolled sub's `error()`/`pending()`, AND every
   *  readiness leg's predicate.
   *
   *  It costs the reading scope TWO sources however many subscriptions are
   *  enrolled: the walk itself lives in this registry's own chunked fold (see
   *  {@link createSurfaceHealthRegistry}), and the accessor reads only that
   *  fold's two memos. A caller is therefore bounded by construction — it
   *  cannot be made wide by a page that opens a row per document.
   *
   *  Because the fold is memoized, the fact it reports is the one as of the last
   *  FLUSH — the same clock every other derived value in a Solid 2 graph is on,
   *  since a signal write is held until the flush anyway. A reading COMPUTATION
   *  is re-run by the same flush that lands an enrolment or a frame, so it never
   *  sees the older roster. An IMPERATIVE reader (a test, an event handler
   *  enrolling and asking in one breath) must ask after the flush. */
  health: Accessor<SurfaceHealth>;
}

/** Rows per chunk in the subs fold below. A chunk memo reads the slot list plus
 *  its own rows' `pending()` and `error()` — `1 + 2·CHUNK` sources — so 64 rows
 *  keeps a chunk at 129, comfortably under Solid's 200-source `WIDE_SCOPE_DEPS`
 *  judge, while the join over `⌈N / 64⌉` chunks stays under it below 12,700
 *  enrolled subscriptions. */
const CHUNK = 64;

/** Two foldings of the roster that say the same thing. The slot objects are
 *  stable per enrolment, so this is identity on each one. */
const sameSlots = <T>(was: readonly T[], now: readonly T[]): boolean =>
  was.length === now.length && was.every((slot, at) => slot === now[at]);

/** Two readings of the same subscriptions. Compared by VALUE — each reading
 *  allocates a fresh record per sub, so without this every re-fold would hand
 *  every bound indicator a new array to re-render on. */
const sameSubs = (
  was: readonly SubHealth[],
  now: readonly SubHealth[],
): boolean =>
  was.length === now.length &&
  was.every((sub, at) => {
    const other = now[at];
    return (
      other !== undefined &&
      sub.name === other.name &&
      sub.pending === other.pending &&
      sub.error === other.error
    );
  });

/** Build a per-client subscription-health registry over a transport-`live`
 *  accessor. One per `surfaceClient`; every `.use()` enrols into it.
 *
 *  The extra `disposeFold` over {@link SurfaceHealthRegistry} is the lifetime of
 *  the fold described below — internal, because the registry's PUBLIC contract
 *  is the fact, and only the client that built this registry may end it
 *  (`surfaceClient` hands it to its own `dispose`). */
export function createSurfaceHealthRegistry(
  transportLive: Accessor<boolean>,
): SurfaceHealthRegistry & { disposeFold: () => void } {
  // Id-keyed, NOT name-keyed: two `byKey` subs of one collection, or a
  // component that remounts before its predecessor's cleanup runs, share a name
  // but must each hold their own slot — a name-keyed map would clobber one.
  const entries = new Map<number, { name: string; source: HealthSource }>();
  // The readiness legs (`liveWhen` predicates) AND-folded into `live` alongside
  // the transport leg — same id-keyed/auto-dropping discipline as `entries`.
  const readiness = new Map<
    number,
    { name: string; live: Accessor<boolean> }
  >();
  // Bumped on every add/remove so `health` re-folds on membership change.
  // `equals: false` makes each bump a distinct notification even though the
  // value is constant.
  //
  // `ownedWrite`, DELIBERATELY and permanently — the guide's own case, "an
  // internal signal that intentionally accepts in-scope writes". Enrolment is not
  // a delivery that could be moved to the effect phase the way a stream's frames
  // were: `enroll` registers in the CALLER's owned scope because that owner is
  // what retracts it (the `onCleanup` below), so the registration and this
  // notification are one act performed from a component body. Deferring the bump
  // would make `health()` describe a roster one flush older than the components
  // currently mounted — a gate that renders ready over a sub nobody has counted
  // yet — and splitting the bump from the `entries.set` would let the two
  // disagree. The counter is internal (no consumer can write it), carries no
  // value, and the matching DROP is already exempt (a write during disposal is
  // not an owned-scope write).
  const [membership, bumpMembership] = createSignal(0, {
    equals: false,
    ownedWrite: true,
  });
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
    // Rides the consumer's reactive owner when there is one — that owner is what
    // retracts the enrolment. An IMPERATIVE caller has none, and retracts through
    // the returned disposer instead: a cleanup registered with no owner would
    // never run, which Solid 2 reports (NO_OWNER_CLEANUP) rather than swallow.
    if (getOwner()) onCleanup(dispose);
    return dispose;
  }

  function enrollReadiness(name: string, live: Accessor<boolean>): () => void {
    const id = nextId++;
    readiness.set(id, { name, live });
    bumpMembership(0);
    let disposed = false;
    const dispose = (): void => {
      if (disposed) return;
      disposed = true;
      readiness.delete(id);
      bumpMembership(0);
    };
    if (getOwner()) onCleanup(dispose); // see `enroll`: an ownerless caller uses the disposer
    return dispose;
  }

  // THE FOLD, ONCE PER CLIENT AND IN CHUNKS — the reason `health()` costs its
  // caller two sources rather than two per enrolled subscription.
  //
  // Reading each sub's `pending()`/`error()` from the CALLING scope subscribed
  // that scope to every one of them, so the readout memo every indicator binds
  // carried `2N` sources and crossed Solid's 200-source `WIDE_SCOPE_DEPS` judge
  // at ~99 subscriptions — which per-key collection delivery reaches with ~95
  // open rows. The walk lives here now, split so that no scope in it is wide:
  //
  //   - `slots` reads the membership counter and nothing else (1 source);
  //   - one CHUNK memo per {@link CHUNK} consecutive slots reads the slot list
  //     and its own rows' two accessors (`1 + 2·CHUNK`);
  //   - the JOIN reads the chunk list and every chunk (`1 + ⌈N / CHUNK⌉`);
  //   - `live` is its own memo, so a transport flip re-folds no sub at all.
  //
  // Chunks are keyed by POSITION in the slot list, so an enrolment or a drop
  // re-runs the chunks at or after it and the join; each holds its previous
  // value when its own members did not change, so a reader wakes for a fact
  // that moved and for nothing else.
  //
  // This is NOT the per-subscription fold the readout's docstring rejects (a
  // standing computation per enrolled sub, each writing into a shared set):
  // there is one computation per 64 subs plus two, no sub owns one, and the
  // pass still runs only when the fact changes.
  let folded: Accessor<SurfaceHealth> | undefined;
  let dropFold: (() => void) | undefined;

  // DETACHED, and lazily: the first read of `health()` is usually inside some
  // consumer's memo, and `createRoot` inherits the owner it is called under, so
  // an attached fold would die with whichever indicator happened to read first.
  // Lazy also keeps the registry's build-time promise — a client nobody asks
  // about health allocates no computation at all.
  const buildFold = (): Accessor<SurfaceHealth> =>
    runWithOwner(null, () =>
      createRoot((dispose) => {
        dropFold = dispose;
        const slots = createMemo(
          () => {
            membership(); // track add/remove (subs AND readiness legs)
            return [...entries.values()];
          },
          { name: "surfaceHealth.slots", equals: sameSlots },
        );
        const chunks = mapArray(
          () =>
            Array.from(
              { length: Math.ceil(slots().length / CHUNK) },
              (_, at) => at * CHUNK,
            ),
          (start) =>
            createMemo(
              () => {
                const reading: SubHealth[] = [];
                for (const { name, source } of slots().slice(
                  start,
                  start + CHUNK,
                )) {
                  // Each read tracks that sub's self-clearing error()/pending(),
                  // so the fact re-folds the instant any enrolled sub errors OR
                  // recovers.
                  reading.push({
                    name,
                    pending: source.pending(),
                    error: source.error(),
                  });
                }
                return reading;
              },
              { name: "surfaceHealth.chunk", equals: sameSubs },
            ),
          { name: "surfaceHealth.byChunk" },
        );
        const subs = createMemo(
          () => {
            const reading: SubHealth[] = [];
            for (const chunk of chunks()) reading.push(...chunk());
            return reading;
          },
          { name: "surfaceHealth.subs", equals: sameSubs },
        );
        // `live` is the conjunction of the transport leg and every readiness
        // leg. Reading each `leg()` tracks the cell value it closes over, so the
        // fact re-folds the instant a readiness cell's state changes — by
        // construction, never a hand-AND a consumer can forget. One leg per
        // `liveWhen` cell the SURFACE DECLARES, so this count is the spec's and
        // never a page's.
        const live = createMemo(
          () => {
            membership();
            let folding = transportLive();
            for (const { live: leg } of readiness.values())
              folding = folding && leg();
            return folding;
          },
          { name: "surfaceHealth.live" },
        );
        return () => ({ live: live(), subs: subs() });
      }),
    ) as Accessor<SurfaceHealth>;

  const health: Accessor<SurfaceHealth> = () => {
    folded ??= buildFold();
    return folded();
  };

  // Ends the fold's root. Idempotent, and it CLEARS the slot rather than
  // latching a dead one: a read after disposal rebuilds, exactly as the first
  // read did, over whatever is still enrolled (on the client teardown path,
  // nothing).
  const disposeFold = (): void => {
    dropFold?.();
    dropFold = undefined;
    folded = undefined;
  };

  return { enroll, enrollReadiness, health, disposeFold };
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
