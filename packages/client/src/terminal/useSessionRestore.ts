/** Session restore — hydration from server state, session restore handler. */

import { resumeAgentCommand } from "anyagent/cli";
import type {
  InitialTerminalMetadata,
  SavedSession,
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common/surface";
import { initialMetadataFromSavedTerminal } from "kolu-common/surface";
import { createEffect, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { lifecycle } from "../rpc/rpc";
import {
  client,
  savedSession as serverSavedSession,
  savedSessionSub,
} from "../wire";
import { useSubPanel } from "./useSubPanel";
import type { TerminalStore } from "./useTerminalStore";

/** A terminal paired with its (already-arrived) metadata. The hydration
 *  effect builds these by gating on the `terminalMetadata` collection
 *  having yielded for every entry, so `m` is always defined. */
type HydrationEntry = { t: TerminalInfo; m: TerminalMetadata };

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

  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );

  // Hydrate from server state on initial load.
  let hydrated = false;
  createEffect(() => {
    const existing = store.listSub();
    const fromServer = serverSavedSession();
    // Gate on the subscription having yielded at least once — `sub.pending()`
    // flips false after the first yield (which may be the initial `null`
    // snapshot when no session is saved). Without this gate we'd hydrate
    // with a null before the server snapshot arrives and miss a restore prompt.
    if (existing === undefined || savedSessionSub.pending()) return;
    if (hydrated) return;
    if (existing.length === 0) {
      hydrated = true;
      setSavedSession(fromServer);
      return;
    }
    // Wait for the `terminalMetadata` collection to yield a value for
    // every terminal — hydration reads `parentId` and `subPanel` off it
    // (since #806 the list snapshot no longer carries `meta`). The reads
    // are reactive, so the effect re-runs as values arrive.
    const entries: HydrationEntry[] = [];
    for (const t of existing) {
      const m = store.getMetadata(t.id);
      if (m === undefined) return;
      entries.push({ t, m });
    }
    hydrated = true;
    hydrateFromTerminals(entries, fromServer?.activeTerminalId ?? null);
  });

  function hydrateFromTerminals(
    entries: HydrationEntry[],
    serverActiveId: string | null,
  ) {
    // Canvas layouts live on metadata — no client-side seeding needed.
    // Seed sub-panel state from server metadata.
    for (const { t, m } of entries) {
      if (m.subPanel) subPanel.seedPanel(t.id, m.subPanel);
    }

    // Initialize sub-panel active tabs for parents with sub-terminals
    const subs = Object.groupBy(
      entries.filter(({ m }) => m.parentId),
      ({ m }) => m.parentId as string,
    );
    for (const [parentId, group] of Object.entries(subs)) {
      const subIds = group?.map(({ t }) => t.id) ?? [];
      const panel = subPanel.getSubPanel(parentId);
      if (!panel.activeSubTab || !subIds.includes(panel.activeSubTab)) {
        subPanel.setActiveSubTab(parentId, subIds[0] ?? null);
      }
    }

    // Prefer the server-persisted active terminal; fall back to first in order.
    // `store.activeId()` starts as null after refresh (lost makePersisted in
    // #554), so on refresh the server snapshot is the only source of truth
    // for "which terminal was active". `entries` arrives in the server's
    // Map insertion order, which is the canonical ordering.
    const topIds = entries.filter(({ m }) => !m.parentId).map(({ t }) => t.id);
    const picked =
      serverActiveId && topIds.includes(serverActiveId as TerminalId)
        ? (serverActiveId as TerminalId)
        : (topIds[0] ?? null);
    // `setActiveSilently`: the canvas's first-mount fallback effect pans
    // the viewport to the picked active when restoring at default origin —
    // calling `activate` here would double-pan and racing the still-
    // assembling pendingLayouts.
    store.setActiveSilently(picked);

    // Seed MRU with all top-level terminals (active first, rest in sidebar order).
    const active = store.activeId();
    store.setMruOrder(
      active ? [active, ...topIds.filter((x) => x !== active)] : topIds,
    );

    for (const { t } of entries) deps.subscribeExit(t.id);
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
    const fromServer = serverSavedSession();
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
      // Type predicate so the body of the loop below sees `parentId`
      // narrowed to `string` instead of `string | undefined`.
      const subTerminals = session.terminals.filter(
        (t): t is typeof t & { parentId: string } => t.parentId !== undefined,
      );
      let resumed = 0;
      // Seed each new terminal with its saved metadata atomically at create
      // time — the server embeds it into the first `terminal.list` snapshot,
      // so the canvas cascade effect sees the saved layout on its first run
      // and skips the default-cascade branch (#642).
      for (const t of topLevel) {
        const newId = await deps.handleCreate(
          t.cwd,
          initialMetadataFromSavedTerminal(t),
        );
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
        const newParentId = oldToNew.get(t.parentId);
        if (newParentId) await deps.handleCreateSubTerminal(newParentId, t.cwd);
      }
      // Restore active terminal
      if (session.activeTerminalId) {
        const newActiveId = oldToNew.get(session.activeTerminalId);
        if (newActiveId) store.setActiveSilently(newActiveId);
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
