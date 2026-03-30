/** Typed in-memory publisher for all terminal events.
 *  Single pub/sub mechanism — replaces per-terminal EventEmitter entirely. */

import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import type { TerminalMetadata } from "kolu-common";
import { log } from "./log.ts";

export type PublisherChannels = {
  /** CWD, git, PR, Claude state — from metadata providers */
  metadata: { terminalId: string; metadata: TerminalMetadata };
  /** Active/sleeping transitions — from idle timer */
  activity: { terminalId: string; isActive: boolean };
  /** Raw PTY output bytes — high frequency, drives xterm.js */
  data: { terminalId: string; data: string };
  /** Terminal process exited — fires once per terminal lifetime */
  exit: { terminalId: string; exitCode: number };
};

export const publisher = new MemoryPublisher<PublisherChannels>();

/** Subscribe to a publisher channel, filtered to a specific terminal.
 *  Runs until the signal aborts. Logs unexpected errors. */
export function subscribeForTerminal<C extends keyof PublisherChannels>(
  channel: C,
  terminalId: string,
  signal: AbortSignal,
  onEvent: (payload: PublisherChannels[C]) => void,
): void {
  void (async () => {
    try {
      for await (const event of publisher.subscribe(channel, { signal })) {
        if (event.terminalId === terminalId) onEvent(event);
      }
    } catch (err) {
      if (!signal.aborted) log.error({ err, terminal: terminalId, channel }, "publisher subscription failed");
    }
  })();
}
