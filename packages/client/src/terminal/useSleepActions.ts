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
import { useWakingTiles } from "../tile/wakingTiles";
import { client } from "../wire";
import { useSessionRestore } from "./useSessionRestore";
import { useTerminalCrud } from "./useTerminalCrud";

export const useSleepActions = createSharedRoot(() => {
  const crud = useTerminalCrud();
  const sessionRestore = useSessionRestore();
  const wakingTiles = useWakingTiles();

  /** Put a terminal (and its splits) to sleep. */
  async function sleep(id: TileId): Promise<void> {
    const toastId = toast.loading("Putting terminal to sleep…");
    try {
      // Persist first (the server reads live metadata), then tear down.
      await client.terminal.sleep({ id });
      await crud.handleKillWithSubs(id);
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
    } catch {
      // handleRestoreSession surfaces its own failure toast and leaves the
      // record intact; reveal the still-dormant tile so nothing is lost.
      wakingTiles.unmark(record.id);
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
    try {
      await client.terminal.dropSleeping({ id: record.id });
      toast("Sleeping terminal discarded");
    } catch (err) {
      toast.error(`Failed to discard: ${(err as Error).message}`);
    }
  }

  return { sleep, wake, discard };
});
