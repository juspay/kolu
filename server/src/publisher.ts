/**
 * Event publisher — discrete, non-state events only.
 *
 * State (terminal list, metadata, server state) is managed via @solidjs/signals
 * and streamed to clients through toAsyncIterable(). This publisher handles
 * only fire-and-forget events that aren't "current value" state:
 *
 * - data:<id>     — raw PTY output bytes (high frequency, drives xterm.js)
 * - activity:<id> — busy/idle transitions [epochMs, isActive]
 * - exit:<id>     — terminal process exited (fires once per lifetime)
 */

import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import type { ActivitySample } from "kolu-common";

/** Event types — discrete, non-state events only. */
type TerminalEvents = {
  /** Activity transition [epochMs, isActive] — high frequency, separate from metadata */
  activity: ActivitySample;
  /** Raw PTY output bytes — high frequency, drives xterm.js */
  data: string;
  /** Terminal process exited — fires once per terminal lifetime */
  exit: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const publisher = new MemoryPublisher<Record<string, any>>();

/** Publish an event on a per-terminal channel ("channel:terminalId"). */
export function publishEvent<C extends keyof TerminalEvents>(
  channel: C,
  terminalId: string,
  payload: TerminalEvents[C],
): void {
  void publisher.publish(`${String(channel)}:${terminalId}`, payload);
}

/** Subscribe to a per-terminal event channel, returning an AsyncIterable.
 *  Used by router handlers for event streams. */
export function subscribeEvent<C extends keyof TerminalEvents>(
  channel: C,
  terminalId: string,
  signal: AbortSignal | undefined,
): AsyncIterable<TerminalEvents[C]> {
  return publisher.subscribe(`${String(channel)}:${terminalId}`, {
    signal,
  }) as AsyncIterable<TerminalEvents[C]>;
}
