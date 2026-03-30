/** Typed in-memory publisher for all terminal and system events.
 *
 *  Terminal events use per-terminal channel names ("metadata:<id>", "data:<id>", etc.)
 *  so EventPublisher's Map dispatches directly to the right subscriber — no broadcast+filter.
 *
 *  System events ("session:changed") are broadcast channels with no terminal prefix. */

import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import type { TerminalMetadata } from "kolu-common";
import { log } from "./log.ts";

/** Payload types per channel. Terminal channels are keyed as "channel:terminalId" at runtime. */
type TerminalChannels = {
  /** All server-derived terminal state — from metadata providers and idle timer */
  metadata: TerminalMetadata;
  /** Raw PTY output bytes — high frequency, drives xterm.js */
  data: string;
  /** Terminal process exited — fires once per terminal lifetime */
  exit: number;
};

/** System-wide broadcast channels (no terminal prefix). */
type SystemChannels = {
  /** Terminal state changed — triggers debounced session auto-save */
  "session:changed": Record<string, never>;
};

// The publisher accepts any string channel at runtime.
// Terminal channels are namespaced as "channel:terminalId"; system channels are used as-is.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const publisher = new MemoryPublisher<Record<string, any>>();

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

/** Subscribe to a per-terminal channel, returning an AsyncIterable.
 *  Primitive — used by router handlers (yield) and subscribeForTerminal (callback). */
export function subscribeForTerminal_<C extends keyof TerminalChannels>(
  channel: C,
  terminalId: string,
  signal: AbortSignal | undefined,
): AsyncIterable<TerminalChannels[C]> {
  return publisher.subscribe(`${String(channel)}:${terminalId}`, { signal }) as AsyncIterable<TerminalChannels[C]>;
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
      for await (const event of subscribeForTerminal_(channel, terminalId, signal)) {
        onEvent(event);
      }
    } catch (err) {
      if (!signal.aborted) log.error({ err, terminal: terminalId, channel }, "publisher subscription failed");
    }
  })();
}
