/** Terminal exit stream — subscribes to exit events for cleanup.
 *  Metadata and activity streams are handled by TerminalLiveData (TanStack live queries). */

import type { TerminalId } from "kolu-common";
import { client } from "./rpc";

/** Fire-and-forget stream subscription with AbortController cleanup. */
function subscribeStream<T>(
  startStream: (signal: AbortSignal) => Promise<AsyncIterable<T>>,
  onValue: (value: T) => void,
): () => void {
  const controller = new AbortController();
  (async () => {
    try {
      const stream = await startStream(controller.signal);
      for await (const value of stream) onValue(value);
    } catch {
      // Stream aborted or terminal gone — expected on cleanup
    }
  })();
  return () => controller.abort();
}

export function useTerminalStreams(deps: {
  onExit: (id: TerminalId, code: number) => void;
}) {
  /** Subscribe to exit events for a terminal. */
  function subscribeExit(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onExit({ id }, { signal }),
      (code) => deps.onExit(id, code),
    );
  }

  return { subscribeExit };
}
