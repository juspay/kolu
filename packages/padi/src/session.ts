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

import { log } from "./log.ts";
import { padiSurfaceCtx } from "./padiSurfaceCtx.ts";
import { terminalsDirtyChannel } from "./publisher.ts";
import { hasParkedTerminals } from "./terminal-registry.ts";
import type { SavedSession, SavedTerminal } from "./vocab.ts";

/** Pending autosave timer — declared at module top so `setSavedSession`
 *  and the surface cell's `store.set` adapter can cancel it (see comment
 *  on `cancelPendingAutosave` for the race). */
let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Cancel any pending `saveSession([])` autosave callback that's been
 *  armed by a recent `terminalsDirtyChannel` event but hasn't fired yet.
 *
 *  Called both from the named `setSavedSession` and from padi's session
 *  cell `onWrite` hook (see `servePadi.ts`). Wiring it into
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

/** True while a daemon RESTART is in its critical section (capture→drain→park). The
 *  autosave callback bails on it, so a `terminals:dirty` the drain fires (the PTYs
 *  exiting as the daemon is killed) can't arm a save that runs in the drain→park GAP
 *  — the window where the registry is empty AND no parked entries exist yet, so the
 *  `hasParkedTerminals()` guard is inert and `saveSession([])` would null the
 *  just-captured session before park runs (the zest restart-path clobber). Park then
 *  seeds the parked entries and `hasParkedTerminals()` takes over. */
let restartInFlight = false;

/** Freeze the autosave for a restart's critical section — set at `capture` (before
 *  the drain can arm anything), lifted after `park` (see `restartLocalDaemon`). */
export function freezeSessionForRestart(): void {
  restartInFlight = true;
}

/** Lift the restart freeze. Safe to call on the restart's success OR failure path;
 *  a failed restart pairs it with `cancelPendingAutosave` so a drain-armed timer
 *  can't clobber the captured session after the freeze lifts. */
export function unfreezeSessionForRestart(): void {
  restartInFlight = false;
}

/** Write the session blob (or clear it). The surface owns persist+publish. */
function writeSession(next: SavedSession | null): void {
  // DIAGNOSTIC (log-only): every write is traced; a destructive clear (next=null)
  // is a WARN carrying the call stack so it is never silent. `grep session-trace`.
  if (next === null) {
    log.warn(
      { stack: new Error("session clear").stack },
      "session-trace writeSession: clearing session (next=null)",
    );
  } else {
    log.info(
      { terminals: next.terminals.length },
      `session-trace writeSession: ${next.terminals.length} terminals`,
    );
  }
  padiSurfaceCtx.cells.session.set(next);
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
    log.warn(
      { terminals: 0 },
      "session-trace saveSession: empty snapshot → clearing (empty→null)",
    );
    writeSession(null);
    return;
  }
  log.info(
    { terminals: snapshot.terminals.length },
    `session-trace saveSession: writing ${snapshot.terminals.length} terminals`,
  );
  writeSession({
    terminals: snapshot.terminals,
    activeTerminalId: snapshot.activeTerminalId,
    savedAt: Date.now(),
  });
}

/** Get the saved session, or null if none exists. Reads the session through
 *  padi's OWN surface cell (`padiSurfaceCtx.cells.session`) — the framework-owned
 *  handle whose backing (`servePadi.ts`) reads the injected conf store DIRECTLY
 *  and normalizes empty→null. This read is NON-RECURSIVE by construction: the
 *  cell's `get` reads the store, never `getSavedSession`, so this call resolves in
 *  one hop (the mutual recursion that would blow the boot stack is unspellable).
 *  The conf-store STORAGE stays kolu-server's source of truth until W2.2. */
