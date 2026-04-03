/** Terminal metadata — derived from unified state stream + per-terminal activity queries.
 *
 *  Metadata (CWD, git, PR, claude) comes from the terminals array in state.get.
 *  Activity (high-frequency busy/idle transitions) stays as per-terminal streamed queries
 *  since it's not state — it's a continuous event stream for sparkline rendering.
 *
 *  Order is derived from metadata sortOrder — no separate ordering state. */

import { type Accessor, createMemo } from "solid-js";
import { createQueries } from "@tanstack/solid-query";
import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
  ActivitySample,
} from "kolu-common";
import { ACTIVITY_WINDOW_MS } from "kolu-common/config";
import { orpc } from "./orpc";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";

/** Max samples retained in TanStack cache per terminal.
 *  At ~20 samples/min during active use, 200 covers ~10 min — well beyond
 *  the 5-min display window. Prevents unbounded growth in long sessions. */
const MAX_ACTIVITY_CHUNKS = 200;

export function useTerminalMetadata(deps: {
  terminals: Accessor<TerminalInfo[] | undefined>;
  activeId: Accessor<TerminalId | null>;
}) {
  /** Terminal IDs derived from the live terminal list. */
  const terminalIdList = createMemo(
    () => deps.terminals()?.map((t) => t.id) ?? [],
  );

  // --- Metadata from unified state (no per-terminal queries needed) ---

  /** Build a lookup map from terminals array for O(1) access. */
  const metadataMap = createMemo(() => {
    const map = new Map<TerminalId, TerminalMetadata>();
    for (const t of deps.terminals() ?? []) {
      map.set(t.id, t.meta);
    }
    return map;
  });

  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    return metadataMap().get(id);
  }

  // --- Activity (high-frequency) — events accumulate for sparkline ---

  const activityQueries = createQueries(() => ({
    queries: terminalIdList().map((id) =>
      orpc.terminal.onActivityChange.experimental_streamedOptions({
        input: { id },
        queryFnOptions: {
          maxChunks: MAX_ACTIVITY_CHUNKS,
          // On reconnect, server yields fresh history — discard stale client cache
          refetchMode: "reset" as const,
        },
        // Trim to display window on read. The source array may hold samples
        // slightly older than the window (up to maxChunks), but consumers
        // only see the 5-min slice. This runs on every access — cheap for
        // small arrays (~50-200 items).
        select: (samples: ActivitySample[]) => {
          const cutoff = Date.now() - ACTIVITY_WINDOW_MS;
          return samples.filter(([t]) => t >= cutoff);
        },
      }),
    ),
  }));

  function getActivityHistory(id: TerminalId): ActivitySample[] {
    const idx = terminalIdList().indexOf(id);
    return idx >= 0 ? (activityQueries[idx]?.data ?? []) : [];
  }

  // --- Order derived from metadata sortOrder ---

  const bySortOrder = (a: TerminalId, b: TerminalId) =>
    (getMetadata(a)?.sortOrder ?? 0) - (getMetadata(b)?.sortOrder ?? 0);

  /** Top-level terminal IDs sorted by sortOrder. */
  const terminalIds = createMemo(() =>
    terminalIdList()
      .filter((id) => {
        const m = getMetadata(id);
        return m && !m.parentId;
      })
      .sort(bySortOrder),
  );

  /** Sub-terminal IDs for a parent, sorted by sortOrder. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return terminalIdList()
      .filter((id) => getMetadata(id)?.parentId === parentId)
      .sort(bySortOrder);
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
    getActivityHistory,
    terminalIds,
    getSubTerminalIds,
    activeMeta,
    getDisplayInfo,
    terminalLabel,
  };
}
