/** CodeTab — code review and browsing for the terminal's current repo.
 *
 * One file tree, three modes:
 *   - All: full repo (git-filtered) — selecting a file shows its content.
 *   - Local: working tree vs HEAD (uncommitted) — selecting a file shows the diff.
 *   - Branch: working tree vs `merge-base(origin/<default>)` — same, with a
 *     branch base. Forge-agnostic "what this branch will ship".
 *
 * The toolbar combines two independent filter axes — the scope
 * switcher (the shared `SegmentedControl`) and filename input
 * (`FileSearchInput`) — in one row. Pierre's built-in tree-header search is disabled so the
 * `FileSearchInput` is the single source of filter state, forwarded
 * via `FileTree.searchQuery`. `@kolu/solid-pierre` owns the imperative
 * Pierre lifecycle; this component is just data flow + chrome. */

import Resizable from "@corvu/resizable";
import {
  CODE_TAB_VIEW_ORDER,
  type CodeTabView,
  type TerminalMetadata,
  viewLabel,
} from "@kolu/padi/surface";
import { attachBackForwardMouse } from "@kolu/solid-browser";
import { FileTree, rowPathsCss } from "@kolu/solid-pierre";
import { makeEventListener } from "@solid-primitives/event-listener";
import type { TerminalId } from "kolu-common/surface";
import type { GitDiffMode } from "kolu-git/schemas";
import {
  batch,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  Match,
  on,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { toast } from "solid-sonner";
import { CommentComposer } from "../comments/CommentComposer";
import { CommentsTray } from "../comments/CommentsTray";
import { CommentTextSurface } from "../comments/CommentTextSurface";
import { useComposer } from "../comments/composerState";
import { useCommentScrollRequest } from "../comments/scrollRequest";
import { useColorScheme } from "../settings/useColorScheme";
import { realSizes } from "../ui/corvuResizable";
import { filterChipAccent } from "../ui/filterChip";
import { mergeGitStatusEntries } from "../ui/gitStatusEntries";
import {
  ChevronRightIcon,
  EyeIcon,
  FileBrowseIcon,
  FileDiffIcon,
  GitBranchIcon,
} from "../ui/Icons";
import { resolveRef } from "../ui/lineRef";
import { makeTreeContextMenu } from "../ui/pierreAdapters";
import {
  pierreIconConfig,
  pierreTreesIgnoredRowDecl,
  pierreTreesShadowCss,
  pierreTreesStyle,
} from "../ui/pierreTheme";
import SegmentedControl, {
  type SegmentedControlOption,
} from "../ui/SegmentedControl";
import { Z_HANDLE_INNER } from "../ui/stackLayers";
import { requestDeepLinkNavigation } from "../useDeepLinks";
import { isDesktop, isTouch } from "../useMobile";
import { activeHost } from "../wire";
import BrowseDiffView from "./BrowseDiffView";
import BrowseFileDispatcher from "./BrowseFileDispatcher";
import {
  type BrowseInventory,
  diffInventory,
  directoryInventory,
  mergeBrowseInventory,
} from "./browseInventory";
import { armBrowseRoot, browsableRoot, browseRootOf } from "./browseRoot";
import {
  type CodeTabOpenResolutionSource,
  type CodeTabScope,
  codeTabScopeKey,
  codeTabScopesEqual,
  codeTabSelectionInventoryVerdict,
  createCodeTabOpenController,
  type OpenInCodeTabRequest,
} from "./codeTabOpenController";
import FileSearchInput from "./FileSearchInput";
import { projectFileTreeSearch } from "./fileSearch";
import {
  codeActiveStatus,
  codeAllPaths,
  codeBranchStatus,
  codeCollapseLevel,
  codeDiff,
  codeDirLevels,
  codeExpandLevel,
  codeIgnoredPaths,
  codeLocalStatus,
  readFreshCodePaths,
} from "./hostCodeTab";
import { openInCodeTab, pendingOpen } from "./openInCodeTab";
import { attachPierreTouchScroll } from "./pierreTouchScroll";
import { setShowIgnoredFiles, showIgnoredFiles } from "./showIgnoredFiles";
import { type BrowserLocation, useRightPanel } from "./useRightPanel";

const EMPTY_STATE: Record<GitDiffMode, string> = {
  local: "No local changes",
  branch: "No changes vs base",
};

const NO_BRANCH_BASE = "No branch base to compare";

/** The flag pair for leaving kolu in a new tab, fire-and-forget: `noopener`
 *  denies the new tab a handle on kolu's `window`, `noreferrer` keeps kolu's
 *  URL — which can carry a terminal id — out of the target's `Referer`. One
 *  named constant rather than a literal at the call site, because a hand-typed
 *  copy of this pair has drifted before (`exportSessionAsHtml.ts` carries
 *  `noopener` alone, missing the second flag). */
const EXTERNAL_OPEN_FLAGS = "noopener,noreferrer";

const FileSelectHint: Component<{ label: string }> = (props) => (
  <div class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2">
    <FileDiffIcon class="w-8 h-8 opacity-40" />
    <span class="text-[11px]">{props.label}</span>
  </div>
);

const BinaryFileHint: Component<{ fileName: string | null }> = (props) => (
  <div
    class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2"
    data-testid="diff-binary"
  >
    <FileDiffIcon class="w-8 h-8 opacity-40" />
    <span class="text-[11px]">Binary file — not displayable</span>
    <span class="text-[10px] text-fg-3/30">{props.fileName}</span>
  </div>
);

// The Code-tab toolbar's icon button — ONE chrome for every toolbar affordance
// (the nav arrows, the show-ignored eye), so the shared hit target and its
// touch sizing (driven by the toolbar row's `data-touch` via the group variant)
// live here rather than in hand-synced copies. `pressed` paints via `classList`
// so the ARIA fact and the paint share one source, per the convention
// `KavalAttachSection` documents.
const ToolbarIconButton: Component<{
  testId: string;
  label: string;
  title: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: JSX.Element;
}> = (props) => (
  <button
    type="button"
    data-testid={props.testId}
    aria-label={props.label}
    aria-pressed={props.pressed}
    title={props.title}
    disabled={props.disabled}
    onClick={props.onClick}
    class="grid h-5 w-5 group-data-[touch=true]/toolbar:h-7 group-data-[touch=true]/toolbar:w-7 shrink-0 place-items-center rounded transition-colors hover:bg-surface-2/60 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    // The repo's one accent-vs-neutral toggle grammar, shared with the dock's
    // activity-window and ☾ chips — so a change to what "actively filtering"
    // looks like is one edit, not three that drift apart.
    classList={filterChipAccent(props.pressed === true)}
  >
    {props.children}
  </button>
);

// Browser-style back/forward toolbar button — the two variants differ only by
// direction.
const NavButton: Component<{
  direction: "back" | "forward";
  disabled: boolean;
  onClick: () => void;
}> = (props) => {
  const back = props.direction === "back";
  return (
    <ToolbarIconButton
      testId={`code-tab-${props.direction}-button`}
      label={back ? "Go back" : "Go forward"}
      title={back ? "Go back (Alt+←)" : "Go forward (Alt+→)"}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <ChevronRightIcon class={`h-3.5 w-3.5${back ? " rotate-180" : ""}`} />
    </ToolbarIconButton>
  );
};

/** The collapsed root node a non-git cwd renders — nothing is listed or
 *  watched until the user clicks it (consent expressed in the flow, per
 *  session, never persisted — `browseArm.ts`). Styled as the folder row the
 *  click turns it into. The 32px row clears the WCAG 2.2 24px tap floor. */
const BrowseRootArm: Component<{ cwd: string; onBrowse: () => void }> = (
  props,
) => {
  const name = () => props.cwd.split("/").filter(Boolean).pop() ?? props.cwd;
  return (
    <div class="flex flex-col h-full text-[11px]">
      <button
        type="button"
        data-testid="browse-root-node"
        title={`Browse ${props.cwd}`}
        onClick={props.onBrowse}
        class="flex items-center gap-1.5 px-2 h-8 shrink-0 text-left transition-colors hover:bg-surface-2/60"
      >
        <ChevronRightIcon class="h-3.5 w-3.5 opacity-60" />
        <FileBrowseIcon class="h-3.5 w-3.5 opacity-60" />
        <span class="font-medium truncate">{name()}</span>
        <span class="text-fg-3/50">browse</span>
      </button>
      <div class="px-2 py-1 text-[10px] text-fg-3/40">
        Not a git repository — expand to browse files. Diff views need git.
      </div>
    </div>
  );
};

const CodeTab: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
}> = (props) => {
  const { themeTypeLiteral: diffTheme } = useColorScheme();
  const rightPanel = useRightPanel();

  // Coarse-pointer modality (`isTouch`, the input axis — not the `layoutMode`
  // size/fork axis): roomier rows are a tap-target affordance, so a
  // coarse-pointer device wants them in every layout (phone, compact, and a
  // touch desktop). The DOM sizing reads it reactively (`(pointer: coarse)` can flip
  // mid-mount — a 2-in-1 docking/undocking — and `data-touch` should follow),
  // while Pierre's tree density snapshots it (below) because Pierre captures
  // `density` once at construction (like `initialExpansion`), so a reactive
  // accessor there would read as live when it isn't.
  const treeDensity = isTouch() ? "relaxed" : undefined;

  // Read `codeMode` directly rather than projecting it from `activeTab`.
  // CodeTab now stays mounted across the Inspector tab toggle (#818); a
  // projection-with-fallback (`activeTab.kind === "code" ? mode : "local"`)
  // would flip `view()` from the persisted mode (e.g. `"browse"`) to the
  // fallback `"local"` while Inspector is active, then back on return —
  // a real value transition that fires the `slotKey` effect and
  // wipes selection on every Inspector round-trip in non-local modes.
  //
  // Outside a git repo the view COERCES to browse without touching the
  // persisted mode: the diff views are meaningless there (nothing to diff
  // against), and writing the coercion through `setCodeMode` would clobber the
  // mode the user actually picked for the next repo this terminal enters. Not
  // a slotKey-churn hazard: `view()` only flips when git presence itself flips,
  // which is a genuine root transition that resets the slot anyway.
  //
  // The coercion itself lives beside the mode it coerces
  // (`useRightPanel.effectiveCodeMode`) — spelled here alone, it had to be
  // re-assumed in `hostCodeTab`, which then disagreed about the effective view
  // by construction.
  const view = (): CodeTabView =>
    rightPanel.effectiveCodeMode(root()?.kind === "git");
  const setView = rightPanel.setCodeMode;

  // Tree right-click menu: "Copy path" plus view-switch entries (All files ⇄
  // Local / Branch diff). Built once — `nav.view()` is read fresh on each
  // right-click, so the closure tracks the live mode even though Pierre
  // snapshots the menu config at mount. For a file row, navigation seeds the
  // destination view's selection slot *before* switching so the same file
  // lands selected there (a file absent from that view's changed set — e.g. an
  // untracked file in Branch mode, or anything in a base-less Branch — falls
  // out and the membership effect clears it; the view still switches, the
  // asked-for behavior). For a directory row `path` is null (directories
  // aren't selectable), so the target keeps its own last pick.
  const renderTreeMenu = makeTreeContextMenu({
    view,
    navigate: (target, path) => {
      // This guard is the *single* enforcement point for the adapter's
      // documented "null = leave the target's slot untouched" contract
      // (pierreAdapters.ts `TreeContextMenuNav.navigate`): a null path is the
      // adapter's "directories aren't selectable" verdict, so the target keeps
      // its own last pick. It is load-bearing, not removable defensive code —
      // the adapter never calls setSelectedFile itself, so the no-op lives only
      // here. `select` can't absorb the guard: its unconditional setSelectedFile
      // runs before the record check, so `select(target, null)` would *delete*
      // the slot (useRightPanel.ts) — the opposite of "keep last pick". The
      // no-op must stay in front of the funnel unless those null semantics
      // change first.
      //
      // A real pick routes through `select` — the same funnel tree clicks and
      // the terminal-link front door use — so this cross-mode jump records a
      // (target, path) history entry like every other navigation. (It used to
      // call setSelectedFile directly and skip recordNavigation, so back/forward
      // stepped straight over right-click "Open in <mode>" jumps.)
      if (path !== null) select(target, path);
      setView(target);
    },
  });

  // The root and its AUTHORITY, as one sum type from the ONE derivation
  // (`browseRoot.ts`) — the same function `hostCodeTab` feeds its query inputs
  // from, so the tree this component paints and the query world feeding it can
  // never disagree about which root kind is in play. Inside a git repo the
  // browse root IS the repo root and every git-only surface (diff modes, status
  // overlay, the ignored toggle) keys on `kind === "git"`. Outside one it is the
  // terminal's cwd, but only once the user clicked the collapsed root node: the
  // tree browser never needed git, only the diff machinery did.
  //
  // A memo, not a plain accessor: every question below reads it.
  const root = createMemo(() =>
    browseRootOf(activeHost(), props.terminalId, props.meta),
  );
  const browseRoot = () => browsableRoot(root());

  // History records repo-relative `{ mode, path }` locations with no repo
  // identity of their own, so a stack captured in repo A must not be replayed
  // against repo B after a `cd`. `syncRepo` drops a terminal's history whenever
  // *that same terminal's* repo changes — back/forward then only ever retraces
  // locations from the repo currently shown, and the next selection re-seeds the
  // fresh stack.
  //
  // `CodeTab` is a singleton over the active terminal, so this effect only ever
  // feeds `syncRepo` the *active* terminal's `(id, repo)`. The reset decision
  // can't live here as a compare-against-previous-tick: `browseRoot()` shifts on
  // both a `cd` (genuine transition) and a plain terminal switch (NOT a
  // transition), and — the case a previous-tick compare misses entirely — a
  // terminal's repo can change while it is INACTIVE (its PTY `cd`s while another
  // terminal is shown). `syncRepo` owns the call: it keys the comparison per
  // terminal (`history.get(id).lastRepo`), so the stale repo is caught the moment that
  // terminal next becomes active, while a freshly-switched-to terminal in a
  // different repo keeps its own history. The first call per terminal just
  // records the baseline, so a session-restored stack survives initial mount.
  createEffect(
    on(
      () => [props.terminalId, browseRoot()] as const,
      ([tid, repo]) => {
        if (tid !== null) rightPanel.syncRepo(tid, repo);
      },
    ),
  );

  const isDiffView = () => view() !== "browse";
  const diffMode = (): GitDiffMode | undefined =>
    view() === "browse" ? undefined : (view() as GitDiffMode);

  // Selection is per-terminal, keyed by mode, stored in
  // `TerminalMetadata.rightPanel.selectedFileByMode` via `useRightPanel`.
  // Each (terminal, mode) slot owns its own pick — switching modes within
  // a terminal restores that mode's last file; switching terminals
  // restores that terminal's last (file, mode) pair.
  //
  // The complete Code-tab owner is one value. Navigation requests, async
  // completion guards, and slot resets all use this same host + terminal + repo
  // + mode identity, so switching between equivalent-looking terminal slots
  // still retires terminal-scoped work.
  const currentScope = (): CodeTabScope | null => {
    const terminalId = props.terminalId;
    const repoRoot = browseRoot();
    if (terminalId === null || repoRoot === null) return null;
    return {
      host: activeHost(),
      terminalId,
      repoRoot,
      mode: view(),
    };
  };
  const commentContext = createMemo(() => {
    const terminalId = props.terminalId;
    const repoRoot = browseRoot();
    return terminalId === null || repoRoot === null
      ? null
      : { terminalId, repoRoot };
  });
  const selectedPath = (): string | null => rightPanel.selectedFile(view());
  // The single selection funnel: set the shown file AND record it in history.
  // Recording can never drift from selection because they are one call —
  // routing every selection-mutation site through here replaces the old
  // convention of placing a paired `recordNavigation` next to each write.
  // Recording is skipped when `record === false` (mechanical clears, history
  // replay) or when `path === null` (clearing the slot is not a navigation).
  const select = (
    mode: CodeTabView,
    path: string | null,
    opts?: {
      ref?: { startLine: number; endLine: number };
      record?: boolean;
    },
  ) => {
    rightPanel.setSelectedFile(mode, path);
    if (opts?.record === false || path === null) return;
    rightPanel.recordNavigation({ mode, path, ref: opts?.ref });
  };
  const slotKey = createMemo(() => codeTabScopeKey(currentScope()));

  // Dismiss any open comment composer when the user navigates away from the
  // terminal / file / mode / repo the draft was anchored to. Without this, the
  // composer floats over different content and the user has to dismiss it
  // manually; worse, a save would attach the stale draft to whatever terminal
  // is now active. Draft body is lost, which matches every other
  // modal-on-navigate behavior in kolu.
  //
  // Key on the VALUE string, not the raw signals: `on` fires on every
  // INVALIDATION of its source, so an array source re-closes the composer on any
  // incidental invalidation (a same-repo active-terminal *clock* tick
  // re-evaluates `browseRoot()` to the same string). A primitive-string memo (the
  // `slotKey` precedent above) notifies only on a real navigation. `terminalId`
  // is in the key because a comment saves against the ACTIVE terminal: switching
  // to another terminal (or host — a terminal is host-bound) at the same file
  // must drop the draft, per composerState.ts's host-independent contract, even
  // when repo/file/mode coincide. `\0` separators keep the key collision-safe
  // without embedding literal NUL bytes in the source.
  const composer = useComposer();
  const composerAnchor = createMemo(
    () =>
      `${props.terminalId ?? ""}\0${selectedPath() ?? ""}\0${view()}\0${browseRoot() ?? ""}`,
  );
  createEffect(on(composerAnchor, () => composer.close(), { defer: true }));

  // Filename filter — drives Pierre's tree filter externally. Reset on
  // mode switch so a stale needle doesn't hide the wrong file set.
  const [searchQuery, setSearchQuery] = createSignal("");

  // ── Selection-stability invariants ─────────────────────────────────
  // CodeTab survives right-panel tab toggles and panel collapse (#818)
  // — every reactive surface stays alive across UI state changes that
  // previously destroyed and rebuilt it. Two independent sources of
  // spurious `selectedPath = null` would fire without explicit guards:
  //
  //   1. `pending()` gate on the membership check — gitStatus / fsList
  //      stream resubscribes briefly drop `treePaths()` to `[]`; without
  //      the gate, the membership check reads transient empty as
  //      "selected file is missing" and deletes the slot.
  //   2. `handleSelect` ignores Pierre's `null` events — Pierre fires
  //      `onSelectionChange([])` from `resetPaths` and tear-down, not
  //      just user deselect; the Code tab has no UX for explicit
  //      deselect anyway (user switches by clicking another file).
  //
  // (Repo / view transitions used to be a third churn source — the
  // resetKey effect cleared selection on every (repoPath, view) change.
  // Per-slot storage above makes that clear obsolete: the new slot's
  // value is already correct without writing through. slotKey effect now
  // only clears `searchQuery`, which is genuinely shared across slots.)

  // The three git status streams, the browse file list, and the diff are RETAINED
  // per host in `hostCodeTab` (padi W9): each name below is a STABLE window over the
  // active host's own retained instance, so a switch-BACK — and a `canvasMode`
  // round-trip that unmounts this tab — reads the held value with no blank and no
  // `pending` window. Only the OWNER moved out of this component; the local names are
  // kept verbatim so every reader below (`treeGitStatus`, `scopeSegments`, the diff
  // Match, the selection-stability effects, `status`/`statusPending`/`statusError`) is
  // unchanged. `localStatus`/`branchStatus` stay warm whenever there's a repo (Local /
  // Branch badges, base/ref, browse overlay); the un-fetched-base PRECONDITION_FAILED
  // case is swallowed for the passive `branchStatus` inside `hostCodeTab`. `activeStatus`
  // is the view-keyed active read — entering Branch performs a fresh read, never a stale
  // error. The queries' INPUTS live in `hostCodeTab` (read off the active projection);
  // this component now only READS their values and WRITES selection.
  const localStatus = codeLocalStatus;
  const branchStatus = codeBranchStatus;
  const activeStatus = codeActiveStatus;
  const allPaths = codeAllPaths;
  const ignoredPaths = codeIgnoredPaths;
  const diff = codeDiff;
  const status = () => activeStatus();
  const statusPending = () => activeStatus.pending();
  const statusError = () => activeStatus.error();

  // Clear the filename filter when the slot changes — the search needle
  // was scoped to the previous file set and rarely makes sense post-
  // switch. Selection itself is per-slot (read/written via
  // `rightPanel.selectedFile(mode)` → `selectedFileByMode` on the
  // per-terminal record) so the new view automatically surfaces its own
  // pick without a clear here. `slotKey` is memoized, so this fires
  // only when the tuple genuinely changes — without the memo, `on(...)`
  // would re-run its callback on every incidental tick of `browseRoot()`
  // (metadata cell) or `view()` (per-terminal in-memory store) and wipe
  // the filter spuriously after #818 made CodeTab survive right-panel
  // tab toggles.
  createEffect(
    on(
      slotKey,
      () => {
        setSearchQuery("");
        // Retire any standing folder reveal too — it was scoped to the previous
        // repo/view. Clearing here can't clobber a folder click that *causes*
        // the view switch: that switch fires this effect while fsListAll is
        // still loading, before the gated resolution effect sets `revealDir`.
        setRevealDir(null);
        // The loaded levels need no clearing here: they live in this host's
        // retained level family (`hostCodeTab`'s `dirLevels`), whose entries are
        // keyed by (policy, terminal, root, dirKey) and are therefore disposed
        // STRUCTURALLY by the same transition — contents and in-flight reads
        // with them. The tree's own record of which lazy directories are open is
        // invalidated on this same signal, via `lazyEpoch` below.
      },
      { defer: true },
    ),
  );

  // Highlight-session record for the latest handled pendingOpen tick. Holds
  // the full request object (reference identity discriminates two
  // structurally-identical clicks — `openInCodeTab` mints a fresh object per
  // call) alongside the resolved path. Storing the request here lets
  // `selectedRange` derive its value without re-running `resolveRef`
  // (single resolution site per request). Reset by a manual tree-click to a
  // different file so navigating back doesn't resurrect the line range.
  const [handled, setHandled] = createSignal<{
    request: OpenInCodeTabRequest;
    resolvedPath: string | null;
  } | null>(null);
  const [freshSelection, setFreshSelection] = createSignal<{
    request: OpenInCodeTabRequest;
    path: string;
  } | null>(null);

  // Directory-reveal target for the terminal folder-link front door. A folder
  // ref (`packages/client/`) isn't a selectable file, so instead of `select`ing
  // it we hand the tree a "reveal this directory" request — expand it + its
  // ancestors and scroll it into view, leaving the shown file untouched. The
  // request **stands** (it is not consumed) so `FileTree` re-applies it on every
  // remount: the live `fsListAll` stream resubscribes under load and briefly
  // unmounts/remounts the tree, and a consume-once reveal was lost in that
  // window (the folder came back collapsed — a darwin-CI flake). It is cleared
  // on the next real navigation instead — a file pick (`handleSelect`) or a
  // repo/view switch (the `slotKey` effect) — so it never re-scrolls to a stale
  // folder forever. A fresh object per request re-fires the reveal on a repeat
  // click of the same folder.
  const [revealDir, setRevealDir] = createSignal<{ path: string } | null>(null);

  // The lazily-loaded tree LEVELS — one level of contents per directory the
  // user has opened, keyed by Pierre's folder key. The family lives in this
  // host's RETAINED world (`hostCodeTab`'s `dirLevels`), which owns the
  // registration intent, the per-level reader (a watched polled query for a
  // plain-directory level, a one-shot read for a gitignored one — nothing
  // watches an ignored path), and the click's settlement. This component only
  // READS the levels and reports the tree's two edges into them.
  //
  // It is not local state, and it is not two mechanisms: the root level and the
  // deep levels are one family with one lifetime, so a `canvasMode` round-trip
  // that unmounts this tab no longer loses every expanded folder while keeping
  // the root warm.
  const dirLevels = codeDirLevels;

  const finishOpenRequest = (
    req: OpenInCodeTabRequest,
    resolved: Exclude<ReturnType<typeof resolveRef>, null>,
    source: CodeTabOpenResolutionSource,
  ): void => {
    if (resolved.kind === "directory") {
      // A folder ref reveals (expands + scrolls to) the directory in the
      // tree without changing the shown file — selection stays put, and
      // the request leaves no line highlight, mirroring the not-found
      // branch. The reveal isn't a content navigation, so it's not
      // recorded in back/forward history.
      //
      // Resolution ran against the full `treePaths()`, but the mounted
      // tree shows `treeSearch().projectedPaths` — a *filtered* set when a
      // browse search is active. A folder outside the current filter has no
      // row to reveal, so the request would be silently consumed with
      // nothing on screen. Clear the search first: the projection falls
      // back to the full tree, the target row exists, and the reveal lands.
      setSearchQuery("");
      setRevealDir({ path: resolved.path });
      setFreshSelection(null);
      setHandled({ request: req, resolvedPath: null });
      return;
    }
    const rel = resolved.path;
    // Record the front-door open in history *with* its line ref, so a
    // later back() re-issues it through this same pipeline and repaints
    // the highlight (cheap-v1 "restore where you were"). Idempotent on
    // mode+path, so a re-click of the same path:line refreshes the entry
    // in place rather than deepening history. A programmatic
    // `select(..., rel)` no longer echoes back through `onSelect` — the
    // #1841 provenance gate drops any selection no user gesture caused — so
    // this ref is safe; only a later USER re-click of the same file reaches
    // `handleSelect`, whose `record` guard keeps it from clobbering the ref.
    batch(() => {
      setFreshSelection(
        source === "fresh" ? { request: req, path: rel } : null,
      );
      select(req.scope.mode, rel, {
        ref:
          req.ref.startLine !== null && req.ref.endLine !== null
            ? { startLine: req.ref.startLine, endLine: req.ref.endLine }
            : undefined,
      });
      setHandled({ request: req, resolvedPath: rel });
    });
  };

  // The controller owns the volatile open lifecycle. This presenter exposes
  // current facts and atomic UI outcomes; it does not carry request/controller
  // slots or reconstruct supersession in promise callbacks.
  createCodeTabOpenController({
    snapshot: () => ({
      request: pendingOpen(),
      scope: currentScope(),
      inventoryScope: treeInventory().scope,
      paths: treePaths(),
      inventoryPending: treeInventory().pending,
      includeIgnored: showIgnoredFiles(),
    }),
    resolve: (request, paths) =>
      resolveRef({
        rawPath: request.ref.path,
        repoRoot: request.scope.repoRoot,
        cwd: request.cwd,
        repoPaths: paths,
        allowBasenameFallback: request.allowBasenameFallback,
        // A `:N` line suffix means the user pointed at a *file* line — a
        // directory match would wrongly reveal the folder and drop the line.
        hasLine: request.ref.startLine !== null,
      }),
    readFresh: (request, includeIgnored) =>
      readFreshCodePaths(
        request.scope.host,
        request.scope.repoRoot,
        includeIgnored,
      ),
    onResolved: finishOpenRequest,
    onNotFound: (request) => {
      toast.error(`File reference not found: ${request.ref.path}`);
      setFreshSelection(null);
      setHandled({ request, resolvedPath: null });
    },
    onError: (request, error) => {
      toast.error(`File list refresh: ${error.message}`);
      setFreshSelection(null);
      setHandled({ request, resolvedPath: null });
    },
  });

  // Highlight range derives from the consume-once record: if the
  // request we last handled matches the latest pending one AND its
  // resolved path is still the rendered file, surface the line
  // range. Any navigation away (user tree-click, mode switch) flips
  // `selectedPath` and naturally invalidates the memo — no second
  // resolution call.
  //
  // No `equals` override: two clicks on the same `path:line` produce
  // structurally identical `{start, end}` but distinct request
  // objects (`openInCodeTab` mints a fresh one per call), so the
  // memo emits a fresh value on every click. Pierre's
  // `InteractionManager.setSelection` re-renders when the selection
  // is "dirty" — and tearing down the gutter (panel collapse,
  // virtualizer recreate) leaves `renderedSelectionRange === null`,
  // which dirties it. Re-emitting per click is what re-paints the
  // highlight in that case; the same content equality the old
  // override gated on would silently drop the re-paint.
  const selectedRange = createMemo<{
    start: number;
    end: number;
  } | null>(() => {
    const req = pendingOpen();
    if (!req) return null;
    const h = handled();
    if (!h || h.request !== req || h.resolvedPath === null) return null;
    if (h.resolvedPath !== selectedPath()) return null;
    // No-line refs (`src/Main.hs` with no `:N`) open the file with no
    // highlight — the user asked for the file, not a specific line.
    if (req.ref.startLine === null || req.ref.endLine === null) return null;
    return { start: req.ref.startLine, end: req.ref.endLine };
  });

  /** The tree's file inventory AND its readiness, minted together as ONE
   *  value — never a bare array a consumer then pairs with a readiness it
   *  picks itself. Browse now has TWO authorities (the tracked `fs.listAll`
   *  listing and the idle-unless-toggled gitignored overlay), landing at
   *  different ticks; a consumer that reads the merged array while checking
   *  only `allPaths.pending()` treats a half-loaded tree as authoritative and
   *  drops the user's selection in that window. Same rule the surface's
   *  `health().live` states: read the complete fact, never hand-AND one leg.
   *  Adding a third source later changes this memo and nothing else.
   *
   *  The overlay's `pending` leg is gated on the toggle because an idle query
   *  reports `pending` forever (`createPolledQuery`'s `blank()` on a null
   *  input) — with the toggle off it is idle by design, not loading. */
  const treeInventory = createMemo<
    BrowseInventory & { scope: CodeTabScope | null }
  >(() => {
    // Copy `paths` out rather than returning the store proxy directly:
    // `fsListAll` lands in a reconciled store whose `paths` array is
    // mutated in place, so the proxy's reference is stable across an
    // in-place add/remove. Returning it bare means this memo never reads
    // the contents (so an in-place add doesn't re-run it) and, even when it
    // does re-run, the stable reference defeats the downstream
    // reference-equality memos/effects that feed Pierre — a file created in
    // a hand-expanded folder would never surface. Spreading tracks every
    // element + length and mints a fresh reference, matching the diff
    // branch's `.map()` below. See `createReactiveSubscription` /
    // `writeValue.ts` for the reconcile strategy.
    //
    // The gitignored overlay rides its own idle-unless-toggled query, so its
    // entries join here: collapsed paths whose trailing slash marks a
    // fully-ignored directory — one childless row, so `node_modules` never
    // enumerates. The merge's three rules (absent≠empty, tracked wins the
    // overlap, readiness covers only the consulted sources) live in
    // `mergeBrowseInventory`, where a table test pins each one.
    if (view() === "browse") {
      // Plain-directory root (no git): the level family's root level plus every
      // deeper level the user has open — one value, so the paths can't be paired
      // with a readiness picked from somewhere else. Every subdirectory is a
      // lazy row and nothing is dimmed (no ignore authority without git). Same
      // fresh-reference discipline as the git branch: `directoryInventory` mints
      // new arrays from the reconciled store's elements on every run.
      if (root()?.kind !== "git") {
        const { root: rootLevel, levels, pending } = dirLevels();
        return {
          ...directoryInventory(rootLevel?.paths, levels, pending),
          scope: rootLevel?.scope ?? null,
        };
      }
      const tracked = allPaths();
      const ignored = ignoredPaths();
      const showIgnored = showIgnoredFiles();
      const inventory = mergeBrowseInventory(
        tracked?.paths,
        ignored?.paths,
        dirLevels().levels,
        {
          trackedPending: allPaths.pending(),
          ignoredPending: ignoredPaths.pending(),
          showIgnored,
        },
      );
      const scope =
        tracked !== undefined &&
        (!showIgnored ||
          (ignored !== undefined &&
            codeTabScopesEqual(tracked.scope, ignored.scope)))
          ? tracked.scope
          : null;
      return { ...inventory, scope };
    }
    // The diff views list CHANGED files, where a gitignored path can't appear —
    // so there is no overlay and no collapsed directory to expand. Built
    // through the type's own constructor so a new field can't be forgotten here.
    return {
      ...diffInventory(
        status()?.files.map((f) => f.path) ?? [],
        statusPending(),
      ),
      // Diff-status results are not owner-stamped. A user open in these modes
      // takes the fixed-host fresh-read path instead of trusting this inventory.
      scope: null,
    };
  });

  const treePaths = () => treeInventory().paths;

  const treeSearch = createMemo(() =>
    projectFileTreeSearch(treePaths(), searchQuery()),
  );

  // Everything kolu paints inside Pierre's shadow root, as ONE string on the one
  // channel the wrapper exposes.
  //
  // The gitignored rows are dimmed by this sheet rather than handed to Pierre as
  // `gitStatus` entries carrying its own `"ignored"` status, even though that
  // status exists. Pierre rolls EVERY `gitStatus` entry up into its ancestors'
  // change counters (`incrementAncestorChangeCounts` runs unguarded by status),
  // setting `data-item-contains-git-change` on each ancestor — which the theme
  // paints as modified. Routing the overlay through that channel therefore marks
  // every ancestor of an ignored entry as "contains changes": measured on the
  // kolu repo, 47 extra directories on top of a real 77, and 68 on an
  // otherwise-clean checkout. "Contains a change" and "contains something git
  // ignores" are different facts, so the overlay keys on `data-item-path` and
  // the roll-up stays honest.
  //
  // Deliberately NOT narrowed to the search projection: a `[data-item-path=…]`
  // selector matching no row is inert (the browser buckets by attribute name and
  // only tests rows that exist), so filtering by the visible set would buy
  // nothing and put a full sheet rebuild + shadow-root re-parse on the
  // per-keystroke path. Memoized on the string, so the identical sheet a repo
  // pulse re-derives never reaches `replaceSync`.
  const treeShadowCss = createMemo(() => {
    const ignored = treeInventory().ignored;
    if (ignored.length === 0) return pierreTreesShadowCss;
    return `${pierreTreesShadowCss}\n${rowPathsCss(ignored, pierreTreesIgnoredRowDecl)}`;
  });

  // Track membership rather than the treePaths array identity: browse paths
  // come from a reconciled store array whose contents can change in place.
  // Gate on the inventory's OWN readiness — taken from the same value as the
  // paths, so the guard can never check a half-loaded tree against a settled
  // flag. When a stream resubscribes (e.g. on right-panel tab switch, since its
  // inputFn returns a fresh object literal), the value briefly resets to
  // undefined and the inventory collapses to `[]`. Treating that transient empty as
  // "selected file is missing" would null `selectedPath` on every
  // resubscribe and lose the selection across tab toggles. Once the stream
  // has delivered (`!pending()`), an empty paths set IS authoritative —
  // the file truly went away (commit cleared local diff, rm deleted it) —
  // except for a path a direct fresh read just proved exists. That result can
  // beat the retained stream's repo-change pulse, so `freshSelection` pins the
  // path until the retained inventory first contains it. From that point the
  // normal removal rule is authoritative again.
  //
  // Bail on the tick where `slotKey` itself just changed: the shared
  // `treePaths()` / `pending()` signals can momentarily expose the
  // previous slot's snapshot before `createReactiveSubscription` resets
  // them for the new input, so the new slot's selection would be checked
  // against the previous slot's tree and falsely cleared. The next tick
  // (after the reset effect runs) re-evaluates with the authoritative
  // values for the new slot.
  createEffect(
    on(
      () => {
        const s = selectedPath();
        const sk = slotKey();
        const { paths, pending: isPending } = treeInventory();
        const fresh = freshSelection();
        const freshPath =
          fresh !== null && fresh.request === pendingOpen() ? fresh.path : null;
        return {
          s,
          sk,
          verdict: codeTabSelectionInventoryVerdict(
            s,
            isPending,
            paths,
            freshPath,
          ),
        };
      },
      (cur, prev) => {
        if (prev && prev.sk !== cur.sk) return;
        if (cur.verdict === "confirm-fresh") {
          setFreshSelection(null);
        } else if (cur.s && cur.verdict === "clear") {
          select(view(), null, { record: false });
        }
      },
      { defer: true },
    ),
  );

  const treeGitStatus = createMemo(() => {
    // Browse overlays both layers (local primary, branch fallback). Outside
    // browse, decoration comes straight off the active mode's `status` stream.
    if (view() === "browse") {
      const local = localStatus()?.files ?? [];
      const branch = branchStatus()?.files ?? [];
      return mergeGitStatusEntries(local, branch);
    }
    const s = status();
    return s ? mergeGitStatusEntries(s.files, []) : undefined;
  });

  const handleSelect = (path: string | null) => {
    // Pierre fires null in many situations beyond user intent — including
    // `resetPaths` clearing its selection during stream resubscribe, and
    // tear-down on unmount. The Code tab has no UX affordance for
    // deselect (user switches selection by clicking another file), so
    // ignore null and only honor explicit non-null selections. Keeping
    // the previous signal value through Pierre's internal churn lets the
    // selected file survive right-panel tab toggles (#818).
    if (path === null) return;
    // A genuine file pick is a navigation away from any standing folder reveal,
    // so retire it — otherwise its directory would keep re-expanding on every
    // remount. (The picked file's own ancestors keep that folder open anyway.)
    setRevealDir(null);
    // Tree-click to a different file ends the click-targeted-highlight
    // session — otherwise navigating back to the originally-targeted
    // file in the tree would resurrect the line range, surprising the
    // user who treated their tree click as a fresh intent. A user re-clicking
    // the SAME front-door-opened file doesn't trip this branch (its path
    // equals `handled.resolvedPath`), leaving the highlight intact for the
    // lifetime of the request. (A programmatic `select(..., rel)` never reaches
    // here at all now — the #1841 gate drops its echo.)
    const h = handled();
    if (h && h.resolvedPath !== null && h.resolvedPath !== path) {
      setHandled(null);
    }
    // Record the visit — unless the user re-clicked the same file a front-door
    // open just resolved (its resolution effect already recorded it *with* the
    // line ref; re-recording here would overwrite the ref with a plain entry).
    // A genuine tree/iframe pick of a DIFFERENT file records a (mode, path)
    // entry, dropping the line highlight exactly as the selection itself does.
    select(view(), path, { record: h?.resolvedPath !== path });
  };

  // Re-apply a history location on back/forward. A location carrying a line
  // ref is re-issued through the same front door a terminal `path:N` click
  // uses, so the existing resolve → `handled` → `selectedRange` pipeline
  // repaints the line (cheap-v1 "restore where you were"); a plain selection
  // just moves the mode + file. Either way the `recordNavigation` these
  // re-applies trigger is idempotent on mode+path, so re-applying never
  // deepens or forks history — the cursor stays where back()/forward() left it.
  const applyLocation = (loc: BrowserLocation) => {
    if (loc.ref && loc.path !== null) {
      const repo = browseRoot();
      const terminalId = props.terminalId;
      if (repo === null || terminalId === null) return;
      openInCodeTab({
        terminalId,
        ref: {
          path: loc.path,
          startLine: loc.ref.startLine,
          endLine: loc.ref.endLine,
        },
        targetMode: loc.mode,
        allowBasenameFallback: false,
      });
      return;
    }
    setView(loc.mode);
    select(loc.mode, loc.path, { record: false });
  };
  const goBack = () => {
    const loc = rightPanel.navigateBack();
    if (loc) applyLocation(loc);
  };
  const goForward = () => {
    const loc = rightPanel.navigateForward();
    if (loc) applyLocation(loc);
  };
  // Browser-style back/forward, scoped to the Code tab via imperative listeners
  // on its root so the inputs only act while the user is *in* the browser, never
  // in a terminal. Two channels:
  //   - keyboard: Alt+←/→ (cross-platform; not in the global shortcut registry,
  //     so it can't shadow a PTY byte the way a `mod`-based chord would);
  //   - mouse: the dedicated back/forward (X1/X2) buttons, decoded by
  //     `@kolu/solid-browser`'s shared `attachBackForwardMouse` — it owns the
  //     button-number truth and the swallow-on-down / act-on-up /
  //     preventDefault-on-both protocol so the buttons drive the Code tab, not
  //     the SPA.
  // Both bubble through Pierre's shadow root, so an event over a tree row or the
  // preview reaches here. `makeEventListener` auto-cleans on unmount; the
  // mouse binder's disposer is tied to the component owner via `onCleanup`.
  const attachBackForwardInputs = (el: HTMLDivElement) => {
    makeEventListener(el, "keydown", (e) => {
      if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        goForward();
      }
    });
    onCleanup(
      attachBackForwardMouse(el, { onBack: goBack, onForward: goForward }),
    );
  };

  // The authority feeding the tree, picked ONCE by root kind instead of at each
  // of the questions below (a nested ternary per question is how the two used to
  // be able to disagree about which source they were reporting on).
  const treeError = (): Error | undefined =>
    isDiffView()
      ? statusError()
      : root()?.kind === "git"
        ? allPaths.error()
        : dirLevels().error;
  // "Is there a tree to paint at all", which is the TRACKED authority's
  // question alone — deliberately not `treeInventory().pending`. The gitignored
  // overlay is additive decoration; waiting on it here would hold the whole
  // tree behind a second `git ls-files` the user is only ever offered as an
  // extra. The selection/resolution guards read the merged readiness because
  // they ask a different question: is this inventory complete enough to
  // conclude a path is absent.
  const treeReady = () =>
    isDiffView()
      ? status()
      : root()?.kind === "git"
        ? allPaths()
        : dirLevels().root;
  // Branch base, read off the always-on `branchStatus` so it's correct in
  // any view (the scope switcher annotates the Branch segment even from
  // Local/Browse). `undefined` while pending; `null` once loaded with no
  // resolvable base (a remote-less repo, #1244, degrades to an empty diff
  // rather than erroring); a `{ ref, sha }` object otherwise. `base` lives only
  // on the `branch` arm of the status union — this stream always requests
  // `mode: "branch"`, so the narrow is exhaustive, never a real "wrong arm".
  const branchBase = () => {
    const s = branchStatus();
    return s?.mode === "branch" ? s.base : undefined;
  };
  const branchRef = (): string | null => branchBase()?.ref ?? null;
  // The *actionable* no-base case: Branch is the active view AND it has no
  // resolvable base (so the empty tree is "nothing to compare against", not
  // "clean"). The bare `branchBase() === null` question is view-independent —
  // the badge asks it directly — but the empty-state copy must re-AND the
  // view, so the compound predicate lives here once instead of at each caller.
  const branchViewHasNoBase = () =>
    view() === "branch" && branchBase() === null;

  // Change-count badges on the Local / Branch segments. `0` until the
  // always-on status streams land; the segment hides the pill at 0.
  const localCount = (): number => localStatus()?.files.length ?? 0;
  const branchCount = (): number => branchStatus()?.files.length ?? 0;

  // Scope catalog — attaches each view's label, tooltip, icon, change count,
  // and group divider to the canonical `CODE_TAB_VIEW_ORDER`. The order itself
  // lives in `surface.ts` (shared with the right-click "jump to view" menu);
  // this memo only supplies the per-view metadata. The shared
  // `SegmentedControl` is purely a presenter.
  const scopeSegments = createMemo<SegmentedControlOption<CodeTabView>[]>(
    () => {
      const ref = branchRef();
      const noBase = branchBase() === null;
      const meta: Record<
        CodeTabView,
        Omit<SegmentedControlOption<CodeTabView>, "value" | "label">
      > = {
        browse: {
          hint: "Browse the whole repo",
          icon: FileBrowseIcon,
        },
        local: {
          hint: "Working tree vs HEAD",
          icon: GitBranchIcon,
          badge: localCount(),
          // First git segment — set apart from the whole-repo browse tree.
          dividerBefore: true,
        },
        branch: {
          hint: ref
            ? `Working tree vs ${ref}`
            : noBase
              ? NO_BRANCH_BASE
              : "Working tree vs branch base",
          icon: GitBranchIcon,
          // No base ⇒ not badgeable, so omit the field entirely rather than
          // carry a value the presenter has to special-case. With a base, the
          // badge is the change count (the presenter hides it when 0).
          ...(noBase ? {} : { badge: branchCount() }),
        },
      };
      return CODE_TAB_VIEW_ORDER.map((value) => ({
        value,
        label: viewLabel(value),
        ...meta[value],
      }));
    },
  );

  /** Diff value narrowed to "this is a pure-rename" (no hunks, both old +
   *  new file names present and different). Returning the full diff so the
   *  rendering Match can read its names without re-narrowing.
   *
   *  Binary excluded from the rename predicate: a binary rename satisfies
   *  hunks.length === 0 with distinct old/new names *and* `binary === true`.
   *  Without this guard, dispatch between the binary placeholder and the
   *  rename hint would depend on Switch arm ordering — load-bearing and
   *  invisible. With this guard, the mutual exclusion lives in the data,
   *  so a Switch refactor can't silently flip the rendering. */
  const renamedDiff = createMemo(() => {
    const d = diff();
    if (!d) return undefined;
    if (d.binary) return undefined;
    if (d.hunks.length !== 0) return undefined;
    const { oldFileName, newFileName } = d;
    if (!oldFileName || !newFileName || oldFileName === newFileName) {
      return undefined;
    }
    return { oldFileName, newFileName };
  });

  // The un-armed non-git state: a cwd exists to offer, the user just hasn't
  // opened it. Distinct from the metadata-less fallback below (no terminal, no
  // cwd observed yet), which keeps the old empty-state message.
  const unarmedCwd = () => {
    const r = root();
    return r?.kind === "unarmed" ? r.cwd : null;
  };

  return (
    <Show
      when={browseRoot()}
      fallback={
        <Show
          when={unarmedCwd()}
          fallback={
            <div
              class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2 text-[11px]"
              data-testid="diff-no-repo"
            >
              <GitBranchIcon class="w-8 h-8 opacity-40" />
              Not in a git repository
            </div>
          }
        >
          {(cwd) => (
            <BrowseRootArm
              cwd={cwd()}
              onBrowse={() => {
                const tid = props.terminalId;
                if (tid !== null) armBrowseRoot(activeHost(), tid, cwd());
              }}
            />
          )}
        </Show>
      }
    >
      <div
        class="flex flex-col h-full min-h-0 text-[11px]"
        data-testid="diff-tab"
        ref={attachBackForwardInputs}
      >
        {/* Toolbar grows roomier on a coarse pointer (back/fwd + each scope
         *  segment clear the WCAG 2.2 24px tap floor); `overflow-x-auto`
         *  +`scrollbar-none` is a clip safety net for the narrowest phones,
         *  where the segments + filter can't all fit the drawer width. */}
        <div
          data-touch={isTouch() || undefined}
          class="group/toolbar flex items-center h-7 data-[touch=true]:h-10 px-1.5 bg-surface-1/30 border-b border-edge shrink-0 gap-2 overflow-x-auto scrollbar-none"
        >
          <div class="flex items-center gap-0.5 shrink-0">
            <NavButton
              direction="back"
              disabled={!rightPanel.canNavigateBack()}
              onClick={goBack}
            />
            <NavButton
              direction="forward"
              disabled={!rightPanel.canNavigateForward()}
              onClick={goForward}
            />
          </div>
          {/* Scope switcher — git only: the diff views are meaningless without
           *  a repo to diff against, so outside one the tree is all there is
           *  and a one-segment control would be chrome without a choice. */}
          <Show when={root()?.kind === "git"}>
            <SegmentedControl
              options={scopeSegments()}
              value={view()}
              onChange={setView}
              testIdPrefix="diff-mode"
              ariaRole="toolbar"
              ariaLabel="File scope"
              dataMode
              touch={isTouch()}
            />
          </Show>
          <FileSearchInput
            value={searchQuery()}
            onChange={setSearchQuery}
            touch={isTouch()}
          />
          {/* Show-ignored toggle — browse only (the diff modes list changed
           *  files, where gitignored paths can't appear). Device-local pref;
           *  flipping it arms the SEPARATE fs.listIgnored query in
           *  `hostCodeTab` — fs.listAll is untouched, so the mounted tree keeps
           *  its expansion and scroll. */}
          <Show when={view() === "browse" && root()?.kind === "git"}>
            <ToolbarIconButton
              testId="code-tab-show-ignored-toggle"
              label="Show gitignored files"
              title={
                showIgnoredFiles()
                  ? "Hide gitignored files"
                  : "Show gitignored files"
              }
              pressed={showIgnoredFiles()}
              onClick={() => setShowIgnoredFiles((v) => !v)}
            >
              <EyeIcon class="h-3.5 w-3.5" />
            </ToolbarIconButton>
          </Show>
        </div>

        {/* Vertical split between tree and content. Mirrors the horizontal
         *  split that the desktop host wires up in `App.tsx` — same
         *  `@corvu/resizable` shell, vertical orientation. Split fraction
         *  persists via `rightPanel.codeTabTreeSize` so reload restores
         *  the user's layout. */}
        <Resizable
          orientation="vertical"
          sizes={[
            rightPanel.codeTabTreeSize(),
            1 - rightPanel.codeTabTreeSize(),
          ]}
          onSizesChange={(sizes) => {
            const s = realSizes(sizes);
            if (s) rightPanel.setCodeTabTreeSize(s[0]);
          }}
          class="flex-1 min-h-0 overflow-hidden"
        >
          <Resizable.Panel
            as="div"
            data-testid="diff-file-list"
            // Pierre renders its scroller inside a shadow root. The mobile
            // right-panel host is a Corvu bottom-sheet drawer that walks up
            // from the event target looking for a `data-corvu-no-drag` opt-out
            // before claiming a vertical drag as a sheet-dismiss; without it,
            // Corvu eats every drag and the tree can't scroll. So this is
            // necessary — but NOT sufficient on real hardware: with Corvu out
            // of the way, iOS Safari's own native scroll still can't reach the
            // shadow-rooted scroller below the portaled drawer. The manual
            // touch-scroll driver below closes that gap. Inert on desktop (no
            // Corvu drawer there). The sibling diff panel scrolls fine — its
            // `overflow-auto` is a light-DOM scroller Corvu can see.
            data-corvu-no-drag=""
            class="min-h-0 border-b border-edge"
            minSize={0.1}
          >
            <Switch
              fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}
            >
              <Match when={treeError()}>
                {(err) => (
                  <div class="px-2 py-1 text-danger" data-testid="diff-error">
                    Error: {err().message}
                  </div>
                )}
              </Match>
              <Match when={treeReady()}>
                <Show
                  when={treePaths().length > 0}
                  fallback={
                    <div
                      class="px-2 py-4 text-fg-3/50 text-center"
                      data-testid="diff-empty"
                    >
                      {(() => {
                        const m = diffMode();
                        if (!m)
                          return root()?.kind === "git"
                            ? "Empty repository"
                            : "Empty directory";
                        // No resolvable base (remote-less repo, #1244): there's
                        // nothing to compare against, so "No changes vs base"
                        // would be a false clean signal.
                        if (branchViewHasNoBase()) return NO_BRANCH_BASE;
                        return EMPTY_STATE[m];
                      })()}
                    </div>
                  }
                >
                  <div
                    class="h-full w-full min-h-0"
                    ref={(el) => {
                      // Keyed on the drawer-hosted layouts (`!isDesktop()` —
                      // phone + compact), NOT `isTouch`: the workaround is for
                      // iOS native scroll failing to reach Pierre's shadow
                      // scroller below the *portaled* drawer (see
                      // pierreTouchScroll.ts). The desktop split hosts the tree
                      // in the non-portaled Resizable panel where native scroll
                      // works — attaching the driver there would preventDefault
                      // working scroll.
                      if (!isDesktop()) attachPierreTouchScroll(el);
                    }}
                  >
                    <FileTree
                      paths={treeSearch().projectedPaths}
                      gitStatus={treeGitStatus()}
                      selectedPath={selectedPath()}
                      onSelect={handleSelect}
                      // Terminal folder-link front door: a folder ref reveals
                      // (expands + scrolls to) the directory here. The request
                      // stands so a remount re-reveals it (`revealDir` above);
                      // it's cleared on the next navigation, not on apply.
                      revealRequest={revealDir()}
                      // The collapsed gitignored directories: rows Pierre gives
                      // a chevron but whose children were never sent, so an
                      // expand has to go read them (#2091).
                      lazyDirectories={treeInventory().lazyDirs}
                      // The tree's two edges into this host's retained level
                      // family: an open registers the level (and the promise
                      // settles when it lands), a close retires it — which
                      // disposes its query, its pulse subscription and the
                      // server-side handle behind it.
                      onExpandLazyDirectory={codeExpandLevel}
                      onCollapseLazyDirectory={codeCollapseLevel}
                      // Invalidate the wrapper's record of which lazy
                      // directories are open on the same signal that clears the
                      // loaded levels above — two halves of one fact. Without
                      // it a key present in BOTH repos (`node_modules/`,
                      // `dist/`) survives a retained switch still recorded, so
                      // no expand is reported and the user lands on an open,
                      // empty folder (#2091's symptom).
                      lazyEpoch={slotKey()}
                      initialExpansion={isDiffView() ? "open" : "closed"}
                      search={false}
                      expandPaths={treeSearch().expandedAncestors}
                      icons={pierreIconConfig}
                      shadowCss={treeShadowCss()}
                      contextMenu={{
                        enabled: true,
                        triggerMode: "both",
                        render: renderTreeMenu,
                      }}
                      onError={(err) =>
                        toast.error(`File tree render failed: ${err.message}`)
                      }
                      // Roomier rows on touch (36px vs 30px) for a comfortable
                      // tap target; clears the WCAG 2.2 24px floor with margin.
                      // Snapshotted above — Pierre reads density at construction.
                      density={treeDensity}
                      class="h-full w-full"
                      style={pierreTreesStyle}
                    />
                  </div>
                </Show>
              </Match>
            </Switch>
          </Resizable.Panel>

          <Resizable.Handle
            data-testid="diff-tree-content-handle"
            aria-label="Resize tree pane"
            // Disable startIntersection (the handle's left edge): Corvu's
            // registerHandle keeps a *module-level* handles[] and pairs
            // handles whose orientations differ and rects touch at the
            // corner (see @corvu/resizable/dist/index.js:201–222). Without
            // this opt-out, our left edge equals the outer horizontal
            // handle's (in `App.tsx`) right edge → the two are coupled,
            // and clicks on the outer handle near the file-tree row land
            // on the inner handle instead. The outer handle carries the
            // symmetric `startIntersection={false}` so both sides are
            // defended.
            startIntersection={false}
            // `Z_HANDLE_INNER` raises the ::before pseudo-element above
            // Pierre's tree (the previous flex sibling). Without it, the
            // tree's bottom 4px shadow the upper half of the handle's hit
            // area — Pierre's row hit-targets paint above the handle's
            // absolute ::before because both use auto z-index and the tree
            // comes first in document order with positioned descendants.
            // Setting the explicit z-index creates a stacking context that
            // lifts the ::before in front of the tree's interior.
            // See `ui/stackLayers.ts` for the full layering contract.
            class="shrink-0 h-0 relative before:absolute before:inset-x-0 before:-top-1 before:h-2 before:cursor-row-resize before:hover:bg-accent/30 before:transition-colors"
            style={{ "z-index": Z_HANDLE_INNER }}
          />

          <Resizable.Panel
            as="div"
            data-testid="diff-content"
            // Focusable programmatically (tabindex -1: click-focusable, not in
            // the Tab order) so a click on the rendered file content moves focus
            // OUT of the terminal and into the Code tab — Pierre's source/diff
            // rows and the rendered markdown aren't focusable on their own. With
            // focus no longer in a terminal, Cmd/Ctrl+F defers to the browser's
            // native find-in-page (input/actions.ts `focusScopeMarker`).
            // `outline-none` since no keyboard user ever tabs here.
            tabindex={-1}
            class="min-h-0 overflow-auto outline-none"
            minSize={0.1}
          >
            <Show
              when={selectedPath()}
              keyed
              fallback={
                <FileSelectHint
                  label={
                    isDiffView()
                      ? "Select a file to view its diff"
                      : "Select a file to view its content"
                  }
                />
              }
            >
              {(path) => (
                // `keyed` remounts this subtree whenever the selected file
                // changes — line refs don't survive across files, so the
                // `useLineSelection` controller resets cleanly with the
                // surrounding subtree. The inner `<CodeView>` would also
                // accept an in-place item swap via `updateItemId`, but
                // remount is the simpler idiom here and the right semantic
                // for the per-file menu state.
                <Switch>
                  <Match when={isDiffView()}>
                    <Switch
                      fallback={
                        <div class="px-2 py-1 text-fg-3/50">Loading diff…</div>
                      }
                    >
                      <Match when={diff.error()}>
                        {(err) => (
                          <div class="px-2 py-1 text-danger">
                            Error: {err().message}
                          </div>
                        )}
                      </Match>
                      <Match when={diff()?.binary && diff()}>
                        {(d) => (
                          <BinaryFileHint
                            fileName={d().newFileName ?? d().oldFileName}
                          />
                        )}
                      </Match>
                      <Match when={renamedDiff()}>
                        {(rename) => (
                          <div class="flex items-center justify-center h-full text-fg-3/50">
                            File renamed: {rename().oldFileName} →{" "}
                            {rename().newFileName}
                          </div>
                        )}
                      </Match>
                      <Match when={diff()}>
                        {(d) => (
                          // The comment capture surface is applied here at the
                          // seam — `BrowseDiffView` is a pure presenter, exactly
                          // like `BrowseFileView`, so "is this commentable?"
                          // lives in one place per view family rather than being
                          // re-open-coded inside the leaf. `contentTick` is the
                          // raw hunk string so the highlight overlay re-anchors
                          // when a live edit re-diffs the file.
                          //
                          // The (terminal, repo) pair is read through
                          // `commentContext()` INSIDE the JSX — this `Match`
                          // callback only runs on a falsy→truthy entry, and a
                          // terminal switch between two terminals showing the
                          // same file never re-enters it (the diff query key
                          // carries no terminal id), so a snapshot here would
                          // leave the surface wired to the previous terminal.
                          <Show when={commentContext()}>
                            {(present) => (
                              <CommentTextSurface
                                terminalId={present().terminalId}
                                path={path}
                                contentTick={d().hunks[0] ?? ""}
                                class="h-full w-full"
                                lineAnchored={true}
                              >
                                <BrowseDiffView
                                  terminalId={present().terminalId}
                                  path={path}
                                  hunk={d().hunks[0] ?? ""}
                                  theme={diffTheme()}
                                  repoRoot={present().repoRoot}
                                />
                              </CommentTextSurface>
                            )}
                          </Show>
                        )}
                      </Match>
                    </Switch>
                  </Match>
                  <Match when={!isDiffView()}>
                    {/* Same reactive read as the diff arm above: the (terminal,
                        repo) pair rides in through `commentContext()` so a
                        terminal switch updates the dispatcher's props in place
                        instead of leaving it pinned to the terminal that was
                        active when this branch was entered. */}
                    <Show when={commentContext()}>
                      {(present) => (
                        <BrowseFileDispatcher
                          terminalId={present().terminalId}
                          repoPath={present().repoRoot}
                          filePath={path}
                          // The live repo FILE list — the vault a `[[wikilink]]`
                          // in the previewed doc resolves against, pathless.
                          // Both halves come off `treeInventory()`, the one
                          // value that mints the snapshot and its readiness
                          // together, so the click guard reads the readiness of
                          // the very list it resolves against, never a drifted
                          // pair (a stream resubscribe briefly empties it, and
                          // the overlay lands on its own clock).
                          repoVault={{
                            paths: treePaths(),
                            pending: treeInventory().pending,
                          }}
                          theme={diffTheme()}
                          initialSelectedLines={selectedRange()}
                          // Following a link inside an HTML preview is the
                          // same intent as a tree click: move selection to the
                          // new file and drop any line-range highlight.
                          onNavigate={handleSelect}
                          // The mouse back/forward (X1/X2) buttons pressed over
                          // the sandboxed preview can't reach the Code-tab
                          // listener (the frame traps them), so the in-iframe
                          // SDK forwards them here to drive the same history.
                          onHistory={(direction) =>
                            direction === "back" ? goBack() : goForward()
                          }
                          // An external link in the sandboxed preview can't open
                          // a tab itself (no `allow-popups`); the in-iframe SDK
                          // forwards the http(s) URL and we open it in a real
                          // browser tab with `noopener,noreferrer` (severs the
                          // opener — the new tab can't script back into kolu).
                          //
                          // Trust boundary: `open-external` is an unauthenticated
                          // postMessage. The previewed HTML runs arbitrary scripts
                          // under the opaque origin, so any of them — not just the
                          // SDK's click trap — can post this message. We therefore
                          // treat it as exactly that: a request from untrusted
                          // in-frame content to open an http(s) foreground tab.
                          // That's an accepted capability, not an escalation: a
                          // sandboxed script can already `location =` itself to any
                          // URL and `fetch` outbound, so a `noopener,noreferrer`
                          // tab to an http(s) URL grants nothing it couldn't reach,
                          // only a more visible surface. The scheme is re-validated
                          // in `observeIframeOpenExternal` so `javascript:`/`data:`
                          // (which would run in kolu's own origin) can never reach
                          // `window.open`.
                          onOpenExternal={(url) =>
                            window.open(url, "_blank", EXTERNAL_OPEN_FLAGS)
                          }
                          // A kolu deep link clicked in the preview routes the
                          // app through the SAME pipeline a typed `#/…` URL
                          // takes (safe: the router is view-only by law).
                          onDeepLink={requestDeepLinkNavigation}
                        />
                      )}
                    </Show>
                  </Match>
                </Switch>
              )}
            </Show>
          </Resizable.Panel>
        </Resizable>
        <Show when={commentContext()}>
          {(present) => (
            <>
              <CommentsTray
                terminalId={present().terminalId}
                onJumpTo={(comment) => {
                  // Two complementary highlights on land:
                  //   1. Pierre's blue line bar (full-row selection)
                  //      via `openInCodeTab` when we have a stored
                  //      `lineRange` — the same machinery terminal
                  //      `path:line` clicks use.
                  //   2. The CSS Custom Highlight overlay's yellow
                  //      underline on the exact quote — applied by
                  //      `highlightOverlay` after the file mounts.
                  // Plus a scroll request so the matched range lands
                  // in view even if Pierre's `scrollToLine` and our
                  // re-find disagree on the row.
                  if (comment.lineRange) {
                    openInCodeTab({
                      terminalId: present().terminalId,
                      ref: {
                        path: comment.path,
                        startLine: comment.lineRange.start,
                        endLine: comment.lineRange.end,
                      },
                      targetMode: "browse",
                    });
                  } else {
                    setView("browse");
                    // A no-line comment jump moves the visible file just like a
                    // tree click — `select` records it so back/forward retraces
                    // it too. The lineRange branch above records via the
                    // `openInCodeTab` → resolution-effect pipeline. Idempotent
                    // on mode+path, so jumping to the already-shown file is a
                    // harmless in-place refresh, not a duplicate entry.
                    select("browse", comment.path);
                  }
                  // Carry the comment's surface so the dispatcher flips the
                  // Source ⇄ Rendered toggle back to it before the overlay
                  // re-finds the quote: a prose ("Hello Doc") comment landing
                  // on the source view ("# Hello Doc") would fail to re-anchor
                  // (and the source view wouldn't even highlight it). When the
                  // file is already open in the other mode, `select` is a
                  // no-op selection (same path → no remount), so the toggle
                  // flip is the only thing that moves the user back to the
                  // right view.
                  useCommentScrollRequest().set({
                    commentId: comment.id,
                    path: comment.path,
                    surface: comment.surface,
                  });
                }}
              />
              <CommentComposer terminalId={present().terminalId} />
            </>
          )}
        </Show>
      </div>
    </Show>
  );
};

export default CodeTab;
