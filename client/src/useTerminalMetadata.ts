/** Terminal metadata — subscriptions for server-derived state.
 *
 *  Two subscription types per terminal:
 *  - Metadata: slow-changing state (CWD, git, PR, claude).
 *    Each event replaces the previous — only current state matters.
 *  - Activity: high-frequency busy/idle transitions.
 *    Events accumulate into an array for sparkline rendering. Server yields
 *    a history snapshot on connect, then individual [epochMs, boolean] samples.
 *
 *  Terminal IDs are derived from the live list subscription data.
 *  Order is derived from metadata sortOrder — no separate ordering state. */

import { type Accessor, createMemo, createEffect, onCleanup } from "solid-js";
import { createSubscription, type Subscription } from "solid-live/solid";
import { client } from "./rpc";
import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
  ActivitySample,
} from "kolu-common";
import { ACTIVITY_WINDOW_MS } from "kolu-common/config";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";

/** Max samples retained per terminal.
 *  At ~20 samples/min during active use, 200 covers ~10 min — well beyond
 *  the 5-min display window. Prevents unbounded growth in long sessions. */
const MAX_ACTIVITY_CHUNKS = 200;

export function useTerminalMetadata(deps: {
  listSub: Subscription<TerminalInfo[]>;
  activeId: Accessor<TerminalId | null>;
}) {
  /** Terminal IDs derived from the live list subscription. */
  const terminalIdList = createMemo(
    () => deps.listSub()?.map((t) => t.id) ?? [],
  );

  // --- Dynamic per-terminal subscriptions ---
  // Managed imperatively via AbortController + signal option on createSubscription.
  // createEffect tracks terminalIdList() — creates new subs, tears down removed ones.

  const metaSubs = new Map<
    TerminalId,
    { sub: Subscription<TerminalMetadata>; abort: AbortController }
  >();
  const activitySubs = new Map<
    TerminalId,
    { sub: Subscription<ActivitySample[]>; abort: AbortController }
  >();

  createEffect(() => {
    const current = new Set(terminalIdList());

    // Teardown removed terminals
    for (const [id, entry] of metaSubs) {
      if (!current.has(id)) {
        entry.abort.abort();
        metaSubs.delete(id);
      }
    }
    for (const [id, entry] of activitySubs) {
      if (!current.has(id)) {
        entry.abort.abort();
        activitySubs.delete(id);
      }
    }

    // Create subscriptions for new terminals
    for (const id of current) {
      if (!metaSubs.has(id)) {
        const abort = new AbortController();
        const sub = createSubscription(
          () => client.terminal.onMetadataChange({ id }),
          { signal: abort.signal },
        );
        metaSubs.set(id, { sub, abort });
      }
      if (!activitySubs.has(id)) {
        const abort = new AbortController();
        const sub = createSubscription(
          () => client.terminal.onActivityChange({ id }),
          {
            reduce: (acc: ActivitySample[], sample: ActivitySample) => {
              const cutoff = Date.now() - ACTIVITY_WINDOW_MS;
              return [...acc.filter(([t]) => t >= cutoff), sample].slice(
                -MAX_ACTIVITY_CHUNKS,
              );
            },
            initial: [] as ActivitySample[],
            signal: abort.signal,
          },
        );
        activitySubs.set(id, { sub, abort });
      }
    }
  });

  // Cleanup all subscriptions when the parent owner is disposed
  onCleanup(() => {
    for (const entry of metaSubs.values()) entry.abort.abort();
    for (const entry of activitySubs.values()) entry.abort.abort();
    metaSubs.clear();
    activitySubs.clear();
  });

  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    return metaSubs.get(id)?.sub();
  }

  function getActivityHistory(id: TerminalId): ActivitySample[] {
    return activitySubs.get(id)?.sub() ?? [];
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
