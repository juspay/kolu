/** WHICH host's details popover is open — one at a time, hoisted to a module
 *  singleton so every opener drives the one signal:
 *
 *   - the host tab's connection pip (`HostSelectorStrip`), which toggles it;
 *   - the tab's agent-distro mark (`AgentDistroHostMark`), which opens it on
 *     the machine it is about;
 *   - a machine's name on Settings' Agents line (`AgentsFleetLine`), which
 *     opens that machine's details — the host-scoped facts live there now.
 *
 *  The popover itself still MOUNTS inside the strip, anchored to the chip it
 *  belongs to, so a key for a host that is not in the pool paints nothing; the
 *  strip clears a key whose host leaves membership.
 *
 *  Singleton pattern (per `.claude/rules/solidjs.md` — state per domain): the
 *  signal is created once at module scope; every consumer imports the same
 *  accessors rather than threading props through the shell. */

import { createSelector, createSignal } from "solid-js";

const [openHostKey, setOpenHostKey] = createSignal<string | null>(null);

/** The open host's CANONICAL encoded key, or `null`. */
export { openHostKey };

/** Is `encKey`'s popover the open one? A selector, so a chip re-renders only
 *  when its own answer changes. */
export const isHostDiagnosticsOpen: (encKey: string) => boolean =
  createSelector(openHostKey);

/** Open `encKey`'s details (an agents mark, a machine's name in Settings). */
export function openHostDiagnostics(encKey: string): void {
  setOpenHostKey(encKey);
}

export function closeHostDiagnostics(): void {
  setOpenHostKey(null);
}

/** The pip's own action: open this host's details, or close them if they are
 *  the ones showing. */
export function toggleHostDiagnostics(encKey: string): void {
  setOpenHostKey((current) => (current === encKey ? null : encKey));
}
