/** Session restore — hydration from server state, session restore handler. */

import type { SavedSession, TerminalMetadata } from "@kolu/padi/surface";
import { resumableCommand, type TerminalId } from "kolu-common/surface";
import { createEffect, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import { useRightPanel } from "../right-panel/useRightPanel";
import { lifecycle } from "../rpc/rpc";
import {
  activePadiRpc,
  savedSessionSub,
  savedSession as serverSavedSession,
} from "../wire";
import { useSubPanel } from "./useSubPanel";
import type { TerminalStore } from "./useTerminalStore";

/** A terminal paired with its (already-arrived) metadata. The hydration
 *  effect builds these by gating on the composed record having arrived on padi's
 *  `terminals` collection for every listed id, so `m` is always defined. `t` is
 *  the terminal-list row — just `{ id }`, derived from the collection's keys. */
type HydrationEntry = { t: { id: TerminalId }; m: TerminalMetadata };

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
    // Wait for the composed record to arrive (via `store.getMetadata`) for EVERY
    // listed terminal — hydration reads `parentId` and `subPanel` off the record
    // (since #806 the list snapshot no longer carries `meta`). `getMetadata`
    // returns `undefined` for a PARKED (restore-card) record as well as a
    // not-yet-arrived one, so this loop naturally waits out the parked set (which
    // `session.restore` consumes) and can never seed the view from a parked row or
    // a partial set. The reads are reactive, so the effect re-runs as values arrive.
    const joined: HydrationEntry[] = [];
    for (const t of existing) {
      const m = store.getMetadata(t.id);
      if (m === undefined) return;
      joined.push({ t, m });
    }
    // Seed only once at least one REAL (active/sleeping) terminal exists — the
    // initial live load, or once a restore has produced them. An all-parked reboot
    // never reaches here: the empty-vs-restore decision above returns first
    // (`terminalIds()` is empty).
    if (joined.length === 0) return;
    viewSeeded = true;
    hydrateFromTerminals(joined, fromServer?.activeTerminalId ?? null);
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
    // Re-arm the VIEW-STATE seed for THIS restore. `viewSeeded` latches true on
    // the first live load so a reconnect doesn't re-pan/re-seed the canvas — but an
    // in-session restore (the `recycleKaval` recycle→restore, no page reload) is
    // PRECISELY a re-seed event: it re-spawns every terminal under FRESH ids whose
    // client sub-panel state has never been seeded. Without this reset the
    // hydration effect below short-circuits on the stale latch and never runs
    // `hydrateFromTerminals` for the restored terminals, so a restored parent's
    // active sub-tab is never set and its split comes back HIDDEN. Clearing it here
    // lets the effect re-seed once the restored terminals arrive; it re-latches
    // true after seeding, so a later reconnect is still a no-op.
    viewSeeded = false;
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
      await activePadiRpc.surface.session.restore({
        resumeIds: options.resumeIds ? [...options.resumeIds] : undefined,
      });
      setSavedSession(null);
      // Faithful pre-W1 summary — "Restored N terminals, resumed M agents". The
      // restore card's `resumeIds` is the RESUMABLE opt-in set (EmptyState filters
      // to terminals with a resumable `restoreTarget`), so its size IS the resume
      // count; an absent set (the import path resumes all) counts the session's
      // resumable terminals directly.
      const resumed = options.resumeIds
        ? options.resumeIds.size
        : session.terminals.filter(
            (t) => resumableCommand(t.restoreTarget) !== null,
          ).length;
      toast.success(
        resumed > 0
          ? `Restored ${session.terminals.length} terminals, resumed ${resumed} agent${
              resumed > 1 ? "s" : ""
            }`
          : "Session restored",
        { id },
      );
    } catch (err) {
      toast.error(`Restore failed: ${(err as Error).message}`, { id });
      throw err;
    } finally {
      setIsRestoring(false);
    }
  }

  /** Explicit forfeit — the user chose "Start fresh" over the saved session.
   *  One server call discards the parked entries AND clears the saved session
   *  together (creating a terminal no longer forfeits implicitly, W1). On
   *  success the server pushes a `null` saved-session snapshot, which the
   *  re-fetch effect above folds into `savedSession` and dismisses the card;
   *  we also clear it optimistically so the card drops immediately. */
  async function handleForfeitSession() {
    const session = savedSession();
    if (!session) return;
    // Optimistic dismissal: the card is gone the moment the user commits.
    setSavedSession(null);
    await activePadiRpc.surface.session.forfeit({}).catch((err: Error) => {
      // Surface the failure and restore the card so the user can retry —
      // a caught error must not collapse silently to the empty state.
      setSavedSession(session);
      toast.error(`Failed to start fresh: ${err.message}`);
    });
  }

  return {
    // Loading is true until we can make an HONEST empty-vs-restore decision.
    // `store.terminalIds().length === 0` is NOT enough on its own — it reads 0 in
    // two very different situations, because `getMetadata` collapses "record not
    // yet arrived" and "record arrived-but-parked" into the same `undefined`:
    //   - a browser RELOAD, where the live terminals' records are merely in flight
    //     (we must keep loading — they're milliseconds away); and
    //   - a genuine REBOOT, where records arrive PARKED and the count stays 0 for
    //     good (we must show the restore card).
    // The metadata census (`recordPhases`) keeps those distinct: while any record
    // is still `awaited` we hold loading; once they've all settled (reboot → all
    // parked), `awaited` is 0 and we fall through to the saved-session cell, whose
    // ONE honest job is "is there a blob to offer?" for the genuinely-empty boot.
    // (The session cell used to double as a metadata-timing proxy here — it
    // resolves first, so it dropped the gate mid-flight and flashed the restore
    // card; the `recordPhases().awaited` term replaces that proxy.) When at least
    // one terminal's metadata has arrived (`terminalIds().length > 0`), the canvas
    // renders immediately — neither the census nor the session cell matters.
    isLoading: () =>
      store.listSub.pending() ||
      (store.terminalIds().length === 0 &&
        (store.recordPhases().awaited > 0 || savedSessionSub.pending())),
    savedSession,
    isRestoring,
    handleRestoreSession,
    handleForfeitSession,
  };
}
