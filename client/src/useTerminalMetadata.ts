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
import { createQueries, type CreateQueryResult } from "@tanstack/solid-query";
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
  listQuery: CreateQueryResult<TerminalInfo[]>;
  activeId: Accessor<TerminalId | null>;
}) {
  /** Terminal IDs derived from the live list query. */
  const terminalIdList = createMemo(
    () => deps.listQuery.data?.map((t) => t.id) ?? [],
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

  /** Top-level workspace IDs sorted by sortOrder.
   *  Workspaces whose metadata hasn't arrived yet are excluded (still loading). */
  const workspaceIds = createMemo(() =>
    terminalIdList()
      .filter((id) => {
        const m = getMetadata(id);
        return m && !m.parentId;
      })
      .sort(bySortOrder),
  );

  /** Terminal IDs within a workspace, sorted by sortOrder. */
  function getTerminalIds(workspaceId: TerminalId): TerminalId[] {
    return terminalIdList()
      .filter((id) => getMetadata(id)?.parentId === workspaceId)
      .sort(bySortOrder);
  }

  // --- Derived accessors ---

  const activeMeta = createMemo((): TerminalMetadata | null => {
    const id = deps.activeId();
    return id !== null ? (getMetadata(id) ?? null) : null;
  });

  const displayInfos = createMemo(() =>
    buildTerminalDisplayInfos(
      workspaceIds(),
      getMetadata,
      getActivityHistory,
      getTerminalIds,
    ),
  );

  function getDisplayInfo(id: TerminalId): TerminalDisplayInfo | undefined {
    return displayInfos().get(id);
  }

  /** Human-readable label for a workspace by its sidebar position. */
  function workspaceLabel(id: TerminalId): string {
    const pos = workspaceIds().indexOf(id) + 1;
    return pos > 0 ? `Workspace ${pos}` : "Workspace";
  }

  return {
    getMetadata,
    getActivityHistory,
    workspaceIds,
    getTerminalIds,
    activeMeta,
    getDisplayInfo,
    workspaceLabel,
  };
}
