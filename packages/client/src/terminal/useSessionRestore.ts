/** Session restore — hydration from server state, session restore handler.
 *
 *  Sub-terminals are referenced by id from a parent's `panels` (the
 *  `{ kind: "terminal", id }` variant). Restore creates fresh ids for every
 *  saved terminal, so the parent's saved panels need an id remap before
 *  they can be persisted; otherwise every terminal-kind tab would point at
 *  a dead id and the server's prune step would drop it on the next
 *  metadata write. */

import { createSignal, createEffect } from "solid-js";
import { toast } from "solid-sonner";
import { client } from "../rpc/rpc";
import { useSavedSession } from "../settings/useSavedSession";
import { lifecycle } from "../rpc/rpc";
import {
  ALL_PANEL_EDGES,
  type InitialTerminalMetadata,
  type PanelContent,
  type TerminalId,
  type TerminalInfo,
  type TerminalPanels,
  type SavedSession,
} from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

/** Rewrite a `TerminalPanels` blob so every `{ kind: "terminal", id }` tab
 *  points at the post-restore id. Tabs whose old id has no entry in the
 *  remap are dropped — that terminal didn't survive restore (e.g. its
 *  saved `cwd` failed `handleCreate`). */
function remapPanels(
  panels: TerminalPanels | undefined,
  oldToNew: Map<string, TerminalId>,
): TerminalPanels | undefined {
  if (!panels) return undefined;
  const out: TerminalPanels = {};
  let any = false;
  for (const edge of ALL_PANEL_EDGES) {
    const slot = panels[edge];
    if (!slot) continue;
    const tabs: PanelContent[] = slot.tabs.flatMap((t): PanelContent[] => {
      if (t.kind !== "terminal") return [t];
      const mapped = oldToNew.get(t.id);
      return mapped ? [{ kind: "terminal", id: mapped }] : [];
    });
    if (tabs.length === 0) continue;
    const active = Math.min(slot.active, tabs.length - 1);
    out[edge] = { ...slot, tabs, active };
    any = true;
  }
  return any ? out : undefined;
}

export function useSessionRestore(deps: {
  store: TerminalStore;
  subscribeExit: (id: TerminalId) => void;
  handleCreate: (
    cwd?: string,
    initial?: InitialTerminalMetadata,
  ) => Promise<TerminalId>;
  handleCreateSubTerminal: (
    parentId: TerminalId,
    cwd?: string,
  ) => Promise<TerminalId>;
}) {
  const { store } = deps;
  const serverSaved = useSavedSession();

  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );

  // Hydrate from server state on initial load.
  let hydrated = false;
  createEffect(() => {
    const existing = store.listSub();
    const fromServer = serverSaved.savedSession();
    if (existing === undefined || serverSaved.sub.pending()) return;
    if (hydrated) return;
    hydrated = true;
    if (existing.length === 0) {
      setSavedSession(fromServer);
      return;
    }
    hydrateFromTerminals(existing, fromServer?.activeTerminalId ?? null);
  });

  function hydrateFromTerminals(
    existing: TerminalInfo[],
    serverActiveId: string | null,
  ) {
    // Canvas layouts and panels both live on metadata — no client-side
    // seeding needed; the metadata subscription delivers them as the tile
    // mounts.

    // Prefer the server-persisted active terminal; fall back to first in order.
    const topLevel = existing
      .filter((t) => !t.meta.parentId)
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
    const topIds = topLevel.map((t) => t.id);
    const picked =
      serverActiveId && topIds.includes(serverActiveId as TerminalId)
        ? (serverActiveId as TerminalId)
        : (topIds[0] ?? null);
    store.setActiveId(picked);

    // Seed MRU with all top-level terminals (active first, rest in sidebar order).
    const active = store.activeId();
    store.setMruOrder(
      active ? [active, ...topIds.filter((x) => x !== active)] : topIds,
    );

    for (const t of existing) deps.subscribeExit(t.id);
  }

  // Re-fetch saved session when all terminals are killed mid-session,
  // OR when the server pushes a fresh saved-session value while we're
  // already showing the empty state.
  createEffect(() => {
    if (lifecycle().kind === "restarted") return;
    const fromServer = serverSaved.savedSession();
    if (store.terminalIds().length === 0 && hydrated) {
      setSavedSession(fromServer);
    }
  });

  async function handleRestoreSession() {
    const session = savedSession();
    if (!session) return;
    setSavedSession(null);
    const id = toast.loading(
      `Restoring ${session.terminals.length} terminals…`,
    );
    try {
      const oldToNew = new Map<string, TerminalId>();
      const bySortOrder = (
        a: { sortOrder?: number },
        b: { sortOrder?: number },
      ) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0);
      const topLevel = session.terminals
        .filter((t) => !t.parentId)
        .sort(bySortOrder);
      const subTerminals = session.terminals
        .filter((t) => t.parentId)
        .sort(bySortOrder);
      // Pass 1 — top-level terminals with their canvas/theme. Defer panels:
      // they may reference sub-terminal ids that don't exist yet.
      for (const t of topLevel) {
        const newId = await deps.handleCreate(t.cwd, {
          themeName: t.themeName,
          canvasLayout: t.canvasLayout,
        });
        oldToNew.set(t.id, newId);
      }
      // Pass 2 — sub-terminals under their (newly-keyed) parents.
      for (const t of subTerminals) {
        const newParentId = oldToNew.get(t.parentId!);
        if (!newParentId) continue;
        const newId = await deps.handleCreateSubTerminal(newParentId, t.cwd);
        oldToNew.set(t.id, newId);
      }
      // Pass 3 — write each top-level terminal's `panels` with remapped
      // terminal ids. Done after sub-terminal create so the remap covers
      // every reference.
      for (const t of topLevel) {
        const remapped = remapPanels(t.panels, oldToNew);
        if (!remapped) continue;
        const newId = oldToNew.get(t.id);
        if (!newId) continue;
        await client.terminal
          .setPanels({ id: newId, panels: remapped })
          .catch((err: Error) =>
            toast.error(`Failed to restore panels: ${err.message}`),
          );
      }
      // Restore active terminal
      if (session.activeTerminalId) {
        const newActiveId = oldToNew.get(session.activeTerminalId);
        if (newActiveId) store.setActiveId(newActiveId);
      }
      toast.success("Session restored", { id });
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`, { id });
      throw err;
    }
  }

  return {
    isLoading: () => store.listSub.pending(),
    savedSession,
    handleRestoreSession,
  };
}
