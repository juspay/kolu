/** Armed plain-directory browse roots — consent expressed IN THE FLOW.
 *
 *  Outside a git repo the Code tab renders a single collapsed root node for the
 *  terminal's cwd; nothing is listed or watched until the user clicks it.
 *  Clicking IS the approval, recorded here per (host, terminal) for this
 *  browser session only — deliberately NOT persisted and NOT a settings
 *  surface (no allowlist, no preference; see the philosophy doc's
 *  auto-detected-zero-setup principle). The stored value is the ROOT the user
 *  approved: a later `cd` to a different directory yields a different root, so
 *  the read side compares against the live cwd and the consent naturally
 *  retires with the directory it was given for.
 *
 *  Inside a git repo this store is never consulted — git's repoRoot is the
 *  browse root, exactly as before. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createStore } from "solid-js/store";

const [armed, setArmed] = createStore<Record<string, string>>({});

/** `\0` separator: collision-safe without embedding a printable delimiter a
 *  host key or terminal id could contain (the `composerAnchor` precedent). */
const armKey = (host: HostKey, terminalId: TerminalId): string =>
  `${encodeHostKey(host)}\0${terminalId}`;

/** Record the user's click on the collapsed root node: browse `root` for this
 *  terminal, for the rest of the session (or until its cwd changes). */
export function armBrowseRoot(
  host: HostKey,
  terminalId: TerminalId,
  root: string,
): void {
  setArmed(armKey(host, terminalId), root);
}

/** The root this terminal's user approved, or `undefined`. Callers compare it
 *  against the terminal's LIVE cwd — a stale approval (the terminal has since
 *  `cd`'d away) must read as un-armed. Fine-grained reactive per key. */
export function armedBrowseRoot(
  host: HostKey,
  terminalId: TerminalId,
): string | undefined {
  return armed[armKey(host, terminalId)];
}

/** The ONE stale-vs-live fold every consumer must apply, spelled once: the
 *  armed root, but only while it still matches the terminal's live `cwd` —
 *  otherwise null (a different directory is a different approval). Entries are
 *  deliberately never reaped on terminal/host removal: each is one short
 *  string per terminal armed this session, and reaping would couple this leaf
 *  to the terminal lifecycle for a leak bounded by a session's arm count. */
export function armedRootMatching(
  host: HostKey,
  terminalId: TerminalId,
  cwd: string | null | undefined,
): string | null {
  if (cwd == null) return null;
  return armedBrowseRoot(host, terminalId) === cwd ? cwd : null;
}
