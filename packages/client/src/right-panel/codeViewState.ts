/** WHERE A CODE VIEW'S PLACE IS KEPT — the one interface the view reads and
 *  writes its place through, whoever keeps it.
 *
 *  The place is the mode (All / Local / Branch), the file selected in each
 *  mode, and the back/forward history. The view never knows where it lives:
 *  the Right panel keeps it per pane (`useRightPanel`'s `code`), and a home is
 *  free to keep it anywhere else that answers these verbs.
 *
 *  What is NOT here: the tree's width, which is one preference shared by every
 *  Code view (`useRightPanel().codeTabTreeSize`), and the visible file
 *  content, which is read through the view's query set. */

import type { CodeTabView } from "@kolu/padi-client/surface";
import {
  type Browser,
  createBrowser,
  DEFAULT_MAX_ENTRIES,
} from "@kolu/solid-browser";
import type { Accessor } from "solid-js";

/** A spot in the Code tab's navigable space — the unit `@kolu/solid-browser`'s
 *  history records. `mode` is the All/Local/Branch sub-view, carried *inside*
 *  the location so back/forward cross modes naturally; `path` is the selected
 *  repo-relative file (null when the mode has no selection yet); `ref` is an
 *  optional line range to re-highlight when the entry is revisited (terminal
 *  `path:N` links, comment jumps), absent for plain file picks. */
export type BrowserLocation = {
  mode: CodeTabView;
  path: string | null;
  ref?: { startLine: number; endLine: number };
};

/** Two locations name the "same page" — same file in the same mode — when
 *  their mode+path match. `navigate` then refreshes the entry's `ref` in place
 *  instead of recording a duplicate (re-opening the current file at a new line
 *  doesn't deepen history). This idempotence is what lets every navigation
 *  funnel — including Pierre's echoed re-selects — call `recordNavigation`
 *  without risking double history entries. */
const SAME_LOCATION = (a: BrowserLocation, b: BrowserLocation): boolean =>
  a.mode === b.mode && a.path === b.path;

/** Single owner of a Code view history controller's construction contract:
 *  `isSameEntry: SAME_LOCATION` (idempotent on mode+path) and the explicit
 *  `DEFAULT_MAX_ENTRIES` cap, wired in exactly one place. Always an empty
 *  stack — seeding (session restore) and clearing (repo change) happen *in
 *  place* via `browser.reset(...)`, never by building a replacement, so the
 *  instance (and the toolbar's reactive subscriptions to its enablement
 *  signals) survives every reset. */
export function createCodeHistory(): Browser<BrowserLocation> {
  return createBrowser<BrowserLocation>({
    isSameEntry: SAME_LOCATION,
    maxEntries: DEFAULT_MAX_ENTRIES,
  });
}

/** A Code view's place, behind one interface. Every read is reactive.
 *
 *  Whose place it is and which root it shows are NOT asked here: they come
 *  together in the view's subject, from one read by the caller. The home
 *  keeps its own history in step with its root — history records
 *  repo-relative locations with no root of their own, so a stack built under
 *  one root is dropped by the home when the root moves (the Right panel's:
 *  `useRightPanel().syncRepo`, fed by `RightPanel` from that same read). */
export interface CodeViewState {
  /** The mode the view SHOWS — the stored mode through `codeModeFor`, so a
   *  root git cannot list always browses. */
  readonly codeMode: Accessor<CodeTabView>;
  readonly setCodeMode: (mode: CodeTabView) => void;
  /** The file selected in `mode`, repo-relative, or `null`. */
  readonly selectedFile: (mode: CodeTabView) => string | null;
  /** Select `path` in `mode`; `null` drops the mode's selection. */
  readonly setSelectedFile: (mode: CodeTabView, path: string | null) => void;
  /** Record a visit — idempotent on mode+path. Records only; the selected
   *  file stays the render truth. */
  readonly recordNavigation: (loc: BrowserLocation) => void;
  /** Step back / forward, returning the location to re-apply, or `null`. */
  readonly navigateBack: () => BrowserLocation | null;
  readonly navigateForward: () => BrowserLocation | null;
  readonly canNavigateBack: Accessor<boolean>;
  readonly canNavigateForward: Accessor<boolean>;
}
