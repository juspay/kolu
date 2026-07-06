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
  PadiParkedTerminal,
  PadiTerminal,
  TerminalMetadata,
} from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { bindingScoped, subErrorToast } from "../binding/bindings";
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

/** Whether a composed record is a PARKED restore-pending record (W1.R6) — a
 *  genuine type-guard over padi's honest 3-arm `PadiTerminal` union, not a widened
 *  cast. padi's boot reconcile parks each reboot-killed active terminal so
 *  `session.restore` can re-spawn it; a parked record rides the `terminals`
 *  collection but must NOT render as a canvas tile — it is a restore-card row, not
 *  a live/dormant tile. Excluding it here keeps the canvas EMPTY while a reboot's
 *  session awaits restore, so the restore card shows (byte-identical to the pre-R6
 *  registry-empty restore-pending state).
 *
 *  Reads the `state` discriminant directly on the wire type (`PadiTerminal` =
 *  `active | sleeping | parked`), so the narrowing is SOUND — no `(m as { state })`
 *  cast. `getMetadata` below is its ONE caller: it narrows padi's 3-arm wire union
 *  down to the honest 2-arm `TerminalMetadata` every tile consumer expects,
 *  collapsing a parked record to `undefined`. */
export function isParked(m: PadiTerminal): m is PadiParkedTerminal {
  return m.state === "parked";
}

export function useTerminalMetadata(deps: {
  list: Accessor<{ id: TerminalId }[] | undefined>;
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
  // W4 "the switch": the metadata collection must follow the ACTIVE host, not pin
  // the boot host's client. Reading the `padi` proxy directly
  // (`padi.collections.terminals.use(...)`) resolves it ONCE at call time, so after a
  // switch the collection keeps querying the OLD (now-retired) host's client even as
  // the re-keyed `keys` — derived from `terminalListSub`, itself `bindingScoped` —
  // start naming the NEW host's terminals, rendering missing/wrong tile metadata.
  // `bindingScoped` re-creates the collection against the active binding on every
  // switch (disposing the prior one), so keys and records always come from ONE host.
  // Runs under `useTerminalStore`'s `createSharedRoot` owner, which `bindingScoped`
  // requires.
  const terminals = bindingScoped((b) =>
    b.clients.padi.collections.terminals.use({
      keys,
      onError: subErrorToast("Metadata error"),
    }),
  );

  // padi's `terminals` collection is typed `PadiTerminal` — a 3-arm union:
  // `active | sleeping | PARKED`, each carrying the reserved cross-host `host` axis
  // (never populated on a single-host canvas). A PARKED record is a restore-card
  // row, NEVER a tile (W1.R6's boot reconcile produces it), so it is narrowed out
  // HERE — via the sound `isParked` type-guard, NOT a cast — leaving the honest
  // 2-arm `TerminalMetadata` (`active | sleeping`) the ~20 tile consumers expect.
  // This is the ONE type bridge where the padi wire shape meets the client's domain
  // type.
  //
  /** A terminal's composed TILE record — `undefined` until the server-composed
   *  record has arrived, AND `undefined` for a PARKED record (a restore-card row,
   *  not a tile). The `byKey` read is reactive, so this re-runs as the record
   *  updates. The value is read field-wise by every one of the ~20 consumers inside
   *  its own tracking scope — none compares it by identity — so per-key reactivity
   *  stays granular (a change to one terminal notifies only readers of that
   *  terminal). This is ALSO the read the ordering filters below use for
   *  `parentId`: presence (a real tile record arrived) is the gate that excludes a
   *  still-loading OR parked terminal from the order. */
  function getMetadata(id: TerminalId): TerminalMetadata | undefined {
    const record = terminals().byKey(id)?.();
    return record === undefined || isParked(record) ? undefined : record;
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
        // `getMetadata` already returns `undefined` for a parked (or not-yet-
        // arrived) record, so presence alone excludes restore-card rows.
        const a = getMetadata(id);
        return a !== undefined && !a.parentId;
      }),
    [],
    { equals: sameTerminalIdOrder },
  );

  /** Sub-terminal IDs for a parent, in server-provided order. `getMetadata`
   *  excludes parked records (never a live split — they await restore), so a
   *  presence check suffices here too. */
  function getSubTerminalIds(parentId: TerminalId): TerminalId[] {
    return keys().filter((id) => {
      const a = getMetadata(id);
      return a !== undefined && a.parentId === parentId;
    });
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
