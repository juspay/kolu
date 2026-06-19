/**
 * Sleeping-terminals persistence — the on-demand twin of `session.ts`.
 *
 * Owns the `sleepingTerminals` key of the shared conf store: a list of slept
 * terminal trees, each a `SavedTerminal[]` captured exactly like a session of
 * one tree. Disjoint from `session` so the live-session autosave never clobbers
 * it; durable across restarts, rehydrated AS sleeping (the client renders the
 * cell, never auto-wakes it).
 *
 * Writes are explicit (`terminal.sleep` / `terminal.wake`), not debounced — so
 * unlike `session.ts` there is no autosave loop and no dirty-channel wiring.
 */

import type { SleepingTerminal, TerminalId } from "kolu-common/surface";
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
 *  "persist before kill, never kill-then-pray". No-op if `id` isn't live. */
export function sleepTerminal(id: TerminalId): void {
  const terminals = snapshotTerminal(id);
  if (terminals.length === 0) return;
  const record: SleepingTerminal = {
    id: crypto.randomUUID(),
    terminals,
    sleptAt: Date.now(),
  };
  write([...getSleepingTerminals(), record]);
}

/** Remove a sleeping record by its stable id — called once the client has
 *  respawned it through the session-restore protocol. Idempotent. */
export function wakeTerminal(sleepId: string): void {
  write(getSleepingTerminals().filter((r) => r.id !== sleepId));
}
