/** Typed channel registry for terminal + system events.
 *
 *  One `MemoryPublisher` instance, two named registries on top:
 *
 *    - `terminalChannels` — keyed-broadcast bus per `(channel, terminalId)`
 *      pair. Each entry is a `ChannelBus<T>` from `@kolu/surface/server`,
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

import { type ChannelBus, publisherChannel } from "@kolu/surface/server";
import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import type { GitInfo } from "kolu-common";

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
 *  the `savedSession` cell's own channel (see `cellBus.savedSession`). */
export const terminalsDirtyChannel = publisherChannel<Record<string, never>>(
  publisher,
  "terminals:dirty",
);

/** Spawn a fire-and-forget consumer that iterates `channel` until `signal`
 *  aborts, dispatches each value to `onEvent`, and routes uncaught errors
 *  to `onError` — but only when the signal isn't already aborted, since
 *  the publisher's iterator rejects with `signal.reason` on clean
 *  shutdown (suppressing those keeps the log free of expected
 *  end-of-life noise). The five providers in `meta/*.ts` all consume a
 *  per-terminal channel this way. */
export function consumeChannel<T>(
  channel: ChannelBus<T>,
  signal: AbortSignal,
  onEvent: (value: T) => void,
  onError: (err: unknown) => void,
): void {
  void (async () => {
    try {
      for await (const value of channel.subscribe(signal)) onEvent(value);
    } catch (err) {
      if (!signal.aborted) onError(err);
    }
  })();
}
