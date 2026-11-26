/** WHERE A CODE VIEW'S PLACE IS KEPT — the one interface the view reads and
 *  writes its place through, whoever keeps it, and the pieces every home is
 *  built from.
 *
 *  The place is the mode (All / Local / Branch), the file selected in each
 *  mode, and the back/forward history. The view never knows where it lives:
 *  the Right panel keeps it per pane (`useRightPanel`'s `code`), a work per
 *  work (`conductor/workCodeView.ts`). Both build their history from
 *  {@link createCodeHistories} and {@link codeHistoryVerbs}, and their
 *  per-mode selection from {@link selectionWith}, so the two homes cannot
 *  come to disagree about what back/forward or a deselect does.
 *
 *  What is NOT here: the tree's share of the split, a preference per
 *  arrangement (`codeSplit.ts`), and the visible file content, which is read
 *  through the view's query set. */

import type {
  CodeTabView,
  RightPanelPerTerminalState,
} from "@kolu/padi-client/surface";
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
function createCodeHistory(): Browser<BrowserLocation> {
  return createBrowser<BrowserLocation>({
    isSameEntry: SAME_LOCATION,
    maxEntries: DEFAULT_MAX_ENTRIES,
  });
}

/** Back/forward for many owners — one stack per key (a pane, a work), each
 *  bundled with the root it was last recorded under. Both fields share one
 *  lifecycle (seeded together, dropped together, reset together on a root
 *  change), so they live in one entry rather than two maps kept in step by
 *  hand. */
export interface CodeHistories<K> {
  /** The key's stack, created on first use and then NEVER replaced — resets
   *  clear it in place — so a reader subscribed to its `canBack` stays
   *  subscribed across every reset. */
  readonly browserFor: (key: K) => Browser<BrowserLocation>;
  /** Reconcile the key's stack with the root its view shows now. The stack
   *  records root-relative locations with no root of their own, so it is
   *  dropped when the KEY'S OWN root has moved since it was last recorded;
   *  the first call for a key only records the baseline, so a restored stack
   *  survives the first mount. `undefined` is "no root recorded yet",
   *  distinct from `null` ("recorded, and it is in no repository"). */
  readonly syncRepo: (key: K, root: string | null) => void;
  /** Start the key over at `at` (or empty), with no root recorded — a fresh
   *  start, the next {@link syncRepo} re-adopts the root without resetting. */
  readonly seed: (key: K, at: BrowserLocation | undefined) => void;
  /** The key is gone. */
  readonly forget: (key: K) => void;
}

export function createCodeHistories<K>(): CodeHistories<K> {
  const held = new Map<
    K,
    { browser: Browser<BrowserLocation>; lastRepo: string | null | undefined }
  >();
  const entryFor = (key: K) => {
    let entry = held.get(key);
    if (entry === undefined) {
      entry = { browser: createCodeHistory(), lastRepo: undefined };
      held.set(key, entry);
    }
    return entry;
  };
  return {
    browserFor: (key) => entryFor(key).browser,
    syncRepo: (key, root) => {
      const entry = entryFor(key);
      const was = entry.lastRepo;
      entry.lastRepo = root;
      if (was !== undefined && root !== was) entry.browser.reset();
    },
    seed: (key, at) => {
      const entry = entryFor(key);
      entry.browser.reset(at);
      entry.lastRepo = undefined;
    },
    forget: (key) => {
      held.delete(key);
    },
  };
}

/** The three history-WRITING verbs of {@link CodeViewState}, over whichever
 *  stack is the place's NOW — `null` while there is no owner to have one (no
 *  pane), where every verb answers "nowhere to go".
 *
 *  `browser` MUST NOT read reactive state: `recordNavigation` is called from
 *  the EFFECT PHASE (a Code view records the front-door open its resolution
 *  landed), where a signal/store read is STRICT_READ_UNTRACKED. A home whose
 *  stack is keyed on something reactive (which pane has focus) keeps that key
 *  in a plain field of its own and looks the stack up with it here. The two
 *  ENABLEMENT accessors are NOT here: they are read in JSX, where this
 *  write-phase key would answer about whichever pane was focused last, so each
 *  home spells them itself — on its own live focus where the stack is keyed on
 *  focus, on its fixed work where it is not (`conductor/workCodeView.ts`). */