export function getSavedSession(): SavedSession | null {
  const session = padiSurfaceCtx.cells.session.get();
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
 *     cancels the stale timer and leaves the saved session untouched.
 *
 *  3. **A restore-PENDING snapshot MERGES rather than shrinks (no-shrink).** When
 *     parked registry entries exist ({@link hasParkedTerminals}), a restore is
 *     pending: N saved records on disk stood up as N parked entries, and
 *     `snapshotSession` FILTERS parked entries OUT (terminals.ts). Post-cutover a
 *     `lifecycle.create` no longer forfeits that pending set (servePadi.ts, "PATH
 *     B"), so a user can hold N restore-pending terminals AND a fresh live one at
 *     once — and the parked-excluding snapshot then names ONLY the live terminal.
 *     Persisting it alone would OVERWRITE the N-record on-disk session with a
 *     1-record one, and the following `parkSavedSession` would read the shrunken
 *     blob and silently, unrecoverably drop the N pending terminals. So when a
 *     restore is pending we persist the UNION of the on-disk records and the live
 *     snapshot, keyed by id with the LIVE capture winning a collision (a terminal
 *     an in-flight restore already flipped parked→active, whose re-persist has not
 *     landed when the capture runs). The post-recycle restore then offers BOTH the
 *     pending set AND the live terminal, each in its freshest state. This is the
 *     capture/drain-path twin of the autosave loop's `hasParkedTerminals()` skip,
 *     which likewise refuses to shrink a restore-pending blob.
 *
 *  Otherwise a non-empty capture with no restore pending persists normally
 *  (replacing the on-disk blob, with the `savedAt` stamp). */
export function setSavedSessionFromSnapshot(snapshot: SessionSnapshot): void {
  cancelPendingAutosave();
  // Empty live registry → there is nothing fresher to persist; keep whatever
  // session is already saved rather than clearing the user's only restore data.
  if (snapshot.terminals.length === 0) {
    log.info(
      { snapshot: 0 },
      "session-trace capture: snapshot=0 → empty-preserve early-return (existing session left intact)",
    );
    return;
  }
  // Restore pending (parked entries) → MERGE, never shrink. `snapshotSession`
  // excluded the parked entries, so persisting it alone would drop the pending
  // restore records the on-disk blob still holds. Union the on-disk records with
  // the live snapshot, LIVE wins on an id collision, so the merged blob is a
  // superset of BOTH — no restore-pending terminal is lost, and the live terminal
  // joins the post-recycle restore.
  if (hasParkedTerminals()) {
    const saved = getSavedSession();
    const savedTerminals = saved?.terminals ?? [];
    const liveIds = new Set(snapshot.terminals.map((t) => t.id));
    const merged: SessionSnapshot = {
      terminals: [
        // On-disk records the live capture does NOT re-name (the still-pending
        // restore), then the live snapshot (the fresh state of what's on the
        // canvas — it wins any id collision by coming last / filtering the disk copy).
        ...savedTerminals.filter((t) => !liveIds.has(t.id)),
        ...snapshot.terminals,
      ],
      // The live focus wins the active marker; fall back to the saved marker when
      // the capture had no active of its own.
      activeTerminalId:
        snapshot.activeTerminalId ?? saved?.activeTerminalId ?? null,
    };
    log.info(
      {
        onDisk: savedTerminals.length,
        live: snapshot.terminals.length,
        merged: merged.terminals.length,
      },
      `session-trace capture: restore pending → merged union (${merged.terminals.length} records, no shrink)`,
    );
    saveSession(merged);
    return;
  }
  log.info(
    { snapshot: snapshot.terminals.length },
    `session-trace capture: snapshot=${snapshot.terminals.length} → persisting`,
  );
  saveSession(snapshot);
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
          // A restore PENDING (parked entries stand in for the saved session on
          // disk) freezes the blob: `snapshot()` excludes parked records
          // (`snapshotSession` skips them), so persisting it here would SHRINK the
          // saved session — destroying the restore source of truth while the user
          // still has terminal activity (creating/closing a fresh terminal, agent
          // churn) that arms this autosave (PATH B). The parked entries ARE the
          // "restore pending" marker; the blob stays put until `session.restore`
          // consumes it or the user forfeits. Once resolved (no parked left), the
          // autosave resumes and a genuine user close still clears normally.
          const restart = restartInFlight;
          const parked = hasParkedTerminals();
          const snap = snapshot();
          log.info(
            { restart, parked, snapshot: snap.terminals.length },
            `session-trace autosave: restart=${restart} parked=${parked} snapshot=${snap.terminals.length}`,
          );
          // A restart in flight freezes the blob across its drain→park gap (the
          // registry is transiently empty there and no parked entries exist yet, so
          // the parked guard is still inert). Checked FIRST — this is the window a
          // plain `hasParkedTerminals()` misses.
          if (restart) {
            log.info({}, "session-trace autosave: skipped (restart in flight)");
            return;
          }
          if (parked) {
            log.info({}, "session-trace autosave: skipped (parked)");
            return;
          }
          log.info(
            { terminals: snap.terminals.length },
            `session-trace autosave: writing ${snap.terminals.length}`,
          );
          saveSession(snap);
        }, 500);
      }
    } catch (err) {
      log.error({ err }, "session auto-save subscription failed");
    }
  })();
}
