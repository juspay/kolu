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

/** A live snapshot of the terminal set — the shape autosave persists. Exported
 *  so the producer (`snapshotSession` in terminals.ts) and the consumers
 *  (`saveSession` / `initSessionAutoSave`) reference one nominal contract
 *  instead of each re-spelling the inline shape. */
export interface SessionSnapshot {
  terminals: SavedTerminal[];
  activeTerminalId: string | null;
}

/** Save a session snapshot. Clears the session when no terminals remain;
 *  otherwise stamps `savedAt`. */
export function saveSession(snapshot: SessionSnapshot): void {
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
  writeSession(session);
}

/** Capture a live snapshot as the saved session, for the restart-capture path
 *  (B3.2's supervised restart). The **F1 receptacle** — it differs from a plain
 *  `saveSession` in two restart-specific ways:
 *
 *  1. **It cancels the pending autosave first, unconditionally.** The surface
 *     session cell's `onWrite` hook already cancels autosave on every write, but
 *     the cell **dedups** byte-identical writes (`equals`) — so a capture that
 *     happens to re-persist the current session would be short-circuited and its
 *     `onWrite` cancel skipped, leaving a pending `terminals:dirty` timer armed
 *     *before* the restart free to fire ~500 ms later with an empty snapshot and
 *     clobber the capture to null. Cancelling first makes the snapshot durable
 *     through the kill regardless of dedup. (The restart's own drain —
 *     `killAllTerminals` — fires no `terminals:dirty`, so it arms no new timer;
 *     this guards only the pre-existing one.)
 *
 *  2. **An empty snapshot PRESERVES the existing saved session — it does not
 *     clear it (F1).** A restart can be triggered when the live registry is
 *     empty: most importantly from a `dead` boot, where the daemon never came up
 *     so no terminals were ever restored, yet a saved session from a *previous*
 *     run is still on disk and is the only thing the restore card has to offer.
 *     Routing an empty snapshot through `saveSession` (empty→null) would erase
 *     that restore data BEFORE the recycle — the exact "never kill-then-pray"
 *     data loss this whole sequence exists to prevent. So an empty capture only
 *     cancels the stale timer and leaves the saved session untouched; a non-empty
 *     capture persists normally (with the `savedAt` stamp). */
export function setSavedSessionFromSnapshot(snapshot: SessionSnapshot): void {
  cancelPendingAutosave();
  // Empty live registry → there is nothing fresher to persist; keep whatever
  // session is already saved rather than clearing the user's only restore data.
  if (snapshot.terminals.length === 0) return;
  saveSession(snapshot);
}

// --- Auto-save: terminal lifecycle → session persistence (decoupled via publisher) ---

/** The registered live-snapshot provider — set once by `initSessionAutoSave`.
 *  Held at module scope so BOTH the debounced autosave loop and the synchronous
 *  `flushSessionNow` read the one source of truth (`snapshotSession`) without
 *  either importing `terminals.ts` (which imports `terminalEndpoint/local.ts` —
 *  a static `snapshotSession` import there would form an import cycle biome's
 *  `noImportCycles` rejects). `session.ts` imports neither, so it is the cycle-
 *  free home for "persist the current snapshot". */
let snapshotProvider: (() => SessionSnapshot) | null = null;

/** Persist the CURRENT session snapshot synchronously, right now — bypassing the
 *  500 ms autosave debounce. The persist-before-kill durability seam (F1):
 *  `sleepTerminal` stages a sleeping record then calls this BEFORE killing the
 *  PTY, so a crash in the kill window cannot lose both the live terminal and the
 *  sleeping record. Reuses the registered `snapshotSession` provider so there is
 *  one definition of what a session snapshot contains. No-op (with a loud log) if
 *  called before `initSessionAutoSave` has wired the provider — which only
 *  happens if boot order regresses, a fail-loud condition, not a silent skip. */
export function flushSessionNow(): void {
  if (!snapshotProvider) {
    log.error(
      "flushSessionNow called before initSessionAutoSave wired the snapshot provider",
    );
    return;
  }
  saveSession(snapshotProvider());
}

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
 *  Also registers the snapshot provider for `flushSessionNow` (the synchronous
 *  persist-before-kill path) so both share one snapshot definition.
 *
 *  Assumes `saveSession` is synchronous (it is — `writeSession` does sync
 *  `store.set` + sync publish). If anyone makes it async, add an in-flight
 *  guard so a new schedule can't race an unfinished write. */
export function initSessionAutoSave(snapshot: () => SessionSnapshot): void {
  snapshotProvider = snapshot;
  void (async () => {
    try {
      for await (const _ of terminalsDirtyChannel.subscribe(undefined)) {
        if (saveTimer) continue;
        saveTimer = setTimeout(() => {
          saveTimer = undefined;
          saveSession(snapshot());
        }, 500);
      }
    } catch (err) {
      log.error({ err }, "session auto-save subscription failed");
    }
  })();
}
