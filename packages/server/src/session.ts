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
export function initSessionAutoSave(snapshot: () => SessionSnapshot): void {
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
