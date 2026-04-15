/** Terminal metadata — subscriptions for server-derived state.
 *
 *  Two subscription types per terminal:
 *  - Metadata: slow-changing state (CWD, git, PR, agent status).
 *    Each event replaces the previous — only current state matters.
 *  - Activity: high-frequency busy/idle transitions.
 *    Events accumulate into an array for sparkline rendering. Server yields
 *    a history snapshot on connect, then individual [epochMs, boolean] samples.
 *
 *  Terminal IDs are derived from the live list subscription data.
 *  Order is derived from metadata sortOrder — no separate ordering state.
 *
 *  Per-terminal subscriptions use mapArray for lifecycle — SolidJS creates
 *  a reactive owner per item and disposes it when the item leaves the list.
 *  No manual Map, AbortController, or version signals needed. */

import { type Accessor, createMemo, mapArray } from "solid-js";
import { toast } from "solid-sonner";
import { match } from "ts-pattern";
import {
  createSubscription,
  onSubscriptionError,
  type Subscription,
} from "../rpc/createSubscription";
import { stream } from "../rpc/rpc";
import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
  ActivitySample,
  ActivityStreamEvent,
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

/** Subscriptions created per terminal via mapArray — disposed when the terminal leaves the list. */
interface PerTerminalSubs {
  id: TerminalId;
  meta: Subscription<TerminalMetadata>;
  activity: Subscription<ActivitySample[]>;
}

export function useTerminalMetadata(deps: {
  listSub: Subscription<TerminalInfo[]>;
  activeId: Accessor<TerminalId | null>;
}) {
  /** Terminal IDs derived from the live list subscription. */
  const terminalIdList = createMemo(
    () => deps.listSub()?.map((t) => t.id) ?? [],
  );

  // mapArray creates a reactive owner per terminal ID.
  // When an ID leaves the list, its owner is disposed → onCleanup fires →
  // AbortController aborts → subscription streams close. No manual teardown.
  const perTerminal = mapArray(terminalIdList, (id): PerTerminalSubs => {
    const meta = createSubscription(() => stream.metadata(id));
    // Snapshot replaces, delta appends — every re-subscribe begins with
    // a fresh snapshot, so reconnect-safety is structural (no dedupe).
    const activity = createSubscription<ActivityStreamEvent, ActivitySample[]>(
      () => stream.activity(id),
      {
        reduce: (acc, event) => {
          const cutoff = Date.now() - ACTIVITY_WINDOW_MS;
          return match(event)
            .with({ kind: "snapshot" }, ({ samples }) =>
              samples.filter(([t]) => t >= cutoff).slice(-MAX_ACTIVITY_CHUNKS),
            )
            .with({ kind: "delta" }, ({ sample }) =>
              [...acc.filter(([t]) => t >= cutoff), sample].slice(
                -MAX_ACTIVITY_CHUNKS,
              ),
            )
            .exhaustive();
        },
        initial: [] as ActivitySample[],
      },
    );
    // Surface subscription errors — mapArray memoizes by key, so these
    // are created once per terminal ID and disposed when it leaves.
    onSubscriptionError(meta, (err) =>
      toast.error(`Metadata error: ${err.message}`),
    );
    onSubscriptionError(activity, (err) =>
      toast.error(`Activity error: ${err.message}`),
    );
    return { id, meta, activity };
  });

  function findSub(id: TerminalId): PerTerminalSubs | undefined {
    return perTerminal().find((s) => s.id === id);
  }

  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    // Prefer live subscription value; fall back to list-embedded metadata
    // so terminals appear in the sidebar immediately (before metadata sub connects).
    return (
      findSub(id)?.meta() ?? deps.listSub()?.find((t) => t.id === id)?.meta
    );
  }

  function getActivityHistory(id: TerminalId): ActivitySample[] {
    return findSub(id)?.activity() ?? [];
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
