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
import { padi } from "../wire";
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
  // W1.R1: a terminal's record is served ALREADY COMPOSED. padi's `terminals`
  // collection folds the two halves that share the one registry entry — the
  // AUTHORED record (location + client chrome + the active|sleeping discriminant)
  // and the GENERIC AWARENESS value (the sensor fields) — server-side via
  // `composeTerminalMetadata` (the ONE join, shared with disk persist
  // `snapshotSession`). The client's former reader-join collapsed to this single
  // read; there is no client-side re-fusion. R9 (remote snapshots) swaps the
  // snapshot backing remote-side behind the server compose with no change here.
  // Memoized so the id array is computed once per list change, not re-mapped on
  // every `.use({ keys })` read, every `terminalIds` recompute, and every
  // `getSubTerminalIds` call (the last runs O(terminals) times per display
  // rebuild).
  const keys = createMemo<TerminalId[]>(
    () => deps.list()?.map((t) => t.id) ?? [],
  );
  const terminals = padi.collections.terminals.use({
    keys,
    onError: (err) => toast.error(`Metadata error: ${err.message}`),
  });

  // padi's `terminals` collection is typed `PadiTerminal` — a SUPERSET of
  // `TerminalMetadata`: it adds the reserved cross-host `host` axis (never
  // populated on a single-host canvas) and a reserved `parked` arm (produced only
  // from W1.R6's boot reconcile). At R1 the server composes and serves ONLY the
  // `active|sleeping` arms with `host` absent, so the served value IS a valid
  // `TerminalMetadata` for every one of the ~20 downstream consumers. This is the
  // ONE type bridge where the padi wire shape meets the client's domain type;
  // narrow it here so the consumers stay unchanged.
  const readComposed = (id: TerminalId): TerminalMetadata | undefined =>
    terminals.byKey(id)?.() as TerminalMetadata | undefined;

  /** A terminal's composed wire shape — `undefined` until the server-composed
   *  record has arrived. The `byKey` read is reactive, so this re-runs as the
   *  record updates. The stored reference is read field-wise by every one of the
   *  ~20 consumers inside its own tracking scope — none compares it by identity —
   *  so per-key reactivity stays granular (a change to one terminal notifies only
   *  readers of that terminal). */
  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    return readComposed(id);
  }

  /** A terminal's composed record once it has arrived — the read the ordering
   *  filters below need for `parentId`. The server serves the join already
   *  materialized, so this is the same single read as `getMetadata`; presence
   *  (record arrived) is the gate that excludes a still-loading terminal from the
   *  order, exactly as the two-half `a && w` gate did before. */
  function authoredIfReady(id: TerminalId): TerminalMetadata | undefined {
    return readComposed(id);
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
