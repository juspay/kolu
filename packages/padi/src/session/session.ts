/**
 * Saved-session persistence — save/restore terminal sessions across restarts.
 *
 * Owns the `session` key of the shared conf store. Writers publish on the
 * `session:changed` channel so the client's `session.get` live query stays
 * current. WHEN to auto-persist (the throttle, the restart freeze, the parked
 * suppression) is the {@link AutosaveGate}'s concern (`autosaveGate.ts`), which
 * drives `saveSession` from the `terminals:dirty` pulse; this module owns only the
 * blob read/write, and the named writers cancel a pending autosave through the gate.
 */

import { cancelPendingAutosave } from "./autosaveGate.ts";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import { hasParkedTerminals } from "../terminal-registry.ts";
import type { SavedSession, SavedTerminal } from "../vocab.ts";

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
 *  (`saveSession` / the `AutosaveGate`) reference one nominal contract instead of
 *  each re-spelling the inline shape. */
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
