/** Typed channel registry for system events.
 *
 *  One in-process publisher instance with a single named channel on top:
 *
 *    - `terminalsDirtyChannel` — singleton control-flow signal that
 *      drives the session autosave gate AND the live-activity tap
 *      reconciliation (`liveActivity.ts`) — a two-consumer broadcast.
 *      Distinct from the `terminalList` cell's content channel: this is
 *      the *trigger*, not the saved content.
 *
 *  The per-terminal VT-tap channels (cwd / title / command-run / git) that
 *  used to live here are now per-terminal in-memory channels created by the
 *  local endpoint (`terminalEndpoint/local.ts`), fed from the pty-host's tap
 *  streams over the `ptyHostSurface` contract; their only consumers are the
 *  providers, which run in kolu-server against those channels. kolu-server no
 *  longer brokers them through this module's publisher.
 *
 *  Cell-level system channels (`preferences:changed`, `activityFeed:changed`,
 *  `session:changed`, `terminalList:changed`) are owned by `implementSurface`
 *  in `./surface.ts` — domain code mutates via `surfaceCtx.cells.X.set(...)`
 *  and the framework publishes through the same publisher instance
 *  this file uses, via the `channel: <T>(name) => publisherChannel(...)`
 *  factory the surface is wired with. Same one-channel-per-key convention,
 *  framework-owned for cells/collections/events.
 *
 *  ── The publisher itself (PLAN D7) ────────────────────────────────────────
 *  This was oRPC's `MemoryPublisher`. It is now `@kolu/surface`'s OWN
 *  `inMemoryPublisher` — the repo's existing source of truth for exactly this
 *  shape (a name-keyed `{publish, subscribe}` registry `publisherChannel`
 *  adapts), rather than a second implementation of one concept.
 *
 *  What the swap had to preserve is ORDERING, because this ONE instance is
 *  shared with kolu-server's in-process surface and its cross-channel ordering
 *  is load-bearing — `kill.feature` ("Natural PTY exit removes terminal") pins
 *  it end-to-end. It is preserved BY CONSTRUCTION and already proven upstream:
 *  `@kolu/surface`'s `streamOrdering.test.ts` states both of D3's opposing
 *  invariants implementation-independently ((a) two channels publishing in one
 *  tick deliver in publish order at the consumer; (b) a single-emission-
 *  then-complete event source delivers its value before end-of-stream) and runs
 *  them against `implementSurface` over these very primitives. Nothing about
 *  padi's use differs in shape from what those tests exercise — one publisher,
 *  named channels, `publisherChannel` adapters — so no padi-side ordering test
 *  is added here; a duplicate would pin the same mechanism in a second place
 *  and drift.
 *
 *  Two honest differences from the retired library publisher, both stated
 *  rather than absorbed:
 *    - it drops a publish to a name NOBODY has subscribed to (lazy channel
 *      creation), instead of accumulating a permanent empty channel per name.
 *      For this module's ONE always-subscribed channel that is invisible;
 *    - it exposes no `size`, so {@link publisherSize} is derived from the one
 *      thing this module can honestly count — see its docstring.
 */

import {
  type Channel,
  inMemoryPublisher,
  publisherChannel,
} from "@kolu/surface/server";
import { log } from "./log.ts";

/** The process-wide in-process publisher — kolu's own, shared with
 *  kolu-server's surface (`server/src/surface.ts` imports it from
 *  `@kolu/padi/assembly`) because ONE instance is what makes cross-channel
 *  ordering a fact rather than a hope. Untyped by name (the registry is
 *  string-keyed); type safety on every real call site comes from the typed
 *  channels below. */
export const publisher = inMemoryPublisher();

/** How many consumers currently hold a `terminals:dirty` subscription.
 *
 *  Owned here rather than read off the framework because
 *  `publisherChannel`/`inMemoryPublisher` expose no such counter, and the ONE
 *  place every subscription to this channel passes through is the wrapper
 *  below — so this tally cannot disagree with reality, it IS the reality for
 *  this channel. */
let dirtySubscribers = 0;

/** Singleton broadcast: terminal state mutated. Drives the session autosave
 *  gate AND the live-activity tap reconciliation (`liveActivity.ts`) — the
 *  consumer-agnostic pulse both subscribe to. The persisted content lives on
 *  the surface's framework-owned `session:changed` channel, written via
 *  `surfaceCtx.cells.session.set(...)` from `./session.ts`.
 *
 *  Built on the SHARED publisher (not a standalone `inMemoryChannel`) for the
 *  abort contract, not for ordering: `publisherChannel` wraps the iterator in
 *  `iterateUntilAborted`, so a consumer's `for await` ENDS quietly when its
 *  signal aborts instead of rejecting with the abort reason — which is what the
 *  autosave gate's teardown relies on. */
const dirtyChannel = publisherChannel<Record<string, never>>(
  publisher,
  "terminals:dirty",
);

/** Count a subscription for its whole life — up when the consumer starts
 *  pulling, down when its loop ends by ANY route (return, throw, or the
 *  abort-time quiet end `iterateUntilAborted` produces). A `finally` around the
 *  delegating loop is the one place all three converge. */
async function* tallied<T>(source: AsyncIterable<T>): AsyncIterable<T> {
  dirtySubscribers += 1;
  try {
    for await (const value of source) yield value;
  } finally {
    dirtySubscribers -= 1;
  }
}

const subscribeDirty = (
  signal: AbortSignal | undefined,
): AsyncIterable<Record<string, never>> =>
  tallied(dirtyChannel.subscribe(signal));

export const terminalsDirtyChannel: Channel<Record<string, never>> = {
  publish: (value) => dirtyChannel.publish(value),
  subscribe: subscribeDirty,
  // The same body the framework's own `buildConsume` has, over the TALLIED
  // subscribe — so both entry points are counted. (`buildConsume` is private to
  // `@kolu/surface/server`, so there is nothing to reuse here.)
  consume: ({ onEvent, onError }) => {
    const controller = new AbortController();
    void (async () => {
      try {
        for await (const value of subscribeDirty(controller.signal)) {
          onEvent(value);
        }
      } catch (err) {
        if (!controller.signal.aborted) onError(err);
      }
    })();
    return () => controller.abort();
  },
};

/** Live `terminals:dirty` subscribers — the diagnostics readout (see
 *  diagnostics.ts).
 *
 *  It used to be the retired library publisher's `size` (pending events +
 *  listeners across every channel). The replacement exposes no such counter,
 *  and inventing one would mean either reaching into the framework's private
 *  channel map or keeping a parallel tally that can disagree with it — a second
 *  source of truth for one fact. So this reports what this module can count
 *  honestly and completely: the live subscriptions on the channel it owns. It
 *  still answers the question the readout exists for — "is something failing to
 *  unsubscribe?" — because a leak shows up as a climbing count. */
export const publisherSize = (): number => dirtySubscribers;

/** Emit the shared `terminals:dirty` pulse — the SINGLE writer-facing arm every
 *  terminal/metadata writer calls when a restore-relevant change lands. Arms the
 *  autosave gate (via its subscription) and reconciles the activity taps
 *  (`liveActivity.ts`), the pulse's other consumer. Lives HERE, beside the channel
 *  it wraps, so producers depend on the neutral channel registry rather than on
 *  either consumer. Guarded at the boundary: a throwing subscriber must not propagate
 *  back into the producer's emit loop (which would freeze a sensor); logged, not
 *  fatal — the next restore-relevant change re-arms. */
export function notifyDirty(): void {
  try {
    terminalsDirtyChannel.publish({});
  } catch (err) {
    log.error({ err }, "terminals:dirty publish threw");
  }
}
