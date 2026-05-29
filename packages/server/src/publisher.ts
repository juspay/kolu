/** Typed channel registry for terminal + system events.
 *
 *  One `MemoryPublisher` instance, two named registries on top:
 *
 *    - `terminalChannels` — keyed-broadcast bus per `(channel, terminalId)`
 *      pair. Each entry is a `Channel<T>` from `@kolu/surface/server`,
 *      owning publish, subscribe, AND `consume` (subscribe + dispatch +
 *      auto-cleanup). Single source of truth for what events exist per
 *      terminal.
 *    - `terminalsDirtyChannel` — singleton control-flow signal that
 *      drives the session auto-save debounce loop. Distinct from the
 *      `terminalList` cell's content channel: this is the *trigger*,
 *      not the saved content.
 *
 *  Cell-level system channels (`preferences:changed`, `activityFeed:changed`,
 *  `session:changed`, `terminalList:changed`) are owned by `implementSurface`
 *  in `./surface.ts` — domain code mutates via `surfaceCtx.cells.X.set(...)`
 *  and the framework publishes through the same `MemoryPublisher` instance
 *  this file uses, via the `channel: <T>(name) => publisherChannel(...)`
 *  factory the surface is wired with. Same one-channel-per-key convention,
 *  framework-owned for cells/collections/events; this file keeps the
 *  per-terminal axis where the framework can't model it.
 */

import { publisherChannel } from "@kolu/surface/server";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import type { GitInfo } from "kolu-git/schemas";

// `MemoryPublisher` constrains its generic to `Record<string, object>`,
// which excludes the primitive payloads we publish (data strings, exit
// codes). The generic is dead weight here — type safety on every real
// call site comes from the typed bus shapes below, not from this generic.
// biome-ignore lint/suspicious/noExplicitAny: library's Record<string, object> generic is too strict for our primitive payloads (data: string, exit: number, …); call-site types come from the typed channels below, not from this generic.
export const publisher = new MemoryPublisher<Record<string, any>>();

/** Total pending events + active listeners across all channels. Exposed for
 *  diagnostics (see diagnostics.ts) — climbs if subscribers aren't draining. */
export const publisherSize = (): number => publisher.size;

/** Typed per-terminal channels. Each builder returns a `Channel<T>`
 *  scoped to that terminal id — `terminalChannels.cwd(id).publish(cwd)`
 *  and `terminalChannels.cwd(id).subscribe(signal)` are symmetric.
 *
 *  Adding a new per-terminal event = one entry here. Eliminates the
 *  prior split between `publishForTerminal` (write-side) and
 *  `subscribeForTerminal_` (read-side), which had drifted into
 *  separate type maps maintained in two places. */
export const terminalChannels = {
  /** CWD changed (OSC 7 from PTY) — feeds the git provider. */
  cwd: (id: string) => publisherChannel<string>(publisher, `cwd:${id}`),
  /** Terminal title changed (OSC 0/2 from PTY) — feeds the process provider. */
  title: (id: string) => publisherChannel<string>(publisher, `title:${id}`),
  /** Git context changed — feeds the github PR provider. */
  git: (id: string) => publisherChannel<GitInfo | null>(publisher, `git:${id}`),
  /** Raw command string from OSC 633;E preexec mark — feeds agent-command
   *  tracking (per-terminal stash + recent-agents MRU). Not retained;
   *  each event is an isolated "the user just typed this" notice. */
  commandRun: (id: string) =>
    publisherChannel<string>(publisher, `commandRun:${id}`),
} as const;

/** Singleton broadcast: terminal state mutated. Drives session
 *  auto-save's debounced write loop; the persisted content lives on
 *  the surface's framework-owned `session:changed` channel, written
 *  via `surfaceCtx.cells.session.set(...)` from `./session.ts`. */
export const terminalsDirtyChannel = publisherChannel<Record<string, never>>(
  publisher,
  "terminals:dirty",
);
