/** Terminal streams — server event subscriptions for metadata, activity, and exit.
 *
 * Per-terminal streams are started imperatively (outside component lifecycle),
 * so they use direct oRPC client calls rather than TanStack Query.
 */

import { client } from "./rpc";
import type { TerminalId } from "kolu-common";
import type { TerminalMetaStore, SetTerminalMeta } from "./useTerminalStore";

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
  meta: TerminalMetaStore;
  setMeta: SetTerminalMeta;
  pushActivity: (id: TerminalId, active: boolean) => void;
  onExit: (id: TerminalId, code: number) => void;
  onClaudeStateChange: (
    id: TerminalId,
    prev: string | undefined,
    next: string | undefined,
  ) => void;
}) {
  /** Subscribe to metadata changes for a terminal. */
  function subscribeMetadata(id: TerminalId) {
    return subscribeStream(
      (signal) => client.terminal.onMetadataChange({ id }, { signal }),
      (metadata) => {
        const prevState = deps.meta[id]?.meta?.claude?.state;
        deps.setMeta(id, "meta", metadata);
        deps.onClaudeStateChange(id, prevState, metadata.claude?.state);
      },
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
