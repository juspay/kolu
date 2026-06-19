/** Sleep / Wake orchestration — the on-demand twin of session restore.
 *
 *  Singleton (createSharedRoot) so every trigger (tile button, palette) and
 *  every renderer (canvas, Dock, switcher) reaches the same handlers + records.
 *
 *  - **Sleep** = persist the tree (server `terminal.sleep`, reads live metadata)
 *    THEN tear down the live terminal via the existing `handleKillWithSubs`.
 *    Persist-before-kill: a crash between the two loses nothing. An explicit
 *    kill fires no `terminalExit`, so there's no spurious "exited" toast.
 *  - **Wake** = respawn the record through the SAME primitives session restore
 *    uses (`handleCreate` / `handleCreateSubTerminal` / `seedPanel` /
 *    `resumeAgentCommand`), then drop the record (server `terminal.wake`). The
 *    record carries full `SavedTerminal` fidelity, so a woken terminal is
 *    indistinguishable from a session-restored one. */

import { resumeAgentCommand } from "anyagent/cli";
import type {
  CanvasLayout,
  SleepingTerminal,
  TerminalId,
} from "kolu-common/surface";
import { createMemo, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { useRightPanel } from "../right-panel/useRightPanel";
import { client, sleepingTerminals } from "../wire";
import { useSubPanel } from "./useSubPanel";
import { useTerminalCrud } from "./useTerminalCrud";
import { useTerminalStore } from "./useTerminalStore";

export const useSleepingTerminals = createSharedRoot(() => {
  const store = useTerminalStore();
  const crud = useTerminalCrud();
  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();

  // Records mid-wake — hidden optimistically so the sleeping tile vanishes the
  // instant Wake is clicked, before the server drops the record.
  const [waking, setWaking] = createSignal<ReadonlySet<string>>(new Set());

  /** The top (non-split) terminal's original id of a record — the dedup key
   *  against the live list and the natural identity of the sleeping tile. */
  function topId(record: SleepingTerminal): string | undefined {
    return record.terminals.find((t) => !t.parentId)?.id;
  }

  /** Records to actually render as sleeping tiles: not currently waking, and
   *  not still live (the brief persist→kill window during a sleep, where the
   *  record exists but its terminal hasn't been killed yet). */
  const records = createMemo<SleepingTerminal[]>(() => {
    const live = new Set<string>(store.terminalIds());
    const inFlight = waking();
    return sleepingTerminals().filter((r) => {
      if (inFlight.has(r.id)) return false;
      const tid = topId(r);
      return tid === undefined || !live.has(tid);
    });
  });

  /** Respawn one record's tree through the shared restore primitives. Returns
   *  how many agents were auto-resumed. */
  async function respawn(record: SleepingTerminal): Promise<number> {
    const top = record.terminals.filter((t) => !t.parentId);
    const subs = record.terminals.filter(
      (t): t is typeof t & { parentId: string } => t.parentId !== undefined,
    );
    const oldToNew = new Map<string, TerminalId>();
    let restoredActiveId: TerminalId | null = null;
    let resumed = 0;

    for (const t of top) {
      const newId = await crud.handleCreate(t.cwd, {
        themeName: t.themeName,
        canvasLayout: t.canvasLayout,
        subPanel: t.subPanel,
        rightPanel: t.rightPanel,
        lastActivityAt: t.lastActivityAt,
        intent: t.intent,
      });
      oldToNew.set(t.id, newId);
      restoredActiveId = newId;
      if (t.subPanel) subPanel.seedPanel(newId, t.subPanel);
      if (t.rightPanel) rightPanel.seedPanel(newId, t.rightPanel);
      if (t.lastAgentCommand) {
        const resumeForm = resumeAgentCommand(t.lastAgentCommand);
        if (resumeForm) {
          await client.terminal.sendInput({
            id: newId,
            data: `${resumeForm}\r`,
          });
          resumed++;
        }
      }
    }
    for (const t of subs) {
      const newParentId = oldToNew.get(t.parentId);
      if (newParentId) await crud.handleCreateSubTerminal(newParentId, t.cwd);
    }
    // Remap the saved active split tab through the new ids (the saved id is one
    // of this record's own sub-terminals), so the right tab reopens.
    for (const t of top) {
      const savedActive = t.subPanel?.activeSubTab;
      const newParentId = oldToNew.get(t.id);
      const newActive = savedActive ? oldToNew.get(savedActive) : undefined;
      if (newParentId && newActive)
        subPanel.setActiveSubTab(newParentId, newActive);
    }
    if (restoredActiveId) store.setActiveSilently(restoredActiveId);
    return resumed;
  }

  /** Put a terminal (and its splits) to sleep. */
  async function sleepTerminal(id: TerminalId): Promise<void> {
    const tid = toast.loading("Putting terminal to sleep…");
    try {
      // Persist first (server reads live metadata), then tear down.
      await client.terminal.sleep({ id });
      await crud.handleKillWithSubs(id);
      toast.success("Terminal asleep — wake it from the Dock", { id: tid });
    } catch (err) {
      toast.error(`Failed to sleep terminal: ${(err as Error).message}`, {
        id: tid,
      });
    }
  }

  /** Wake a sleeping record: respawn its tree, then drop the record. */
  async function wakeTerminal(sleepId: string): Promise<void> {
    const record = sleepingTerminals().find((r) => r.id === sleepId);
    if (!record) return;
    setWaking((prev) => new Set(prev).add(sleepId));
    const tid = toast.loading("Waking terminal…");
    try {
      const resumed = await respawn(record);
      await client.terminal.wake({ sleepId });
      toast.success(
        resumed > 0 ? "Terminal woken — agent resumed" : "Terminal woken",
        {
          id: tid,
        },
      );
    } catch (err) {
      toast.error(`Failed to wake terminal: ${(err as Error).message}`, {
        id: tid,
      });
    } finally {
      setWaking((prev) => {
        const next = new Set(prev);
        next.delete(sleepId);
        return next;
      });
    }
  }

  /** The saved canvas layout of a record's tile (its top terminal's). */
  function getLayout(sleepId: string): CanvasLayout | undefined {
    const rec = sleepingTerminals().find((r) => r.id === sleepId);
    const top = rec?.terminals.find((t) => !t.parentId) ?? rec?.terminals[0];
    return top?.canvasLayout;
  }

  /** Persist a sleeping tile's dragged/resized layout (round-trips to disk). */
  function setLayout(sleepId: string, layout: CanvasLayout): void {
    void client.terminal
      .setSleepingLayout({ sleepId, layout })
      .catch((err: Error) =>
        toast.error(`Failed to move sleeping tile: ${err.message}`),
      );
  }

  /** Drop a sleeping record without respawning it (the tile's × button). */
  async function discard(sleepId: string): Promise<void> {
    try {
      await client.terminal.wake({ sleepId });
      toast("Sleeping terminal discarded");
    } catch (err) {
      toast.error(`Failed to discard: ${(err as Error).message}`);
    }
  }

  return {
    records,
    sleepTerminal,
    wakeTerminal,
    getLayout,
    setLayout,
    discard,
    topId,
  };
});
