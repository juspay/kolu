/** Terminal metadata — subscriptions for server-derived state.
 *
 *  One subscription per terminal: metadata (slow-changing state — CWD,
 *  git, PR, agent status). Each event replaces the previous; only
 *  current state matters.
 *
 *  Terminal IDs are derived from the live list subscription data. Order
 *  is the server's Map insertion order (terminal creation order) — no
 *  client-side sort, no per-terminal ordering field.
 *
 *  Per-terminal subscriptions use mapArray for lifecycle — SolidJS creates
 *  a reactive owner per item and disposes it when the item leaves the list.
 *  No manual Map, AbortController, or version signals needed. */

import { type Accessor, createMemo, mapArray } from "solid-js";
import { toast } from "solid-sonner";
import {
  createSubscription,
  type Subscription,
} from "../rpc/createSubscription";
import { stream } from "../rpc/rpc";
import type { TerminalId, TerminalInfo, TerminalMetadata } from "kolu-common";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";

/** Subscriptions created per terminal via mapArray — disposed when the terminal leaves the list. */
interface PerTerminalSubs {
  id: TerminalId;
  meta: Subscription<TerminalMetadata>;
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
    const meta = createSubscription(() => stream.metadata(id), {
      onError: (err) => toast.error(`Metadata error: ${err.message}`),
    });
    return { id, meta };
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

  // --- Order: server Map insertion order, filtered by parent relationship ---

  /** Top-level terminal IDs in server-provided order.
   *  Terminals whose metadata hasn't arrived yet are excluded (still loading). */
  const terminalIds = createMemo(() =>
    terminalIdList().filter((id) => {
      const m = getMetadata(id);
      return m && !m.parentId;
    }),
  );

  /** Sub-terminal IDs for a parent, in server-provided order. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return terminalIdList().filter(
      (id) => getMetadata(id)?.parentId === parentId,
    );
  }

  // --- Derived accessors ---

  const activeMeta = createMemo((): TerminalMetadata | null => {
    const id = deps.activeId();
    return id !== null ? (getMetadata(id) ?? null) : null;
  });

  const displayInfos = createMemo(() =>
    buildTerminalDisplayInfos(terminalIds(), getMetadata, getSubTerminalIds),
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
    terminalIds,
    getSubTerminalIds,
    activeMeta,
    getDisplayInfo,
    terminalLabel,
  };
}
