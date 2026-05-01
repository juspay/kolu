/** Typed channel registry for terminal + system events.
 *
 *  One `MemoryPublisher` instance, two named registries on top:
 *
 *    - `terminalChannels` — keyed-broadcast bus per `(channel, terminalId)`
 *      pair. Each entry is a `ChannelBus<T>` from `@kolu/cells/server`,
 *      owning both publish AND subscribe for its named channel. Single
 *      source of truth for what events exist per terminal.
 *    - `terminalsDirtyChannel` — singleton control-flow signal that
 *      drives the session auto-save debounce loop. Distinct from the
 *      `terminalList` cell's content channel: this is the *trigger*,
 *      not the saved content.
 *
 *  Cell-level system channels (`preferences:changed`, `activity:changed`,
 *  `session:changed`, `terminal-list`) live in `./cells.ts`'s `cellBus`
 *  alongside the corresponding `Cell` descriptor — same one-bus-per-cell
 *  convention this file uses for the per-terminal axis.
 */

import { publisherChannel } from "@kolu/cells/server";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import type { GitInfo, TerminalMetadata } from "kolu-common";

// `MemoryPublisher` constrains its generic to `Record<string, object>`,
// which excludes the primitive payloads we publish (data strings, exit
// codes). The generic is dead weight here — type safety on every real
// call site comes from the typed bus shapes below, not from this generic.
// biome-ignore lint/suspicious/noExplicitAny: library's Record<string, object> generic is too strict for our primitive payloads (data: string, exit: number, …); call-site types come from the typed channels below, not from this generic.
export const publisher = new MemoryPublisher<Record<string, any>>();

/** Total pending events + active listeners across all channels. Exposed for
 *  diagnostics (see diagnostics.ts) — climbs if subscribers aren't draining. */
export const publisherSize = (): number => publisher.size;

/** Typed per-terminal channels. Each builder returns a `ChannelBus<T>`
 *  scoped to that terminal id — `terminalChannels.cwd(id).publish(cwd)`
 *  and `terminalChannels.cwd(id).subscribe(signal)` are symmetric.
 *
 *  Adding a new per-terminal event = one entry here. Eliminates the
 *  prior split between `publishForTerminal` (write-side) and
 *  `subscribeForTerminal_` (read-side), which had drifted into
 *  separate type maps maintained in two places. */
export const terminalChannels = {
  /** Raw PTY output bytes — high frequency, drives xterm.js. */
  data: (id: string) => publisherChannel<string>(publisher, `data:${id}`),
  /** All server-derived terminal state — client-facing aggregated channel. */
  metadata: (id: string) =>
    publisherChannel<TerminalMetadata>(publisher, `metadata:${id}`),
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
  /** Terminal process exited — fires once per terminal lifetime. */
  exit: (id: string) => publisherChannel<number>(publisher, `exit:${id}`),
} as const;

/** Singleton broadcast: terminal state mutated. Drives session
 *  auto-save's debounced write loop; the persisted content lives on
 *  the `savedSession` cell's own channel (see `cellBus.savedSession`). */
export const terminalsDirtyChannel = publisherChannel<Record<string, never>>(
  publisher,
  "terminals:dirty",
);
