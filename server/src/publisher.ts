/** Typed in-memory publisher for terminal events.
 *  Single pub/sub mechanism for metadata, activity, and inter-provider chaining. */

import { MemoryPublisher } from "@orpc/experimental-publisher/memory";
import type { TerminalMetadata } from "kolu-common";
import { log } from "./log.ts";

export type PublisherChannels = {
  metadata: { terminalId: string; metadata: TerminalMetadata };
  activity: { terminalId: string; isActive: boolean };
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
