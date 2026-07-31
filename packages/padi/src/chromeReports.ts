/** Chrome REPORTS — facts the app chrome tells padi about itself, held as
 *  single shared values with last-write-wins across connected clients (two
 *  windows whose focus has diverged agree on whichever reported last).
 *
 *  A leaf on purpose: it imports nothing of the terminal lifecycle, so the
 *  lifecycle (and the decisions the lifecycle runs, e.g. `newTerminalPolicy.ts`)
 *  can read a report without an import cycle. `terminals.ts` re-exports the
 *  whole surface so existing callers keep one import path.
 */

import type {
  NewTerminalPolicy,
  TerminalId,
} from "@kolu/terminal-vocab/schema";
import { notifyDirty } from "./publisher.ts";

// The terminal the user was last in. TWO readers: the session snapshot, and
// `createTerminal`'s `inherit` theme resolution (#2045).
let activeTerminalId: TerminalId | null = null;

/** Read the client-reported active terminal id. */
export function getActiveTerminalId(): TerminalId | null {
  return activeTerminalId;
}

/** Store which terminal is active (reported by the client).
 *  Only emits session:changed when a terminal is actually selected —
 *  null (no selection, e.g. client reconnect) must not trigger
 *  auto-save because snapshotSession() may return an empty terminal
 *  list at that point, which would clear the saved session. */
export function setActiveTerminalId(id: TerminalId | null): void {
  activeTerminalId = id;
  if (id !== null) notifyDirty();
}

/** Restore the active-terminal marker from a session being adopted at boot
 *  (B3.3), WITHOUT firing `terminals:dirty` — unlike `setActiveTerminalId`, the
 *  client-reported setter. The boot converges the saved session explicitly right
 *  after, so this must not arm a competing autosave; it only seeds the value
 *  `snapshotSession()` will read so the adopted session keeps its active tile. */
export function restoreActiveTerminalId(id: TerminalId | null): void {
  activeTerminalId = id;
}

// The app chrome's last new-terminal POLICY report. `null` = ABSENT, not a
// default: a padi nobody has opened a browser against has no user preference to
// honour, and must not invent one that could drift from kolu-common's.
let newTerminalPolicy: NewTerminalPolicy | null = null;

/** Record the app chrome's new-terminal policy report (`chrome.setNewTerminalPolicy`). */
export function setNewTerminalPolicy(policy: NewTerminalPolicy): void {
  newTerminalPolicy = policy;
}

/** The last reported new-terminal policy, or `null` if no chrome has reported. */
export function getNewTerminalPolicy(): NewTerminalPolicy | null {
  return newTerminalPolicy;
}

/** Clear the reported policy — TEST ONLY. A module global that outlives a
 *  `describe` would otherwise leak a policy nobody set into the next one. */
export function __resetNewTerminalPolicyForTest(): void {
  newTerminalPolicy = null;
}
