/** Sleep / Wake / Discard — the on-demand twin of session restore.
 *
 *  Singleton (createSharedRoot) so every trigger (tile ☾ button, dock Wake row,
 *  command palette) reaches the same handlers. Holds no state of its own — the
 *  optimistic "mid-wake" hide lives in the `wakingTiles` leaf so the registry
 *  can read it without importing this crud-bearing module (that would re-close
 *  the cycle Phase 1 broke).
 *
 *  - **Sleep** = persist the tree (server `terminal.sleep`, which reads live
 *    metadata) THEN tear down the live terminal via `handleKillWithSubs`.
 *    Persist-before-kill: a crash between the two loses nothing, and an explicit
 *    kill fires no `terminalExit` so there's no spurious "exited" toast.
 *  - **Wake** = replay the record through the EXISTING `handleRestoreSession`
 *    (the session-restore respawn — create tree, seed panels, resume the agent),
 *    then drop the record (server `terminal.dropSleeping`). Reusing restore verbatim is
 *    why a woken terminal is indistinguishable from a session-restored one; the
 *    record re-mints fresh terminal ids, so `wakingTiles` hides the still-present
 *    dormant tile until the record is dropped, avoiding a beat of overlap.
 *  - **Discard** = drop the record without respawning (the tile's × button). */

import type { SavedSession, SleepingTerminal } from "kolu-common/surface";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import type { TileId } from "../tile/tileContent";
import { useTileStore } from "../tile/useTileStore";
import { useWakingTiles } from "../tile/wakingTiles";
import { client } from "../wire";
import { useSessionRestore } from "./useSessionRestore";
import { PartialKillError, useTerminalCrud } from "./useTerminalCrud";
import { useTerminalStore } from "./useTerminalStore";

