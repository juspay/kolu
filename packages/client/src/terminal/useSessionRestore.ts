/** Session restore — hydration from server state, session restore handler. */

import { resumeAgentCommand } from "anyagent/cli";
import {
  type PersistedTerminalFields,
  type SavedSession,
  sleepingArm,
  type TerminalId,
  type TerminalInfo,
  type TerminalMetadata,
} from "kolu-common/surface";
import { createEffect, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { useRightPanel } from "../right-panel/useRightPanel";
import { lifecycle } from "../rpc/rpc";
import {
  client,
  savedSessionSub,
  savedSession as serverSavedSession,
} from "../wire";
import { useSubPanel } from "./useSubPanel";
import { useTerminalCrud } from "./useTerminalCrud";
import { useTerminalStore } from "./useTerminalStore";

/** A terminal paired with its (already-arrived) metadata. The hydration
 *  effect builds these by gating on the `terminalMetadata` collection
 *  having yielded for every entry, so `m` is always defined. */
type HydrationEntry = { t: TerminalInfo; m: TerminalMetadata };

/** Session restore — singleton via `createSharedRoot`, mirroring `useTerminalCrud`.
 *
 *  Reads its collaborators (`store`, `handleCreate`, `handleCreateSubTerminal`)
 *  off the `useTerminalStore` / `useTerminalCrud` singletons internally instead
 *  of receiving them as DI args (the old `{ store, handleCreate, … }` bag was the
 *  same unenforceable "deps never change identity" convention `useTerminalCrud`
 *  shed). This is what lets `TileTitleActions` / `DormantTileBody` call
 *  `useSessionRestore().handleWake(id)` DIRECTLY (F10) — no per-tile `onWake`
 *  prop drilled through App, keeping App.tsx a thin layout shell. The hydration
 *  `createEffect`s run once inside the shared root's app-lifetime owner, so a
 *  consumer's disposal can't freeze them for everyone else. */
export const useSessionRestore = createSharedRoot(() => {
  const store = useTerminalStore();
  const { handleCreate, handleCreateSubTerminal } = useTerminalCrud();
  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();

  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );
  /** True from the moment `handleRestoreSession` starts until it
   *  resolves (success or failure). The restore card stays mounted
   *  while this is true so the click target doesn't detach mid-flight. */
  const [isRestoring, setIsRestoring] = createSignal(false);

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
    // Seed sub-panel + right-panel state from server metadata.
    for (const { t, m } of entries) {
      if (m.subPanel) subPanel.seedPanel(t.id, m.subPanel);
      if (m.rightPanel) rightPanel.seedPanel(t.id, m.rightPanel);
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

  /** Restore ONE saved terminal: spawn a fresh ACTIVE terminal (new id) seeded
   *  with the record's persisted metadata, seed its client-only sub-panel /
   *  right-panel state, and auto-launch the resume form of its last agent
   *  command. The single re-mint-id + resume mechanism shared by full-session
   *  restore (the loop below) and Wake (restore-one off a sleeping record) — so
   *  the two can't drift. Pure of the active-marker protocol; the session loop
   *  layers that on top, and wake sets the active id itself.
   *
   *  `resume` gates the agent auto-launch (session restore honors the user's
   *  per-terminal opt-out; wake always resumes). Returns the new id AND whether
   *  it actually sent a resume — the single source of truth for "did this
   *  terminal resume", so the session loop's `resumed` counter reads the same
   *  derivation that drove the send rather than recomputing `resumeAgentCommand`.
   *
   *  Takes only the persisted base (`PersistedTerminalFields`) it actually
   *  consumes — neither caller forges a discriminant: the session loop passes its
   *  `SavedActiveTerminal` (a structural superset) and Wake passes the
   *  `SleepingTerminal` record unchanged, no `state: "active"` cast. */
  async function restoreOneTerminal(
    t: PersistedTerminalFields,
    resume: boolean,
  ): Promise<{ id: TerminalId; resumed: boolean }> {
    // `t.location` is deliberately NOT forwarded: the create seam carries only
    // client-owned `InitialTerminalMetadata`, and the endpoint owns location —
    // so each terminal re-spawns at `LOCAL_LOCATION`. Correct while every
    // terminal is local; P3 replaces this with dial+adopt.
    const newId = await handleCreate(t.cwd, {
      themeName: t.themeName,
      canvasLayout: t.canvasLayout,
      subPanel: t.subPanel,
      rightPanel: t.rightPanel,
      lastActivityAt: t.lastActivityAt,
      intent: t.intent,
    });
    // Client-side sub-panel state (activeSubTab, focusTarget) isn't
    // server-persisted — seed it locally so the restored panel reopens to the
    // same tab. The server-persisted fields ride `handleCreate` above.
    if (t.subPanel) subPanel.seedPanel(newId, t.subPanel);
    // Right-panel per-terminal state: the persisted record rides `handleCreate`;
    // `seedPanel` here is the early-read optimization for the in-memory store.
    if (t.rightPanel) rightPanel.seedPanel(newId, t.rightPanel);
    // Auto-launch the resume form of the previously captured agent command. The
    // command is already normalized (prompts/positionals stripped at capture),
    // so there's nothing arbitrary to smuggle through.
    let resumed = false;
    if (resume && t.lastAgentCommand) {
      const resumeForm = resumeAgentCommand(t.lastAgentCommand);
      if (resumeForm) {
        await client.terminal.sendInput({ id: newId, data: `${resumeForm}\r` });
        resumed = true;
      }
    }
    return { id: newId, resumed };
  }

  /** Wake a sleeping terminal — restore-one. Reads the frozen sleeping record
   *  off the client metadata store, spawns a fresh ACTIVE terminal + resumes its
   *  agent FIRST (so a failed create leaves the sleeping record intact for a
   *  retry), then on success drops the retired sleeping record server-side and
   *  makes the new terminal active. */
  async function handleWake(sleepingId: TerminalId): Promise<void> {
    const rec = sleepingArm(store.getMetadata(sleepingId));
    if (!rec) return;
    // restore-one FIRST — create + resume against the frozen base. The record is
    // `SleepingTerminal` (persisted base + sleptAt); `restoreOneTerminal` consumes
    // only the persisted base, so the record slots straight in with no
    // `state: "active"` cast. If create throws, `handleCreate` already toasted and
    // the await propagates — the sleeping record is left intact (we never reach
    // the discard below), so the Wake button stays retryable.
    // Wake always resumes, so the `resumed` flag is irrelevant here.
    const { id: newId } = await restoreOneTerminal(rec, true);
    // Only after the replacement spawns: drop the retired sleeping record (no
    // PTY to kill — it was released at sleep time). This MUST succeed for wake
    // to be transactional (F6): a sleeping record left behind stays wakeable, so
    // a swallowed discard failure would let the user wake the SAME record again
    // and spawn a duplicate live terminal. So on a discard failure we ROLL BACK
    // the just-created terminal rather than treat the wake as done — leaving one
    // sleeping record and no orphan live terminal, retryable from the same tile.
    try {
      await client.terminal.discardSleeping({ id: sleepingId });
    } catch (err) {
      // Roll back the just-created terminal so a failed discard doesn't leave
      // BOTH a wakeable sleeping record AND a live duplicate. If the rollback
      // kill ALSO fails, the client can't reach a clean state — log it loud and
      // tell the user the workspace is inconsistent rather than imply a clean
      // retry (which would spawn yet another duplicate off the same record).
      let rolledBack = true;
      await client.terminal.kill({ id: newId }).catch((killErr: Error) => {
        rolledBack = false;
        console.error("wake rollback kill failed", {
          sleepingId,
          newId,
          killErr,
        });
      });
      toast.error(
        rolledBack
          ? `Failed to wake terminal: ${(err as Error).message}. The terminal was not woken — try again.`
          : `Failed to wake terminal: ${(err as Error).message}. Cleanup also failed — restart kolu to recover.`,
      );
      return;
    }
    store.setActiveSilently(newId);
  }

  /** Discard a sleeping record outright — the close-as-discard path (no PTY to
   *  kill). Routed here so the close-confirm calls one verb.
   *
   *  Toasts AND RETHROWS on failure (F5): the worktree-removal path
   *  (`handleKillWorktree`) gates `worktreeRemove` on this resolving, so a
   *  swallowed failure would let the worktree be deleted while the dormant
   *  record (or its reload twin) still points at the now-gone path. Propagating
   *  lets that caller abort. The standalone close-confirm caller fires this
   *  with `void` + `.catch`, since the toast here already told the user. */
  async function handleDiscardSleeping(id: TerminalId): Promise<void> {
    await client.terminal.discardSleeping({ id }).catch((err: Error) => {
      toast.error(`Failed to discard sleeping terminal: ${err.message}`);
      throw err;
    });
  }

  async function handleRestoreSession(
    // `session` selects the input source: the server-persisted snapshot
    // (default) or an arbitrary blob from a caller like the diagnostic
    // "Import session" command. If a third source ever appears, replace this
    // optional bag with a discriminated `source` union rather than widening it.
    options: { resumeIds?: ReadonlySet<string>; session?: SavedSession } = {},
  ) {
    if (isRestoring()) return;
    const session = options.session ?? savedSession();
    if (!session) return;
    // Keep the restore card mounted until terminal creation actually
    // succeeds. Synchronously clearing `savedSession` before the async
    // create loop runs detaches the click target mid-event — Playwright
    // sees "element was detached from the DOM" retries on slow restores,
    // and a fast human user sees an empty-state flicker between click
    // and canvas reveal. The visible card during the restore window is
    // gated below by `isRestoring()`; on success we clear `savedSession`
    // before the toast, on failure we leave it set so the user can retry.
    setIsRestoring(true);
    const resumeIds = options.resumeIds;
    const id = toast.loading(
      `Restoring ${session.terminals.length} terminals…`,
    );
    try {
      const oldToNew = new Map<string, TerminalId>();
      // ── Active-terminal restore protocol — three interdependent steps ──
      //
      // The saved `activeTerminalId` must end up as `store.activeId()`
      // AND the canvas viewport must center on its tile. Two upstream
      // constraints force the protocol shape:
      //
      //   (a) `TerminalCanvas.tsx:331` first-mount fallback effect fires
      //       on the *first* terminal-list snapshot. If `activeId` is
      //       null at that moment, it falls through to bbox-of-tiles
      //       centering, pans the viewport off-default, and won't
      //       re-center on a later `setActiveSilently`.
      //   (b) `useTerminalCrud.handleCreate` itself calls
      //       `store.setActiveSilently(info.id)` for every new terminal
      //       it creates — so whichever terminal is created *last*
      //       wins the active slot unless we reassert.
      //
      // The protocol:
      //   1. **Order**: put the saved active terminal first in
      //      `topLevel` so it's the first `handleCreate`.
      //   2. **In-loop assert**: synchronously after the matching
      //      `handleCreate`, call `setActiveSilently(newId)` so the
      //      first-mount canvas effect sees the right active when the
      //      empty-state→canvas swap fires.
      //   3. **Post-loop reassert**: re-set the captured `newId` at the
      //      end so the per-iteration `handleCreate` auto-set on later
      //      iterations doesn't leave the wrong terminal active. (Falls
      //      back to looking up by saved id for sessions whose active
      //      was a sub-terminal — `topLevel` filtered it out, but
      //      `oldToNew` still has the mapping.)
      //
      // Display order is unaffected by step 1: tile layouts are saved
      // verbatim (per-tile `canvasLayout`), and the workspace switcher
      // pill strip sorts by `terminalKey().group` rather than insertion
      // order. The whole protocol collapses to step 2 alone the day
      // `handleCreate` accepts an `activate: false` flag (TODO).

      // Array order is the ordering — the server wrote terminals in Map
      // insertion order, and that order round-trips verbatim through disk.
      // Only ACTIVE records spawn through the restore card: a sleeping record
      // rehydrates AS sleeping server-side (boot seed), so the restore path must
      // never re-spawn one as a live terminal.
      const topLevelInSavedOrder = session.terminals.filter(
        (t) => t.state === "active" && !t.parentId,
      );
      // Step 1: active-first reorder.
      const topLevel =
        session.activeTerminalId !== undefined
          ? (() => {
              const activeIdx = topLevelInSavedOrder.findIndex(
                (t) => t.id === session.activeTerminalId,
              );
              if (activeIdx <= 0) return topLevelInSavedOrder;
              return [
                // slice(activeIdx, activeIdx + 1) avoids the `!` non-null assertion
                // that `[activeIdx]` would require; activeIdx > 0 is proven above.
                ...topLevelInSavedOrder.slice(activeIdx, activeIdx + 1),
                ...topLevelInSavedOrder.slice(0, activeIdx),
                ...topLevelInSavedOrder.slice(activeIdx + 1),
              ];
            })()
          : topLevelInSavedOrder;
      // Type predicate so the body of the loop below sees `parentId`
      // narrowed to `string` instead of `string | undefined`. Sub-terminals are
      // always active (only a top-level terminal can sleep).
      const subTerminals = session.terminals.filter(
        (t): t is typeof t & { parentId: string } =>
          t.state === "active" && t.parentId !== undefined,
      );
      let resumed = 0;
      /** New id of the saved active terminal — captured in step 2, used in step 3. */
      let restoredActiveId: TerminalId | null = null;
      // Seed each new terminal with its saved metadata atomically at create
      // time — the server embeds it into the first `terminal.list` snapshot,
      // so the canvas cascade effect sees the saved layout on its first run
      // and skips the default-cascade branch (#642).
      for (const t of topLevel) {
        // Re-mint id + resume off the saved base — the shared restore-one
        // mechanism (also used by Wake). The user's per-terminal opt-out gates
        // the agent auto-launch.
        const optedIn = !resumeIds || resumeIds.has(t.id);
        const { id: newId, resumed: didResume } = await restoreOneTerminal(
          t,
          optedIn,
        );
        oldToNew.set(t.id, newId);
        // Step 2: in-loop assert. Combined with step 1, this puts the
        // intended active in place before the first canvas mount.
        if (t.id === session.activeTerminalId) {
          restoredActiveId = newId;
          store.setActiveSilently(newId);
        }
        // Count off the actual send (not a recomputed `resumeAgentCommand` gate),
        // so the summary can't disagree with what restore-one really resumed.
        if (didResume) resumed++;
      }
      for (const t of subTerminals) {
        const newParentId = oldToNew.get(t.parentId);
        if (newParentId) await handleCreateSubTerminal(newParentId, t.cwd);
      }
      // Step 3: post-loop reassert (see protocol block above).
      if (restoredActiveId !== null) {
        store.setActiveSilently(restoredActiveId);
      } else if (session.activeTerminalId) {
        const newActiveId = oldToNew.get(session.activeTerminalId);
        if (newActiveId) store.setActiveSilently(newActiveId);
      }
      const summary =
        resumed > 0
          ? `Restored ${session.terminals.length} terminals, resumed ${resumed} agent${resumed > 1 ? "s" : ""}`
          : "Session restored";
      setSavedSession(null);
      toast.success(summary, { id });
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`, { id });
      throw err;
    } finally {
      setIsRestoring(false);
    }
  }

  return {
    // Loading is true until we can make an HONEST empty-vs-restore decision.
    // The terminal count alone isn't enough: `store.terminalIds()` (the
    // metadata-derived top-level IDs) yields `[]` (terminals were killed on the
    // previous shutdown) before the `session` cell has reported, and rendering
    // the bare empty state in that window is a *lie* — it claims "nothing to
    // restore" while the saved-session snapshot is still in flight, so the
    // restore card only appears after a full reload re-subs.
    // When `terminalIds()` is empty we therefore also wait on `savedSessionSub`
    // so the decision is made with the session snapshot in hand. When at least
    // one terminal's metadata has arrived (`terminalIds().length > 0`), the
    // canvas renders immediately — the session cell is irrelevant.
    // Note: `terminalIds()` excludes terminals whose per-terminal metadata
    // hasn't arrived yet, so there is a brief window after `listSub` resolves
    // where all metadata is still in-flight and the gate also holds loading.
    // `terminalIds()` is the same signal the empty-state branch reads at
    // App.tsx:397 (`showEmpty = !session.isLoading() && terminalIds().length
    // === 0`), so the loading gate and the empty-state branch agree on what
    // "empty" means.
    isLoading: () =>
      store.listSub.pending() ||
      (store.terminalIds().length === 0 && savedSessionSub.pending()),
    savedSession,
    isRestoring,
    handleRestoreSession,
    // Wake = restore-one (spawn fresh active terminal + resume, then drop the
    // retired sleeping record). Lives here so it reuses `restoreOneTerminal`
    // verbatim rather than hand-rolling a parallel restore.
    handleWake,
    handleDiscardSleeping,
  };
});
