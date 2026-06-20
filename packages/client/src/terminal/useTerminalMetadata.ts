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
 *  Per-terminal subscriptions are managed by `useCollection` from
 *  `@kolu/surface/solid` — the framework's `mapArray`-backed lifecycle
 *  creates a reactive owner per terminal ID and disposes it when the
 *  terminal leaves the list. No manual Map, AbortController, or version
 *  signals needed at this call site. */

import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { app } from "../wire";
import {
  buildTerminalDisplayInfos,
  type TerminalDisplayInfo,
} from "./terminalDisplay";

/** Whether two top-level terminal-id lists are identical — the same ids in the
 *  same order. Serves as the `equals` gate on the `terminalIds` memo below: a
 *  metadata change that leaves the *set* of top-level terminals untouched (the
 *  common case — a git / PR / agent field updating on one terminal) keeps the
 *  prior array reference, so `terminalIds()` stops *notifying* downstream when
 *  the set is unchanged. That spares dependants that key off the reference the
 *  spurious recompute non-display writes (PR / agent / foreground) used to
 *  trigger; display-relevant changes (git / cwd / parentId) still re-run
 *  `displayInfos` via its own field-level subscriptions, as they should. This is
 *  the reactivity keystone of the performance map
 *  (`docs/atlas/.../performance.mdx`). Order is significant — it drives sidebar
 *  position labels — so a reorder must invalidate. A bounded-algorithm leaf,
 *  deliberately domain-specific to terminal ids rather than a generic
 *  array-equality receptacle. */
export function sameTerminalIdOrder(
  a: readonly TerminalId[],
  b: readonly TerminalId[],
): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function useTerminalMetadata(deps: {
  list: Accessor<TerminalInfo[] | undefined>;
}) {
  const meta = app.collections.terminalMetadata.use({
    keys: () => deps.list()?.map((t) => t.id) ?? [],
    onError: (err) => toast.error(`Metadata error: ${err.message}`),
  });

  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    return meta.byKey(id)?.();
  }

  // --- Order: server Map insertion order, filtered by parent relationship ---

  /** Top-level terminal IDs in server-provided order.
   *  Terminals whose metadata hasn't arrived yet are excluded (still loading).
   *
   *  The `equals` gate keeps the prior array reference whenever a metadata
   *  change leaves the top-level id set unchanged (the common case), so
   *  dependants keyed off the reference skip the no-op recompute an unchanged
   *  set would otherwise trigger — the reactivity keystone of the performance
   *  map. The accessor re-runs cheaply on each metadata change; what it no
   *  longer does is *notify* downstream when the set is identical. */
  const terminalIds = createMemo<TerminalId[]>(
    () =>
      meta.keys().filter((id) => {
        const m = getMetadata(id);
        return m && !m.parentId;
      }),
    [],
    { equals: sameTerminalIdOrder },
  );

  /** Sub-terminal IDs for a parent, in server-provided order. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return meta.keys().filter((id) => getMetadata(id)?.parentId === parentId);
  }

  /** True if any terminal outside of `excludeId`'s tree is also on
   *  `worktreePath`. Callers use this to decide whether removing the
   *  worktree would yank it out from under a live terminal.
   *
   *  A sub-terminal of a different top-level must also count: its git
   *  metadata is derived from its own CWD and it survives when
   *  `excludeId` dies. */
  function isWorktreeShared(
    worktreePath: string,
    excludeId: TerminalId,
  ): boolean {
    const onWorktree = (id: TerminalId) =>
      getMetadata(id)?.git?.worktreePath === worktreePath;
    return terminalIds().some((otherId) => {
      if (otherId === excludeId) return false;
      return onWorktree(otherId) || getSubTerminalIds(otherId).some(onWorktree);
    });
  }

  // --- Derived accessors ---

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
    isWorktreeShared,
    getDisplayInfo,
    terminalLabel,
  };
}