export function codeHistoryVerbs(
  browser: () => Browser<BrowserLocation> | null,
): Pick<
  CodeViewState,
  "recordNavigation" | "navigateBack" | "navigateForward"
> {
  return {
    recordNavigation: (loc) => browser()?.navigate(loc),
    navigateBack: () => browser()?.back() ?? null,
    navigateForward: () => browser()?.forward() ?? null,
  };
}

/** The file selected in each mode, as every home stores it. */
export type SelectedFiles = NonNullable<
  RightPanelPerTerminalState["selectedFileByMode"]
>;

/** The per-mode selection with `mode` set to `path`, or dropped for `null` —
 *  `"unchanged"` when that is what it already says. A REBUILT map, never a
 *  mutation: the deselect arm drops the mode's key rather than writing
 *  `undefined` into it (an optional key on the wire refuses a present-but-
 *  undefined value), and an emptied map is `undefined` — absence is the only
 *  spelling of "no selection".
 *
 *  `files` MUST BE A PLAIN SNAPSHOT, never a store's own map: the decision
 *  below reads the map's leaves (`mode in cur`, `cur[mode]`, the rest spread),
 *  and every caller is a WRITE-ONLY verb reached from the Code view's effect
 *  phase, where a store read is STRICT_READ_UNTRACKED. Both homes hold their
 *  merge base as plain values for exactly this reason
 *  (`conductor/workCodeView.ts`'s `plainView`,
 *  `right-panel/useRightPanel.ts`'s `plainRecord`).
 *
 *  The rebuilt map is the DECISION, not necessarily the write: a home whose
 *  record lives in a store writes the one leaf it names, and reads this result
 *  only to tell "unchanged" from "the last selection went away" (`undefined`).
 *
 *  ONE DIRECTION. The snapshot flows in, the decision flows out, and the
 *  home's write callback is read DOWNSTREAM of it — snapshot → decision →
 *  the one leaf written → the home folding the produced record back into its
 *  own plain copy. Nothing reads this result back into `files`: the next
 *  decision's base is that copy, never this map and never the store. A home
 *  that fed its own output back in would be building a cycle, which 2.0.4
 *  does not report — it crashes. */
export function selectionWith(
  files: SelectedFiles | undefined,
  mode: CodeTabView,
  path: string | null,
): SelectedFiles | undefined | "unchanged" {
  const cur = files ?? {};
  if (path === null) {
    if (!(mode in cur)) return "unchanged";
    const { [mode]: _dropped, ...rest } = cur;
    return Object.keys(rest).length > 0 ? rest : undefined;
  }
  return cur[mode] === path ? "unchanged" : { ...cur, [mode]: path };
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
  /** Select `path` in `mode`; `null` drops the mode's selection.
   *
   *  Called from the EFFECT PHASE as well as from clicks — a view lands a
   *  front-door open there, through the open controller's `onResolved`.
   *  So it may only WRITE: a read of a signal or a store property inside it
   *  is STRICT_READ_UNTRACKED. A home that needs its current record to build
   *  the next one keeps that record in a plain field it updates as it writes,
   *  never by reading the reactive copy back. The same holds for
   *  {@link recordNavigation}. */
  readonly setSelectedFile: (mode: CodeTabView, path: string | null) => void;
  /** Record a visit — idempotent on mode+path. Records only; the selected
   *  file stays the render truth. Write-only, as {@link setSelectedFile} is. */
  readonly recordNavigation: (loc: BrowserLocation) => void;
  /** Step back / forward, returning the location to re-apply, or `null`. */
  readonly navigateBack: () => BrowserLocation | null;
  readonly navigateForward: () => BrowserLocation | null;
  readonly canNavigateBack: Accessor<boolean>;
  readonly canNavigateForward: Accessor<boolean>;
}
