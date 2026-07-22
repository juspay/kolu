/** Typed channel registry for system events.
 *
 *  One `MemoryPublisher` instance with a single named channel on top:
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
 *  and the framework publishes through the same `MemoryPublisher` instance
 *  this file uses, via the `channel: <T>(name) => publisherChannel(...)`
 *  factory the surface is wired with. Same one-channel-per-key convention,
 *  framework-owned for cells/collections/events.
 */

import { publisherChannel } from "@kolu/surface/server";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import { log } from "./log.ts";

// `MemoryPublisher` constrains its generic to `Record<string, object>`,
// which excludes the primitive payloads we publish (data strings, exit
// codes). The generic is dead weight here — type safety on every real
// call site comes from the typed bus shapes below, not from this generic.
// biome-ignore lint/suspicious/noExplicitAny: library's Record<string, object> generic is too strict for our primitive payloads (data: string, exit: number, …); call-site types come from the typed channels below, not from this generic.
export const publisher = new MemoryPublisher<Record<string, any>>();

/** Total pending events + active listeners across all channels. Exposed for
 *  diagnostics (see diagnostics.ts) — climbs if subscribers aren't draining. */
export const publisherSize = (): number => publisher.size;

/** Singleton broadcast: terminal state mutated. Drives the session autosave
 *  gate AND the live-activity tap reconciliation (`liveActivity.ts`) — the
 *  consumer-agnostic pulse both subscribe to. The persisted content lives on
 *  the surface's framework-owned `session:changed` channel, written via
 *  `surfaceCtx.cells.session.set(...)` from `./session.ts`. */
export const terminalsDirtyChannel = publisherChannel<Record<string, never>>(
  publisher,
  "terminals:dirty",
);

// Agent-bucket TRANSITIONS — a SYNCHRONOUS observer registry (not a MemoryPublisher
// channel). `commitSnapshot` publishes `{ id, isWaiting }` the moment a terminal's
// agent crosses INTO or OUT OF the `waiting` bucket; the effective-finish gate
// (`finishGate.ts`) subscribes. Unlike the reconcile poll it fires on the commit
// firehose, so it never misses a fast `waiting → working → waiting` cycle. It is
// deliberately SYNCHRONOUS (a plain callback fan-out, not an async iterator): the
// gate must drop a stale settle BEFORE `publishComposedTerminal` recomputes urgency
// off the same commit, and an async delivery would land a microtask too late.
// Published only on a bucket CHANGE (not every ~150 ms tick), so a static waiting
// terminal is silent.
const agentBucketObservers = new Set<
  (id: string, isWaiting: boolean) => void
>();

/** Subscribe to agent-bucket transitions (synchronous dispatch). Returns an
 *  unsubscribe. */
export function subscribeAgentBucket(
  cb: (id: string, isWaiting: boolean) => void,
): () => void {
  agentBucketObservers.add(cb);
  return () => {
    agentBucketObservers.delete(cb);
  };
}

/** Publish an agent-bucket transition SYNCHRONOUSLY to every subscriber. Guarded
 *  per-subscriber like `notifyDirty` — a throwing subscriber must not propagate back
 *  into the sensor commit path. */
export function publishAgentBucket(id: string, isWaiting: boolean): void {
  for (const cb of agentBucketObservers) {
    try {
      cb(id, isWaiting);
    } catch (err) {
      log.error({ err }, "agent:bucket subscriber threw");
    }
  }
}

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
