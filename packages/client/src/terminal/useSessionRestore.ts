/** Session restore — hydration from server state, session restore handler. */

import { padiRpc } from "@kolu/padi/surface";
import type {
  SavedSession,
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common/surface";
import { createEffect, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { useRightPanel } from "../right-panel/useRightPanel";
import { lifecycle } from "../rpc/rpc";
import {
  padi,
  savedSessionSub,
  savedSession as serverSavedSession,
} from "../wire";
import { useSubPanel } from "./useSubPanel";
import type { TerminalStore } from "./useTerminalStore";

/** A terminal paired with its (already-arrived) metadata. The hydration
 *  effect builds these by gating on BOTH metadata halves (`authored` +
 *  `awareness`) having joined for every entry, so `m` is always defined. */
type HydrationEntry = { t: TerminalInfo; m: TerminalMetadata };

export function useSessionRestore(deps: { store: TerminalStore }) {
  const { store } = deps;
  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();

  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );
  /** True from the moment `handleRestoreSession` starts until it
   *  resolves (success or failure). The restore card stays mounted
   *  while this is true so the click target doesn't detach mid-flight. */
  const [isRestoring, setIsRestoring] = createSignal(false);

  // Hydrate from server state. TWO once-only steps, tracked separately:
  //   - `decided`   — the empty-vs-restore DECISION (drives the restore card),
  //                    made once the terminal list + saved-session cell report;
  //   - `viewSeeded` — the client VIEW-STATE seed (active tile + canvas viewport
  //                    + sub-panel tabs + MRU), run once REAL terminals appear.
  //
  // The two are DISTINCT because W1.R6 deleted the client respawn loop that used
  // to seed the view inline during a restore-from-empty-state: now that seeding
  // rides THIS effect, which must fire when the restored terminals arrive — even
  // though the empty-state decision already ran. (A browser reload re-mounts the
  // hook, so both flags start false and the initial-load path is unchanged.)
  let decided = false;
  let viewSeeded = false;
  createEffect(() => {
    const existing = store.listSub();
    const fromServer = serverSavedSession();
    // Gate on the subscription having yielded at least once — `sub.pending()`
    // flips false after the first yield (which may be the initial `null`
    // snapshot when no session is saved). Without this gate we'd hydrate
    // with a null before the server snapshot arrives and miss a restore prompt.
    if (existing === undefined || savedSessionSub.pending()) return;
    // Empty-vs-restore decision (once). Key it on the parked-FILTERED real
    // terminal set (`store.terminalIds()`), NOT the raw list: a reboot seeds
    // PARKED registry entries (W1.R6), which DO appear in `listSub()` (they
    // carry `info`) but are off-canvas restore-card rows, not tiles. Reading the
    // raw `existing.length` here would see those parked entries as "not empty"
    // and skip showing the card on a real reboot with active terminals — the
    // exact case the card exists for. `terminalIds()` excludes parked (and is
    // `[]` whether or not the metadata half has joined), so the empty-branch
    // fires at a parked cold boot exactly as it did pre-R6, ordering-independent
    // (the gate above already waited for BOTH the list and session cells to
    // yield). When empty, the card reads `savedSession`; the re-fetch effect
    // below keeps it current after.
    if (!decided) {
      decided = true;
      if (store.terminalIds().length === 0) {
        setSavedSession(fromServer);
        return;
      }
    }
    if (viewSeeded) return;
    // Wait for both metadata halves to join (via `store.getMetadata`) for EVERY
    // listed terminal — hydration reads `parentId` and `subPanel` off the joined
    // record (since #806 the list snapshot no longer carries `meta`). The reads
    // are reactive, so the effect re-runs as values arrive. Waiting for ALL
    // (including parked) first avoids seeding on a partial set.
    const joined: HydrationEntry[] = [];
    for (const t of existing) {
      const m = store.getMetadata(t.id);
      if (m === undefined) return;
      joined.push({ t, m });
    }
    // A PARKED record is a restore-card row, not a canvas tile (W1.R6) — never
    // seed the view from one. Seed only once a REAL (active/sleeping) terminal
    // exists: the initial live load, or once a restore consumes the parked set.
    const real = joined.filter(
      ({ m }) => (m as { state: string }).state !== "parked",
    );
    if (real.length === 0) return;
    viewSeeded = true;
    hydrateFromTerminals(real, fromServer?.activeTerminalId ?? null);
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
    if (store.terminalIds().length === 0 && decided) {
      setSavedSession(fromServer);
    }
  });

  async function handleRestoreSession(
    options: { resumeIds?: ReadonlySet<string> } = {},
  ) {
    if (isRestoring()) return;
    const session = savedSession();
    if (!session) return;
    // Keep the restore card mounted until the server restore actually completes.
    // Synchronously clearing `savedSession` before the async RPC returns detaches
    // the click target mid-event — Playwright sees "element detached from the DOM"
    // retries, and a human sees an empty-state flicker between click and canvas
    // reveal. The visible card during the restore window is gated by
    // `isRestoring()`; on success we clear `savedSession` before the toast, on
    // failure we leave it set so the user can retry.
    setIsRestoring(true);
    const id = toast.loading(
      `Restoring ${session.terminals.length} terminals…`,
    );
    try {
      // ONE writer, ONE call: padi re-spawns every terminal server-side (the
      // former client respawn loop is deleted). No `lifecycle.*` create /
      // restoreSleeping / sendInput fires from the client during restore — only
      // this `session.restore` — so restore can't half-apply across a mid-flight
      // reconnect. The client-side view-state (active tile + canvas viewport +
      // sub-panel tabs + MRU) is seeded by the HYDRATION effect below once the
      // restored terminals arrive on the `terminals` collection, exactly as a
      // browser reload hydrates.
      //
      // `resumeIds` is the per-terminal opt-in the restore card builds off its
      // global toggle: the SET of ids to resume (empty when the toggle is off).
      await padiRpc(padi).surface.session.restore({
        resumeIds: options.resumeIds ? [...options.resumeIds] : undefined,
      });
      setSavedSession(null);
      toast.success("Session restored", { id });
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
  };
}
