/** Terminal metadata — TanStack live queries for server-derived state.
 *  One metadata stream per terminal (slow-changing: CWD, git, PR, claude).
 *  Activity (busy/idle transitions) is accumulated from a separate stream
 *  into a local store — TanStack live queries replace data per event,
 *  but activity needs to accumulate a time-series for sparkline rendering.
 *  Order is derived from metadata sortOrder — no separate ordering state. */

import { type Accessor, createEffect, on, createMemo } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { createQueries } from "@tanstack/solid-query";
import type { TerminalId, TerminalMetadata, ActivitySample } from "kolu-common";
import { ACTIVITY_WINDOW_MS } from "kolu-common/config";
import { client } from "./rpc";
import { orpc } from "./orpc";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";

export function useTerminalMetadata(deps: {
  knownIds: Accessor<TerminalId[]>;
  activeId: Accessor<TerminalId | null>;
}) {
  // --- Metadata (slow-changing) via TanStack live queries ---

  const metadataQueries = createQueries(() => ({
    queries: deps.knownIds().map((id) =>
      orpc.terminal.onMetadataChange.experimental_liveOptions({
        input: { id },
      }),
    ),
  }));

  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    const idx = deps.knownIds().indexOf(id);
    return idx >= 0 ? metadataQueries[idx]?.data : undefined;
  }

  // --- Activity (high-frequency) via direct stream into local store ---

  const [activityStore, setActivityStore] = createStore<
    Record<TerminalId, ActivitySample[]>
  >({});

  /** Active stream subscriptions — cleanup when terminal is removed. */
  const abortControllers = new Map<TerminalId, AbortController>();

  /** Subscribe to activity stream for a terminal. Accumulates samples in store. */
  function subscribeActivity(id: TerminalId) {
    const ac = new AbortController();
    abortControllers.set(id, ac);
    (async () => {
      try {
        const stream = await client.terminal.onActivityChange({ id });
        for await (const sample of stream) {
          if (ac.signal.aborted) break;
          setActivityStore(id, (prev) => {
            const cutoff = Date.now() - ACTIVITY_WINDOW_MS;
            const trimmed = (prev ?? []).filter(([t]) => t >= cutoff);
            return [...trimmed, sample];
          });
        }
      } catch {
        // Stream aborted or terminal gone — expected on cleanup
      }
    })();
  }

  function unsubscribeActivity(id: TerminalId) {
    abortControllers.get(id)?.abort();
    abortControllers.delete(id);
    setActivityStore(produce((s) => delete s[id]));
  }

  // Manage activity subscriptions when knownIds change
  createEffect(
    on(deps.knownIds, (ids, prevIds) => {
      const prev = new Set(prevIds ?? []);
      const curr = new Set(ids);
      for (const id of ids) {
        if (!prev.has(id)) subscribeActivity(id);
      }
      for (const id of prevIds ?? []) {
        if (!curr.has(id)) unsubscribeActivity(id);
      }
    }),
  );

  function getActivityHistory(id: TerminalId): ActivitySample[] {
    return activityStore[id] ?? [];
  }

  /** Is the terminal currently producing output? Derived from last activity sample. */
  function isBusy(id: TerminalId): boolean {
    const samples = activityStore[id];
    if (!samples || samples.length === 0) return false;
    return samples[samples.length - 1]![1];
  }

  // --- Order derived from metadata sortOrder ---

  /** Top-level terminal IDs sorted by sortOrder.
   *  Terminals whose metadata hasn't arrived yet are excluded (still loading). */
  const terminalIds = createMemo(() =>
    deps.knownIds()
      .filter((id) => { const m = getMetadata(id); return m && !m.parentId; })
      .sort((a, b) => (getMetadata(a)?.sortOrder ?? 0) - (getMetadata(b)?.sortOrder ?? 0)),
  );

  /** Sub-terminal IDs for a parent, sorted by sortOrder. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return deps.knownIds()
      .filter((id) => getMetadata(id)?.parentId === parentId)
      .sort((a, b) => (getMetadata(a)?.sortOrder ?? 0) - (getMetadata(b)?.sortOrder ?? 0));
  }

  // --- Derived accessors ---

  const activeMeta = createMemo((): TerminalMetadata | null => {
    const id = deps.activeId();
    return id !== null ? (getMetadata(id) ?? null) : null;
  });

  const displayInfos = createMemo(() =>
    buildTerminalDisplayInfos(
      terminalIds(),
      getMetadata,
      isBusy,
      getActivityHistory,
      getSubTerminalIds,
    ),
  );

  function getDisplayInfo(id: TerminalId): TerminalDisplayInfo | undefined {
    return displayInfos().get(id);
  }

  /** Human-readable label for a terminal by its sidebar position. */
  function terminalLabel(id: TerminalId): string {
    const pos = terminalIds().indexOf(id) + 1;
    return pos > 0 ? `Terminal ${pos}` : "Terminal";
  }

  return {
    getMetadata,
    isBusy,
    getActivityHistory,
    terminalIds,
    getSubTerminalIds,
    activeMeta,
    getDisplayInfo,
    terminalLabel,
  };
}
