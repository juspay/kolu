/** Typed channel registry for system events.
 *
 *  One `MemoryPublisher` instance with a single named channel on top:
 *
 *    - `terminalsDirtyChannel` — singleton control-flow signal that
 *      drives the session auto-save debounce loop. Distinct from the
 *      `terminalList` cell's content channel: this is the *trigger*,
 *      not the saved content.
 *
 *  The per-terminal VT-tap channels (cwd / title / command-run / foreground)
 *  are no longer brokered here. Since #951 R4c the `kolu --stdio` PTY-host
 *  daemon owns the raw taps; `terminalBackend/local.ts` subscribes to them
 *  over the socket and feeds fresh per-terminal in-memory channels to the
 *  provider DAG (`terminalBackend/providers.ts`), which runs in kolu-server.
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

// `MemoryPublisher` constrains its generic to `Record<string, object>`,
// which excludes the primitive payloads we publish (data strings, exit
// codes). The generic is dead weight here — type safety on every real
// call site comes from the typed bus shapes below, not from this generic.
// biome-ignore lint/suspicious/noExplicitAny: library's Record<string, object> generic is too strict for our primitive payloads (data: string, exit: number, …); call-site types come from the typed channels below, not from this generic.
export const publisher = new MemoryPublisher<Record<string, any>>();

/** Total pending events + active listeners across all channels. Exposed for
 *  diagnostics (see diagnostics.ts) — climbs if subscribers aren't draining. */
export const publisherSize = (): number => publisher.size;

/** Singleton broadcast: terminal state mutated. Drives session
 *  auto-save's debounced write loop; the persisted content lives on
 *  the surface's framework-owned `session:changed` channel, written
 *  via `surfaceCtx.cells.session.set(...)` from `./session.ts`. */
export const terminalsDirtyChannel = publisherChannel<Record<string, never>>(
  publisher,
  "terminals:dirty",
);
