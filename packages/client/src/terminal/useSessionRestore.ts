/** Session restore — hydration from server state, session restore handler. */

import { createSignal, createEffect } from "solid-js";
import { toast } from "solid-sonner";
import { useSubPanel } from "./useSubPanel";
import { useSavedSession } from "../settings/useSavedSession";
import { client, lifecycle } from "../rpc/rpc";
import type { TerminalId, TerminalInfo, SavedSession } from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

export function useSessionRestore(deps: {
  store: TerminalStore;
  subscribeExit: (id: TerminalId) => void;
  handleCreate: (cwd?: string, themeName?: string) => Promise<TerminalId>;
  handleCreateSubTerminal: (
    parentId: TerminalId,
    cwd?: string,
  ) => Promise<void>;
}) {
  const { store } = deps;
  const subPanel = useSubPanel();
  const serverSaved = useSavedSession();

  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );

  // Hydrate from server state on initial load.
  let hydrated = false;
  createEffect(() => {
    const existing = store.listSub();
    const fromServer = serverSaved.savedSession();
    // Gate on the subscription having yielded at least once — `sub.pending()`
    // flips false after the first yield (which may be the initial `null`
    // snapshot when no session is saved). Without this gate we'd hydrate
    // with a null before the server snapshot arrives and miss a restore prompt.
    if (existing === undefined || serverSaved.sub.pending()) return;
    if (hydrated) return;
    hydrated = true;
    if (existing.length === 0) {
      setSavedSession(fromServer);
      return;
    }
    hydrateFromTerminals(
      existing,
      fromServer?.activeTerminalId ?? null,
      fromServer?.canvasMaximized ?? false,
    );
  });

  function hydrateFromTerminals(
    existing: TerminalInfo[],
    serverActiveId: string | null,
    serverCanvasMaximized: boolean,
  ) {
    // Canvas layouts live on metadata — no client-side seeding needed.
    // Seed sub-panel state from server metadata.
    for (const t of existing) {
      if (t.meta.subPanel) {
        subPanel.seedPanel(t.id, t.meta.subPanel);
      }
    }

    // Initialize sub-panel active tabs for parents with sub-terminals
    const subs: Record<TerminalId, TerminalId[]> = {};
    for (const t of existing) {
      if (t.meta.parentId) {
        (subs[t.meta.parentId] ??= []).push(t.id);
      }
    }
    for (const [parentId, subIds] of Object.entries(subs)) {
      const panel = subPanel.getSubPanel(parentId);
      if (!panel.activeSubTab || !subIds.includes(panel.activeSubTab)) {
        subPanel.setActiveSubTab(parentId, subIds[0] ?? null);
      }
    }

    // Prefer the server-persisted active terminal; fall back to first in order.
    // `store.activeId()` starts as null after refresh (lost makePersisted in
    // #554), so on refresh the server snapshot is the only source of truth
    // for "which terminal was active".
    const topLevel = existing
      .filter((t) => !t.meta.parentId)
      .sort((a, b) => a.meta.sortOrder - b.meta.sortOrder);
    const topIds = topLevel.map((t) => t.id);
    const picked =
      serverActiveId && topIds.includes(serverActiveId as TerminalId)
        ? (serverActiveId as TerminalId)
        : (topIds[0] ?? null);
    store.setActiveId(picked);

    // Restore fullscreen-mode posture. Only honor it when there's an active
    // tile to render — maximized-with-nothing-active would show a blank.
    if (serverCanvasMaximized && picked) {
      store.setCanvasMaximized(true);
    }

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
  //
  // IMPORTANT: read `serverSaved.savedSession()` UNCONDITIONALLY so the
  // reactive tracker subscribes to it on the effect's first run. Reading
  // it inside the `if` body would skip tracking when the gate fails on
  // the first run (initial mount before `hydrated` flips), and subsequent
  // server pushes of a new saved-session would never re-fire this effect.
  // That was the source of the chronic session-restore flake (#320, #440):
  // when initial hydration raced with the snapshot, savedSession was set
  // to null on the first effect and the reactive recovery here was dead.
  //
  // Gated on lifecycle: on a genuine server restart, the dim overlay is
  // the authoritative rescue UI and the restore button shouldn't compete.
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
      for (const t of topLevel) {
        const newId = await deps.handleCreate(t.cwd, t.themeName);
        oldToNew.set(t.id, newId);
      }
      for (const t of subTerminals) {
        const newParentId = oldToNew.get(t.parentId!);
        if (newParentId) await deps.handleCreateSubTerminal(newParentId, t.cwd);
      }
      // Restore canvas layouts and sub-panel state under the new terminal IDs.
      // Canvas layouts go straight to the server — the metadata subscription
      // delivers them back to the canvas for rendering.
      for (const t of session.terminals) {
        const newId = oldToNew.get(t.id);
        if (!newId) continue;
        if (t.canvasLayout) {
          void client.terminal
            .setCanvasLayout({ id: newId, layout: t.canvasLayout })
            .catch((err: Error) =>
              toast.error(`Failed to restore canvas layout: ${err.message}`),
            );
        }
        if (t.subPanel) {
          subPanel.seedPanel(newId, t.subPanel);
        }
      }
      // Restore active terminal
      if (session.activeTerminalId) {
        const newActiveId = oldToNew.get(session.activeTerminalId);
        if (newActiveId) store.setActiveId(newActiveId);
      }
      // Restore fullscreen-mode posture
      if (session.canvasMaximized && store.activeId()) {
        store.setCanvasMaximized(true);
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
