/** The Code tab's BROWSE ROOT — what directory the tree is rooted at, whether
 *  git is the authority for it, and (outside git) whether the user has consented
 *  to browsing it.
 *
 *  ── The consent store ───────────────────────────────────────────────────────
 *  Outside a git repo the Code tab renders a single collapsed root node for the
 *  terminal's cwd; nothing is listed or watched until the user clicks it.
 *  Clicking IS the approval, recorded here per (host, terminal, cwd) for this
 *  browser session only — deliberately NOT persisted and NOT a settings surface
 *  (no allowlist, no preference; see the philosophy doc's
 *  auto-detected-zero-setup principle).
 *
 *  The cwd is in the KEY, not in the value: consent is for a DIRECTORY, so a
 *  later `cd` elsewhere must read as un-armed. With the cwd in the value that
 *  was a comparison every reader had to remember to apply (and a raw accessor
 *  was exported beside the fold, which made forgetting it expressible); in the
 *  key, a stale approval is simply a lookup miss. Entries are deliberately never
 *  reaped on terminal/host removal: each is one short string per directory armed
 *  this session, and reaping would couple this leaf to the terminal lifecycle
 *  for a leak bounded by a session's arm count.
 *
 *  ── The root derivation ─────────────────────────────────────────────────────
 *  `browseRootOf` is the ONE place "what is this terminal's browse root, and is
 *  git its authority" is computed. It used to be spelled three times — in
 *  `CodeTab` off `props.meta`, in `hostCodeTab` off `store.active().meta`, and a
 *  third bare `meta?.git` test in the file-content facade — over what is
 *  literally the same value (`App.tsx` passes `store.active().meta` down). Three
 *  derivations of one fact means an unenforced coupling invariant: if the view
 *  decides "plain root" while the query world decides "git root", the tab paints
 *  a tree from one query while the other idles and the file read rides the wrong
 *  pulse. One function, three readers. */

import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { TerminalMetadata } from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
import { createStore } from "solid-js/store";

const [armed, setArmed] = createStore<Record<string, true>>({});

/** `\0` separator: collision-safe without embedding a printable delimiter a
 *  host key, terminal id or path could contain (the `composerAnchor`
 *  precedent). */
const armKey = (host: HostKey, terminalId: TerminalId, cwd: string): string =>
  `${encodeHostKey(host)}\0${terminalId}\0${cwd}`;

/** Record the user's click on the collapsed root node: browse `cwd` for this
 *  terminal, for the rest of the session (a `cd` elsewhere is a different key,
 *  so it needs its own click). */
export function armBrowseRoot(
  host: HostKey,
  terminalId: TerminalId,
  cwd: string,
): void {
  setArmed(armKey(host, terminalId, cwd), true);
}

/** The Code tab's root, and which authority owns it:
 *
 *   - `git`      — a repo root; every git-only surface (diff modes, status
 *                  overlay, the ignored toggle) keys on this arm.
 *   - `plain`    — an armed non-git cwd: browse it one level at a time.
 *   - `unarmed`  — a non-git cwd on offer, awaiting the collapsed-root click.
 *   - `null`     — nothing to show (no terminal, no cwd observed yet).
 *
 *  A sum type rather than a family of nullable accessors: the four states are
 *  mutually exclusive, and spelling them as `gitRoot() ?? armedDirRoot()` plus a
 *  dozen `gitRoot()` truthiness tests left the rule that keeps them consistent
 *  in the reader's head, with a fifth state (a remote root, a bare repo) needing
 *  every test found again. */
export type BrowseRoot =
  | { kind: "git"; root: string }
  | { kind: "plain"; root: string }
  | { kind: "unarmed"; cwd: string }
  | null;

export function browseRootOf(
  host: HostKey,
  terminalId: TerminalId | null,
  meta: TerminalMetadata | null | undefined,
): BrowseRoot {
  // Inside a git repo the consent store is never consulted — git's repoRoot is
  // the browse root, exactly as before plain-directory browsing existed.
  const repoRoot = meta?.git?.repoRoot;
  if (repoRoot) return { kind: "git", root: repoRoot };
  const cwd = meta?.cwd;
  if (terminalId === null || cwd == null) return null;
  return armed[armKey(host, terminalId, cwd)]
    ? { kind: "plain", root: cwd }
    : { kind: "unarmed", cwd };
}

/** The root the tab actually browses — `null` while un-armed or absent. The one
 *  read for "is there a tree to paint at all". */
export const browsableRoot = (root: BrowseRoot): string | null =>
  root === null || root.kind === "unarmed" ? null : root.root;
