/** Typed in-memory publisher for all terminal and system events.
 *
 *  Terminal events use per-terminal channel names ("metadata:<id>", "data:<id>", etc.)
 *  so EventPublisher's Map dispatches directly to the right subscriber — no broadcast+filter.
 *
 *  System events ("preferences:changed", "terminals:dirty", etc.) are broadcast
 *  channels with no terminal prefix. */

import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import type {
  ActivityFeed,
  GitInfo,
  Preferences,
  SavedSession,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common";
import { log } from "./log.ts";

/** Payload types per channel. Terminal channels are keyed as "channel:terminalId" at runtime. */
type TerminalChannels = {
  /** All server-derived terminal state — client-facing aggregated channel */
  metadata: TerminalMetadata;
  /** CWD changed (OSC 7 from PTY) — triggers git provider */
  cwd: string;
  /** Terminal title changed (OSC 0/2 from PTY) — triggers process provider */
  title: string;
  /** Git context changed — triggers github PR provider */
  git: GitInfo | null;
  /** Raw PTY output bytes — high frequency, drives xterm.js */
  data: string;
  /** Raw command string from OSC 633;E preexec mark — triggers agent-command
   *  tracking (per-terminal stash + recent-agents MRU). Not retained; each
   *  event is an isolated "the user just typed this" notice. */
  commandRun: string;
  /** Terminal process exited — fires once per terminal lifetime */
  exit: number;
};

/** System-wide broadcast channels (no terminal prefix). */
type SystemChannels = {
  /** Terminal state changed — triggers debounced session auto-save.
   *  Distinct from `session:changed`: this is the autosave *trigger*
   *  (control flow), not the saved-session content. */
  "terminals:dirty": Record<string, never>;
  /** Terminal list changed (create/kill) — drives live list query */
  "terminal-list": TerminalInfo[];
  /** User preferences changed — drives the preferences live query.
   *  Fired on every `updatePreferences` write. */
  "preferences:changed": Preferences;
  /** Activity feed changed (recent repos / agents) — drives the activity live
   *  query. Fired on every `trackRecentRepo` / `trackRecentAgent`. */
  "activity:changed": ActivityFeed;
  /** Saved-session content changed — drives the session live query.
   *  Fired when the persisted session blob is written or cleared. */
  "session:changed": SavedSession | null;
};

// The publisher accepts any string channel at runtime.
// Terminal channels are namespaced as "channel:terminalId"; system channels are used as-is.
//
// `MemoryPublisher` constrains its generic to `Record<string, object>`,
// which excludes the primitive payloads kolu actually publishes (strings
// like terminal data + cwd + title, numbers like exit codes). The
// generic itself is dead weight here: type safety on actual publish/
// subscribe calls is enforced by the typed wrappers below
// (`publishForTerminal` / `publishSystem` / `subscribeForTerminal` /
// `subscribeSystem`) using Kolu's own `TerminalChannels` and
// `SystemChannels`. So this `any` widens *only* the unused library
// generic; every real call site is still strictly typed.
// biome-ignore lint/suspicious/noExplicitAny: library's Record<string, object> generic is too strict for our primitive payloads (data: string, exit: number, …); call-site types come from the typed wrappers below, not from this generic.
export const publisher = new MemoryPublisher<Record<string, any>>();

/** Total pending events + active listeners across all channels. Exposed for
 *  diagnostics (see diagnostics.ts) — climbs if subscribers aren't draining. */
export const publisherSize = (): number => publisher.size;

/** Publish an event on a per-terminal channel ("channel:terminalId"). */
export function publishForTerminal<C extends keyof TerminalChannels>(
  channel: C,
  terminalId: string,
  payload: TerminalChannels[C],
): void {
  void publisher.publish(`${String(channel)}:${terminalId}`, payload);
}

/** Publish an event on a system-wide broadcast channel. */
export function publishSystem<C extends keyof SystemChannels>(
  channel: C,
  payload: SystemChannels[C],
): void {
  void publisher.publish(channel, payload);
}

/** Iterate `source` and yield each item, ending cleanly if the iterator
 *  rejects with the signal's abort reason.
 *
 *  orpc's WebSocket adapter calls `peer.close()` when the socket closes,
 *  which `AbortController.abort()`s every in-flight stream's signal. The
 *  publisher iterator (see `@orpc/experimental-publisher`) then rejects
 *  pending pulls with `signal.reason` directly. In this app every abort
 *  comes from a tab close — clients never cancel mid-stream — so the
 *  expected end-of-life of every streaming handler IS this rejection.
 *  Letting it propagate causes the orpc pino plugin to log a full
 *  DOMException stack at INFO on every disconnect (issue #443). The
 *  identity check (`err === signal.reason`) leaves real errors untouched. */
async function* iterateUntilAborted<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal | undefined,
): AsyncGenerator<T> {
  try {
    for await (const item of source) yield item;
  } catch (err) {
    if (signal?.aborted && err === signal.reason) return;
    throw err;
  }
}

/** Subscribe to a system-wide broadcast channel, returning an AsyncIterable.
 *  Used by router handlers (yield) for system-level streams. */
export function subscribeSystem_<C extends keyof SystemChannels>(
  channel: C,
  signal: AbortSignal | undefined,
): AsyncIterable<SystemChannels[C]> {
  return iterateUntilAborted(
    publisher.subscribe(channel, { signal }) as AsyncIterable<
      SystemChannels[C]
    >,
    signal,
  );
}

/** Subscribe to a per-terminal channel, returning an AsyncIterable.
 *  Primitive — used by router handlers (yield) and subscribeForTerminal (callback). */
export function subscribeForTerminal_<C extends keyof TerminalChannels>(
  channel: C,
  terminalId: string,
  signal: AbortSignal | undefined,
): AsyncIterable<TerminalChannels[C]> {
  return iterateUntilAborted(
    publisher.subscribe(`${String(channel)}:${terminalId}`, {
      signal,
    }) as AsyncIterable<TerminalChannels[C]>,
    signal,
  );
}

/** Subscribe to a per-terminal channel with a callback. Fire-and-forget convenience
 *  wrapper around subscribeForTerminal_ — logs unexpected errors. Used by providers. */
export function subscribeForTerminal<C extends keyof TerminalChannels>(
  channel: C,
  terminalId: string,
  signal: AbortSignal,
  onEvent: (payload: TerminalChannels[C]) => void,
): void {
  void (async () => {
    try {
      for await (const event of subscribeForTerminal_(
        channel,
        terminalId,
        signal,
      )) {
        onEvent(event);
      }
    } catch (err) {
      if (!signal.aborted)
        log.error(
          { err, terminal: terminalId, channel },
          "publisher subscription failed",
        );
    }
  })();
}
