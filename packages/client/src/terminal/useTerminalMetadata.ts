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

import {
  type AuthoredTerminal,
  composeTerminalMetadata,
  type TerminalId,
  type TerminalInfo,
  type TerminalMetadata,
} from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { toast } from "solid-sonner";
import { app, workspace } from "../wire";
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
  // Design-S: a terminal's record is a JOIN of two halves served on two
  // collections — the kolu-owned AUTHORED record (`kolu.authored`: location +
  // client chrome + the active|sleeping discriminant) and the GENERIC AWARENESS
  // value (`terminalWorkspace.snapshots`: the eight sensor fields). Both subscribe
  // to the SAME key set (the live terminal list); `getMetadata` recomposes them at
  // read time via `composeTerminalMetadata` — the ONE join, shared with disk
  // persist (`snapshotSession`). There is no server-side re-fusion: the bisection
  // reaches HERE, the consumer. R9 (remote snapshots) swaps the snapshots backing
  // remote-side behind `terminalWorkspace.snapshots` with no change at this seam.
  // Memoized so the id array is computed once per list change, not re-mapped on
  // every `.use({ keys })` read, every `terminalIds` recompute, and every
  // `getSubTerminalIds` call (the last runs O(terminals) times per display
  // rebuild).
  const keys = createMemo<TerminalId[]>(
    () => deps.list()?.map((t) => t.id) ?? [],
  );
  const authored = app.collections.authored.use({
    keys,
    onError: (err) => toast.error(`Metadata error: ${err.message}`),
  });
  const snapshots = workspace.collections.snapshots.use({
    keys,
    onError: (err) => toast.error(`Awareness error: ${err.message}`),
  });

  /** Recompose a terminal's wire shape from its two halves — `undefined` until
   *  BOTH the authored record and the snapshots value have arrived (the join
   *  can't be materialized from one half alone). The two `byKey` reads are
   *  reactive, so this re-runs as either half updates. The result is a fresh
   *  object per call (no cached reference): every one of the ~20 consumers reads
   *  it field-wise inside its own tracking scope — none compares it by identity —
   *  so identity-freshness is sound, and per-key reactivity stays granular (a
   *  change to one terminal's half notifies only readers of that terminal). */
  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    const a = authored.byKey(id)?.();
    const w = snapshots.byKey(id)?.();
    return a && w ? composeTerminalMetadata(a, w) : undefined;
  }

  /** A terminal's AUTHORED record once BOTH halves have arrived — the cheap read
   *  the ordering filters below need. `parentId` lives only on `authored`, so the
   *  joined record's value always equals `authored.parentId`; reading it here
   *  (rather than `getMetadata`) skips the full join — no spread on the active
   *  arm, no zod parse on the sleeping arm — on the per-tick reactivity keystone.
   *  Gated on snapshots presence too (same `a && w` gate as `getMetadata`), so a
   *  still-loading terminal is excluded from the order exactly as before. */
  function authoredIfReady(id: TerminalId): AuthoredTerminal | undefined {
    const a = authored.byKey(id)?.();
    const w = snapshots.byKey(id)?.();
    return a && w ? a : undefined;
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
      keys().filter((id) => {
        const a = authoredIfReady(id);
        return a && !a.parentId;
      }),
    [],
    { equals: sameTerminalIdOrder },
  );

  /** Sub-terminal IDs for a parent, in server-provided order. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return keys().filter((id) => authoredIfReady(id)?.parentId === parentId);
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
