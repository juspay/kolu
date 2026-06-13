/**
 * Saved-session persistence — save/restore terminal sessions across restarts.
 *
 * Owns the `session` key of the shared conf store. Writers publish on the
 * `session:changed` channel so the client's `session.get` live query stays
 * current. The autosave loop is driven by the `terminals:dirty` control-flow
 * channel (distinct from the `session:changed` *content* channel) — every
 * terminal/meta mutation fires `terminals:dirty`, this module throttles and
 * then persists.
 */

import type { SavedSession, SavedTerminal } from "kolu-common/surface";
import { log } from "./log.ts";
import { terminalsDirtyChannel } from "./publisher.ts";
import { store } from "./state.ts";
import { surfaceCtx } from "./surfaceCtx.ts";

/** Pending autosave timer — declared at module top so `setSavedSession`
 *  and the surface cell's `store.set` adapter can cancel it (see comment
 *  on `cancelPendingAutosave` for the race). */
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Restore-card terminals that have NO live PTY but must NOT be lost — the
 *  remainder of a PARTIAL boot-adopt reconcile (a server-only redeploy kept
 *  some PTYs but not all). They live only on the restore card, which the client
 *  surfaces from the empty-canvas state; while adopted survivors occupy the
 *  canvas they are hidden, and the survivors' own `terminals:dirty` autosaves
 *  would otherwise re-snapshot only the LIVE terminals and delete these from
 *  disk. The autosave loop unions this set into every snapshot so it can never
 *  drop them. It is cleared when the remainder is no longer pending: a client
 *  restore success signals `session.restored` → `clearPendingRestoreCard` (the
 *  session cell is read-only on the client, so the restore can't clear it by
 *  writing the cell); a server-side restart capture replaces it via
 *  `setSavedSession`. This is the fail-closed guard that keeps the partial
 *  remainder durable until a non-empty-canvas restore affordance lands (R-2). */
let pendingRestoreCard: SavedTerminal[] = [];

/** Register the partial-reconcile remainder so autosave can't delete it (see
 *  `pendingRestoreCard`). Replaces any prior set — each reconcile recomputes the
 *  whole remainder. An empty array clears it. */
export function setPendingRestoreCard(terminals: SavedTerminal[]): void {
  pendingRestoreCard = terminals;
}

/** Set while the autosave loop's own `saveSession` write is in flight so the
 *  session cell's `onWrite` hook can tell its OWN union write apart from an
 *  EXTERNAL one (a client restore success, a test fixture, the reattach paths).
 *  Only external writes clear the pending remainder — the autosave loop must NOT
 *  clear it, or the very first union write would drop the protection and the next
 *  survivors-only snapshot would delete the remainder. See `onSessionCellWrite`. */
let inAutosaveWrite = false;

/** Called by the session cell's `onWrite` hook on EVERY write to the cell. An
 *  external write (the reattach capture, a `test__set` fixture) supersedes the
 *  partial-reconcile remainder, so it clears `pendingRestoreCard`; the autosave
 *  loop's own union write (guarded by `inAutosaveWrite`) must not. The client
 *  restore path does NOT reach here (the session cell is read-only on the
 *  client — see `clearPendingRestoreCard` / the `session.restored` RPC). */
export function onSessionCellWrite(): void {
  if (inAutosaveWrite) return;
  pendingRestoreCard = [];
}

/** Drop the partial-reconcile pending restore card. Called by the
 *  `session.restored` RPC handler when the client reports a successful restore:
 *  the restore created fresh terminals with NEW ids, so the original remainder
 *  is no longer pending and must NOT be re-unioned into future autosaves (it
 *  would resurrect the already-restored originals as a phantom restore card once
 *  the new terminals close). Idempotent — a no-op when nothing is pending. */
export function clearPendingRestoreCard(): void {
  pendingRestoreCard = [];
}

/** Merge the live snapshot with the pending restore-card remainder, keeping the
 *  live entry when a terminal appears in both (a restored survivor is live and
 *  authoritative). The result is what autosave persists, so the partial
 *  remainder rides every autosave instead of being snapshotted away. */
function unionWithPendingRestore(snapshot: {
  terminals: SavedTerminal[];
  activeTerminalId: string | null;
}): { terminals: SavedTerminal[]; activeTerminalId: string | null } {
  if (pendingRestoreCard.length === 0) return snapshot;
  const liveIds = new Set(snapshot.terminals.map((t) => t.id));
  const survivingPending = pendingRestoreCard.filter((t) => !liveIds.has(t.id));
  if (survivingPending.length === 0) return snapshot;
  return {
    terminals: [...snapshot.terminals, ...survivingPending],
    activeTerminalId: snapshot.activeTerminalId,
  };
}

/** Cancel any pending `saveSession([])` autosave callback that's been
 *  armed by a recent `terminalsDirtyChannel` event but hasn't fired yet.
 *
 *  Called both from the named `setSavedSession` and from the surface
 *  session cell's `store.set` adapter (see `surface.ts`). Wiring it into
 *  the cell adapter is what extends the cancel to the surface's
 *  `test__set` verb — which the e2e harness uses to seed scenarios,
 *  and which would otherwise be clobbered ~500 ms later by a stale
 *  killAll-time dirty event.
 *
 *  Harmless on the autosave loop's own write path: by the time the
 *  loop's callback reaches `cells.session.set`, the callback has
 *  already cleared `saveTimer` itself (see `initSessionAutoSave`), so
 *  this is a no-op. Subsequent dirty events received after the callback
 *  exits arm a fresh timer that is *not* cancelled — autosave keeps
 *  working as designed.
 *
 *  See `initSessionAutoSave` for the autosave loop, and the original
 *  e2e race description on `setSavedSession` (#320 / cycle 6 of
 *  `docs/flaky-tests-ralph-report-2.md`). */
