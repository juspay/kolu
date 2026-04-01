/** Terminal metadata — TanStack queries for server-derived state.
 *
 *  Two query types per terminal:
 *  - Metadata (liveOptions): slow-changing state (CWD, git, PR, claude).
 *    Each event replaces the previous — only current state matters.
 *  - Activity (streamedOptions): high-frequency busy/idle transitions.
 *    Events accumulate into an array for sparkline rendering. Server yields
 *    a history snapshot on connect, then individual [epochMs, boolean] samples.
 *    maxChunks caps the source array; select trims to the display window.
 *
 *  Terminal IDs are derived from the live list query data.
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
  /** Terminal IDs derived from the live list query. */
  const terminalIdList = createMemo(
    () => deps.terminals()?.map((t) => t.id) ?? [],
  );

  // --- Metadata (slow-changing) — each event replaces the previous ---

  const metadataQueries = createQueries(() => ({
    queries: terminalIdList().map((id) =>
      orpc.terminal.onMetadataChange.experimental_liveOptions({
        input: { id },
      }),
    ),
  }));

  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    const idx = terminalIdList().indexOf(id);
    return idx >= 0 ? metadataQueries[idx]?.data : undefined;
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

  /** Top-level terminal IDs sorted by sortOrder.
   *  Terminals whose metadata hasn't arrived yet are excluded (still loading). */
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
