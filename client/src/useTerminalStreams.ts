/** Terminal streams — server event subscriptions for metadata, activity, and exit.
 *  Streams write to the store. Alert detection is handled reactively elsewhere. */

import type { TerminalId } from "kolu-common";
import { client } from "./rpc";
import type { SetTerminalMeta } from "./useTerminalStore";

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
  setMeta: SetTerminalMeta;
  pushActivity: (id: TerminalId, active: boolean) => void;
  onExit: (id: TerminalId, code: number) => void;
}) {
  /** Subscribe to metadata changes for a terminal. */
  function subscribeMetadata(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onMetadataChange({ id }, { signal }),
      (metadata) => deps.setMeta(id, "meta", metadata),
    );
  }

  /** Subscribe to activity state changes for a terminal. */
  function subscribeActivity(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onActivityChange({ id }, { signal }),
      (isActive) => {
        deps.setMeta(id, "isActive", isActive);
        deps.pushActivity(id, isActive);
      },
    );
  }

  /** Subscribe to exit events for a terminal. */
  function subscribeExit(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onExit({ id }, { signal }),
      (code) => deps.onExit(id, code),
    );
  }

  /** Start all per-terminal stream subscriptions (metadata, activity, exit). */
  function subscribeAll(id: TerminalId) {
    subscribeMetadata(id);
    subscribeActivity(id);
    subscribeExit(id);
  }

  return { subscribeAll };
}
