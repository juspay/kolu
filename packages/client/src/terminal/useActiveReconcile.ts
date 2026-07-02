/** Active-focus reconcile — the active tile follows the LIST, not an event.
 *
 *  A natural PTY exit removes the terminal from padi's `terminals` collection,
 *  and that same removal disposes the terminal's `terminalExit` subscription (it
 *  is keyed to the live list — see useTerminalExits). So the exit event that
 *  once drove the active-tile auto-switch races its own disposal and is usually
 *  LOST. Deriving the switch from the LIST closes that race for EVERY removal
 *  cause (natural exit, kill, discard): when the active tile leaves the list,
 *  focus falls to a survivor — the SAME survivor `removeAndAutoSwitch` picks
 *  (shared `pickAutoSwitchTarget`), so the imperative close path and this
 *  reconcile can never diverge.
 *
 *  Reacts to `terminalIds` CHANGES only (activeId is read UNTRACKED via `on`):
 *  a fresh create's `setActiveSilently` names a tile a beat before the list
 *  includes it, and session-restore hydration seeds the active tile only after
 *  the full listed metadata has arrived — neither is a list-removal, so neither
 *  trips the reconcile. The raw-keys guard skips the metadata-still-loading
 *  window (id present in the raw keys but not yet in the metadata-filtered
 *  `terminalIds`), so only a GENUINE removal moves focus.
 *
 *  Idempotent with the kill path: `handleKill` -> `removeAndAutoSwitch` switches
 *  `activeId` to a survivor synchronously BEFORE the list updates, so when the
 *  list drop arrives here `activeId` is already a listed survivor and this is a
 *  no-op — no double-switch, no flicker. */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, on } from "solid-js";

/** Pick the tile that inherits focus when the active tile is removed: the
 *  survivor now occupying the removed tile's slot (its old index, clamped to the
 *  new last), or `null` when none remain. `survivors` is the list AFTER the
 *  removal and `removedIndex` is where the removed tile sat in the list before
 *  it went. The ONE home for "which sibling does focus fall to" — shared by the
 *  imperative close path (`removeAndAutoSwitch` in useTerminalCrud) and the
 *  list-driven reconcile below, so both pick the SAME survivor for every removal
 *  cause. A `removedIndex` of `-1` (the removed id was never in the list) yields
 *  `null`, so a still-loading active can never be blanked. */
export function pickAutoSwitchTarget(
  survivors: readonly TerminalId[],
  removedIndex: number,
): TerminalId | null {
  return survivors[Math.min(removedIndex, survivors.length - 1)] ?? null;
}

export function useActiveReconcile(deps: {
  /** Metadata-filtered top-level tile ids, in list order. */
  terminalIds: Accessor<TerminalId[]>;
  /** Raw list keys (all ids, before the metadata filter) — distinguishes a
   *  genuine removal from a record whose metadata simply hasn't arrived yet. */
  rawIds: Accessor<TerminalId[]>;
  /** The active tile id (read untracked inside the effect). */
  activeId: Accessor<TerminalId | null>;
  /** Pan-and-activate a survivor (or `null` when none remain). */
  activate: (id: TerminalId | null) => void;
}) {
  createEffect(
    on(deps.terminalIds, (ids, prevIds) => {
      const active = deps.activeId();
      if (active === null || ids.includes(active)) return;
      // Present in the raw keys but not yet metadata-filtered = still loading,
      // NOT removed — leave focus put until the record arrives.
      if (deps.rawIds().includes(active)) return;
      deps.activate(pickAutoSwitchTarget(ids, (prevIds ?? []).indexOf(active)));
    }),
  );
}