export function cancelPendingAutosave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
}

/** Write the session blob (or clear it). The surface owns persist+publish. */
function writeSession(next: SavedSession | null): void {
  surfaceCtx.cells.session.set(next);
}

/** Save a session snapshot. Clears the session when no terminals remain. */
export function saveSession(snapshot: {
  terminals: SavedTerminal[];
  activeTerminalId: string | null;
}): void {
  if (snapshot.terminals.length === 0) {
    writeSession(null);
    return;
  }
  writeSession({
    terminals: snapshot.terminals,
    activeTerminalId: snapshot.activeTerminalId,
    savedAt: Date.now(),
  });
}

/** Get the saved session, or null if none exists. */
export function getSavedSession(): SavedSession | null {
  const session = store.get("session");
  if (!session || session.terminals.length === 0) return null;
  return session;
}

/** Clear the saved session (e.g. after successful restore). */
export function clearSavedSession(): void {
  writeSession(null);
}

/** Set the saved session directly (used by test harness and session tests).
 *
 *  Also cancels any pending autosave timer so a stale `terminals:dirty`
 *  event scheduled before this call cannot fire after it and clobber the
 *  manually-set session with an empty-snapshot null. The race surfaces in
 *  e2e: the test scenario's Before hook drains terminals, then posts a
 *  fresh saved session, then loads the page; in between, a lingering
 *  provider event from a previous scenario's drained terminal fires
 *  `terminals:dirty`, the autosave callback runs 500ms later with an empty
 *  terminal snapshot, and `saveSession([])` rewrites the session to null —
 *  the restore card disappears mid-scenario. */
export function setSavedSession(session: SavedSession | null): void {
  cancelPendingAutosave();
  // An explicit server-side write supersedes the partial-reconcile remainder:
  // the restart capture writes the freshly captured session (a new authoritative
  // set), so the old pending set is stale — drop it, or it would leak back into a
  // later autosave union. `reconcileSession` re-registers a fresh set AFTER its
  // own `setSavedSessionFromSnapshot` write when the new reconcile is still
  // partial. (Note the CLIENT restore success does NOT reach here — the session
  // cell is read-only on the client; it clears the remainder via the
  // `session.restored` RPC → `clearPendingRestoreCard` instead.)
  pendingRestoreCard = [];
  writeSession(session);
}

/** Persist a `{terminals, activeTerminalId}` snapshot as the saved session,
 *  owning the empty→null + `savedAt: Date.now()` rule in one place — with
 *  `setSavedSession`'s autosave-cancel semantics. The B3 reattach paths (boot
 *  reconcile's restore card and the restart capture) build a snapshot under a
 *  recycle and must win the autosave race; they call THIS rather than re-inlining
 *  the same mapping. (`saveSession` keeps its own no-cancel autosave path.) */
export function setSavedSessionFromSnapshot(snapshot: {
  terminals: SavedTerminal[];
  activeTerminalId: string | null;
}): void {
  setSavedSession(
    snapshot.terminals.length > 0 ? { ...snapshot, savedAt: Date.now() } : null,
  );
}

// --- Auto-save: terminal lifecycle → session persistence (decoupled via publisher) ---

/** Wire up throttled session save from terminal change events. Called once at startup.
 *
 *  Leading-edge throttle: the first dirty event in a quiet period schedules
 *  a save 500ms later; subsequent events during that window are absorbed
 *  into the same upcoming snapshot (because `snapshot()` runs inside the
 *  callback, not at schedule time). A trailing-edge debounce — the obvious
 *  alternative — starves under bursty inputs: the Claude transcript
 *  watcher fires every 150ms while an agent is streaming, which would
 *  reset the timer indefinitely and the save would never fire.
 *
 *  Assumes `saveSession` is synchronous (it is — `writeSession` does sync
 *  `store.set` + sync publish). If anyone makes it async, add an in-flight
 *  guard so a new schedule can't race an unfinished write. */
export function initSessionAutoSave(
  snapshot: () => {
    terminals: SavedTerminal[];
    activeTerminalId: string | null;
  },
): void {
  void (async () => {
    try {
      for await (const _ of terminalsDirtyChannel.subscribe(undefined)) {
        if (saveTimer) continue;
        saveTimer = setTimeout(() => {
          saveTimer = undefined;
          // Union in the partial-reconcile remainder so a survivors-only
          // snapshot can't delete the restore-card terminals that have no live
          // PTY (see `pendingRestoreCard`). Guard the write so the session
          // cell's `onWrite` hook does NOT mistake this for an external write
          // and clear the very remainder we're preserving (see
          // `onSessionCellWrite`).
          inAutosaveWrite = true;
          try {
            saveSession(unionWithPendingRestore(snapshot()));
          } finally {
            inAutosaveWrite = false;
          }
        }, 500);
      }
    } catch (err) {
      log.error({ err }, "session auto-save subscription failed");
    }
  })();
}