export const useSleepActions = createSharedRoot(() => {
  const crud = useTerminalCrud();
  const store = useTerminalStore();
  const tileStore = useTileStore();
  const sessionRestore = useSessionRestore();
  const wakingTiles = useWakingTiles();

  /** Put a terminal (and its splits) to sleep. */
  async function sleep(id: TileId): Promise<void> {
    const toastId = toast.loading("Putting terminal to sleep…");
    const wasActive = store.activeId() === id;
    try {
      // Persist first (the server reads live metadata), then tear down.
      await client.terminal.sleep({ id });
      // Strict kill: a real teardown failure here would otherwise be swallowed,
      // leaving the PTY/agent live while the record (written just above) claims
      // the tile is asleep. (A NOT_FOUND — the terminal was already gone —
      // counts as success and does not throw.)
      try {
        await crud.handleKillWithSubsStrict(id);
      } catch (killErr) {
        // Roll back the just-written record ONLY when nothing was destroyed —
        // a plain failure means the FIRST kill failed, so the tree is intact
        // and live; dropping the record leaves the user an accurate live tile.
        // A `PartialKillError` means an earlier kill already tore part of the
        // tree down, so this record is the ONLY durable copy of those killed
        // pieces — KEEP it (the user can wake it back) and surface the
        // incomplete sleep loudly rather than silently deleting recovery state.
        if (killErr instanceof PartialKillError) throw killErr;
        // Surface a rollback failure too: a still-present record is benign
        // (live suppresses the sleeping id in `useTileStore`), but the user
        // should know cleanup didn't fully land rather than have it swallowed.
        try {
          await client.terminal.dropSleeping({ id });
        } catch (dropErr) {
          toast.error(
            `Couldn't undo the sleep snapshot: ${(dropErr as Error).message}`,
          );
        }
        throw killErr;
      }
      // The live kill routes through `removeAndAutoSwitch`, which (for the
      // active tile) switches focus AWAY to another live terminal. But the slept
      // tile keeps its id and becomes a SLEEPING tile in `tileIds()` — sleeping
      // is a content change, not a tile removal, so focus should stay on it
      // (now showing the dormant body + Wake), not jump to a sibling. Re-assert
      // it as active. Re-assert UNCONDITIONALLY on `wasActive` rather than
      // gating on `contentOf(id)` resolving to the sleeping arm: the live-list
      // and sleeping-cell subscription pushes are async, so right after the
      // kill `contentOf` may still report `terminal` (or briefly `undefined`)
      // even though the id is — and will remain — a valid tile. The id round-
      // trips through sleep, so `setActiveSilently(id)` (no canvas pan; the tile
      // hasn't moved) is always correct. Guarding on `wasActive` keeps sleeping
      // a background tile from stealing focus from what the user is looking at.
      if (wasActive) {
        store.setActiveSilently(id);
      }
      toast.success("Terminal asleep — wake it from the dock", { id: toastId });
    } catch (err) {
      toast.error(`Failed to sleep terminal: ${(err as Error).message}`, {
        id: toastId,
      });
    }
  }

  /** Wake a sleeping record: respawn its tree through the restore path, then
   *  drop the record. */
  async function wake(record: SleepingTerminal): Promise<void> {
    const session: SavedSession = {
      terminals: record.terminals,
      // Focus the woken tree's top terminal (its original id), so the restore
      // active-terminal protocol re-centers the canvas on it.
      activeTerminalId: record.id,
      savedAt: record.sleptAt,
    };
    wakingTiles.mark(record.id);
    try {
      await sessionRestore.handleRestoreSession({
        session,
        label: {
          loading: "Waking terminal…",
          success: (resumed) =>
            resumed > 0 ? "Terminal woken — agent resumed" : "Terminal woken",
        },
      });
    } catch (err) {
      // Restore failed (a respawn error, or — the data-loss case — a concurrent
      // restore already in flight, which throws BEFORE creating any terminal).
      // Either way no fresh tree exists, so we MUST NOT fall through to
      // `dropSleeping`: that would delete the durable record with nothing to
      // show for it. Reveal the still-dormant tile so nothing is lost. The mid-
      // restore failure surfaces its own toast; the pre-flight busy throw does
      // not, so surface that here rather than swallow it.
      wakingTiles.unmark(record.id);
      if ((err as Error).message === "restore already in progress") {
        toast.error("Another wake/restore is in progress — try again");
      }
      return;
    }
    // Respawn succeeded — drop the now-redundant record. The woken tree is
    // already live (under fresh ids), so a failure here only risks the stale
    // record resurfacing; surface it rather than swallow it.
    try {
      await client.terminal.dropSleeping({ id: record.id });
    } catch (err) {
      toast.error(
        `Woke terminal, but failed to clear its sleeping record: ${(err as Error).message}`,
      );
    } finally {
      wakingTiles.unmark(record.id);
    }
  }

  /** Drop a sleeping record without respawning it (the tile's × button). */
  async function discard(record: SleepingTerminal): Promise<void> {
    // Snapshot the tile order BEFORE the drop so we can pick the neighbour that
    // inherits focus, mirroring the live-kill `removeAndAutoSwitch` policy.
    const wasActive = store.activeId() === record.id;
    const idsBefore = tileStore.tileIds();
    const removedIdx = idsBefore.indexOf(record.id as TileId);
    try {
      await client.terminal.dropSleeping({ id: record.id });
      // Discarding a sleeping tile REMOVES it from `tileIds()`. If it was the
      // active tile, `activeId` would otherwise dangle at a tile that no longer
      // exists — in maximized posture every remaining tile then reads `covered`
      // (nothing matches the active id) and any active-tile command targets a
      // dead id. Re-point active at the neighbour the removed tile sat next to
      // (clamped), or null when nothing remains — the same auto-switch the live
      // kill path applies. `setActiveSilently`: the tile is gone, there is
      // nothing to pan to.
      if (wasActive) {
        const remaining = idsBefore.filter((id) => id !== record.id);
        const next =
          removedIdx === -1
            ? (remaining[0] ?? null)
            : (remaining[Math.min(removedIdx, remaining.length - 1)] ?? null);
        store.setActiveSilently(next);
      }
      toast("Sleeping terminal discarded");
    } catch (err) {
      toast.error(`Failed to discard: ${(err as Error).message}`);
    }
  }

  return { sleep, wake, discard };
});
