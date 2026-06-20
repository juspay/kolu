/**
 * Sleeping-terminals persistence — the on-demand twin of `session.ts`.
 *
 * Owns the `sleepingTerminals` key of the shared conf store: a list of slept
 * terminal trees, each a `SavedTerminal[]` captured exactly like a session of
 * one tree. Disjoint from `session` so the live-session autosave never clobbers
 * it; durable across restarts, rehydrated AS sleeping (the client renders the
 * cell, never auto-wakes it).
 *
 * Writes are explicit (`terminal.sleep` / `terminal.dropSleeping` /
 * `terminal.setSleepingLayout`), not debounced — so unlike `session.ts` there
 * is no autosave loop and no dirty-channel wiring.
 */

import type {
  CanvasLayout,
  SleepingTerminal,
  TerminalId,
} from "kolu-common/surface";
import { store } from "./state.ts";
import { surfaceCtx } from "./surfaceCtx.ts";
import { snapshotTerminal } from "./terminals.ts";

/** Current sleeping records (insertion order = sleep order). */
export function getSleepingTerminals(): SleepingTerminal[] {
  return store.get("sleepingTerminals");
}

/** Persist via the surface cell — it owns the conf write + the publish so the
 *  client's `sleepingTerminals.get` live query stays current. Accessed inside
 *  the function body (not at module top) because `surfaceCtx` is a late-bound
 *  proxy that throws before boot. */
function write(next: SleepingTerminal[]): void {
  surfaceCtx.cells.sleepingTerminals.set(next);
}

/** Capture a terminal tree (the terminal + its splits) into the sleeping store.
 *  Persist-ONLY: the client tears down the live terminal AFTER this resolves
 *  (via the normal kill path), so a crash mid-sleep never loses the record —
 *  "persist before kill, never kill-then-pray". No-op if `id` isn't live.
 *
 *  The record id IS the original top-level terminal id (not a fresh UUID): the
 *  first-class Tile contract keys a sleeping tile by the id of the terminal it
 *  was, so its canvas position, MRU rank, and active-selection carry over the
 *  moment it sleeps (see `client/src/tile/tileContent.ts`). */
export function sleepTerminal(id: TerminalId): void {
  const terminals = snapshotTerminal(id);
  if (terminals.length === 0) return;
  const record: SleepingTerminal = {
    id,
    terminals,
    sleptAt: Date.now(),
  };
  // Idempotent by id: a double-click (or a repeated `terminal.sleep` before the
  // client's live kill lands) must not append a SECOND record with the same id.
  // Two records of one id map to duplicate `tileIds` on the client while
  // `contentOf` only finds the first — a state/layout split. Replace in place
  // (re-capturing the latest live metadata) instead of growing the list. The
  // record id IS the original terminal id, so this is a stable key.
  const existing = getSleepingTerminals();
  const idx = existing.findIndex((r) => r.id === id);
  if (idx === -1) {
    write([...existing, record]);
    return;
  }
  write(existing.map((r, i) => (i === idx ? record : r)));
}

/** Remove a sleeping record by its id — called once the client has respawned it
 *  through the session-restore protocol (or to discard it without respawning).
 *  Idempotent. */
export function dropSleeping(id: TerminalId): void {
  write(getSleepingTerminals().filter((r) => r.id !== id));
}

/** Persist a sleeping tile's dragged/resized position onto the record's top
 *  terminal, so the layout survives reload + restart like a live tile's. */
export function setSleepingLayout(id: TerminalId, layout: CanvasLayout): void {
  write(
    getSleepingTerminals().map((r) =>
      r.id === id
        ? {
            ...r,
            // The top terminal is the one whose id IS the record id — the same
            // root-identification rule the client's `topTerminal` accessor uses,
            // anchored on record.id (not parentId-absence) so server and client
            // can never disagree on which entry the layout writes onto.
            terminals: r.terminals.map((t) =>
              t.id === r.id ? { ...t, canvasLayout: layout } : t,
            ),
          }
        : r,
    ),
  );
}
