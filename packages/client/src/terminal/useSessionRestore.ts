/** Session restore — hydration from server state, session restore handler. */

import { createSignal, createEffect } from "solid-js";
import { toast } from "solid-sonner";
import { resumeAgentCommand } from "anyagent/cli";
import { useSubPanel } from "./useSubPanel";
import { useSavedSession } from "../settings/useSavedSession";
import { lifecycle, client } from "../rpc/rpc";
import type {
  InitialTerminalMetadata,
  TerminalId,
  TerminalInfo,
  SavedSession,
} from "kolu-common";
import type { TerminalStore } from "./useTerminalStore";

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
    hydrateFromTerminals(existing, fromServer?.activeTerminalId ?? null);
  });

  function hydrateFromTerminals(
    existing: TerminalInfo[],
    serverActiveId: string | null,
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
    // for "which terminal was active". `existing` arrives in the server's
    // Map insertion order, which is the canonical ordering.
    const topLevel = existing.filter((t) => !t.meta.parentId);
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

  async function handleRestoreSession(
    options: { resumeIds?: ReadonlySet<string> } = {},
  ) {
    const session = savedSession();
    if (!session) return;
    setSavedSession(null);
    const resumeIds = options.resumeIds;
    const id = toast.loading(
      `Restoring ${session.terminals.length} terminals…`,
    );
    try {
      const oldToNew = new Map<string, TerminalId>();
      // Array order is the ordering — the server wrote terminals in Map
      // insertion order, and that order round-trips verbatim through disk.
      const topLevel = session.terminals.filter((t) => !t.parentId);
      const subTerminals = session.terminals.filter((t) => t.parentId);
      let resumed = 0;
      // Seed each new terminal with its saved metadata atomically at create
      // time — the server embeds it into the first `terminal.list` snapshot,
      // so the canvas cascade effect sees the saved layout on its first run
      // and skips the default-cascade branch (#642).
      for (const t of topLevel) {
        const newId = await deps.handleCreate(t.cwd, {
          themeName: t.themeName,
          canvasLayout: t.canvasLayout,
          subPanel: t.subPanel,
        });
        oldToNew.set(t.id, newId);
        // Client-side sub-panel state (activeSubTab, focusTarget) isn't
        // server-persisted — seed it locally so the restored panel reopens
        // to the same tab. The server-persisted fields (collapsed, panelSize)
        // ride along via handleCreate above.
        if (t.subPanel) subPanel.seedPanel(newId, t.subPanel);
        // Auto-launch the resume form of the previously captured agent
        // command, if the user didn't opt out. The command is already
        // normalized (prompts/positionals stripped by the allowlist at
        // capture time), so there's nothing arbitrary to smuggle through.
        const optedIn = !resumeIds || resumeIds.has(t.id);
        if (t.lastAgentCommand && optedIn) {
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
      for (const t of subTerminals) {
        const newParentId = oldToNew.get(t.parentId!);
        if (newParentId) await deps.handleCreateSubTerminal(newParentId, t.cwd);
      }
      // Restore active terminal
      if (session.activeTerminalId) {
        const newActiveId = oldToNew.get(session.activeTerminalId);
        if (newActiveId) store.setActiveId(newActiveId);
      }
      const summary =
        resumed > 0
          ? `Restored ${session.terminals.length} terminals, resumed ${resumed} agent${resumed > 1 ? "s" : ""}`
          : "Session restored";
      toast.success(summary, { id });
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
