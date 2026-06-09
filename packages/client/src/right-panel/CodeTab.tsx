/** CodeTab — code review and browsing for the terminal's current repo.
 *
 * One file tree, three modes:
 *   - All: full repo (git-filtered) — selecting a file shows its content.
 *   - Local: working tree vs HEAD (uncommitted) — selecting a file shows the diff.
 *   - Branch: working tree vs `merge-base(origin/<default>)` — same, with a
 *     branch base. Forge-agnostic "what this branch will ship".
 *
 * The toolbar combines two independent filter axes — mode picker
 * (`ModeChipPicker`) and filename input (`FileSearchInput`) — in one
 * row. Pierre's built-in tree-header search is disabled so the
 * `FileSearchInput` is the single source of filter state, forwarded
 * via `FileTree.searchQuery`. `@kolu/solid-pierre` owns the imperative
 * Pierre lifecycle; this component is just data flow + chrome. */

import Resizable from "@corvu/resizable";
import { attachBackForwardMouse } from "@kolu/solid-browser";
import { FileTree } from "@kolu/solid-pierre";
import { makeEventListener } from "@solid-primitives/event-listener";
import {
  type CodeTabView,
  type TerminalId,
  type TerminalMetadata,
  viewLabel,
} from "kolu-common/surface";
import type { GitDiffMode } from "kolu-git/schemas";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
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
import { isMobile, isTouch } from "../useMobile";
import {
  ChevronRightIcon,
  FileBrowseIcon,
  FileDiffIcon,
  GitBranchIcon,
} from "../ui/Icons";
import { resolveLineRefPath } from "../ui/lineRef";
import { mergeGitStatusEntries } from "../ui/gitStatusEntries";
import { makeTreeContextMenu } from "../ui/pierreAdapters";
import {
  pierreIconConfig,
  pierreTreesShadowCss,
  pierreTreesStyle,
} from "../ui/pierreTheme";
import { Z_HANDLE_INNER } from "../ui/stackLayers";
import { app } from "../wire";
import BrowseDiffView from "./BrowseDiffView";
import BrowseFileDispatcher from "./BrowseFileDispatcher";
import FileSearchInput from "./FileSearchInput";
import { projectFileTreeSearch } from "./fileSearch";
import { attachPierreTouchScroll } from "./pierreTouchScroll";
import ModeChipPicker, { type ModeOption } from "./ModeChipPicker";
import {
  type OpenInCodeTabRequest,
  openInCodeTab,
  pendingOpen,
} from "./openInCodeTab";
import { type BrowserLocation, useRightPanel } from "./useRightPanel";

const EMPTY_STATE: Record<GitDiffMode, string> = {
  local: "No local changes",
  branch: "No changes vs base",
};

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

const CodeTab: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
}> = (props) => {
  const { themeTypeLiteral: diffTheme } = useColorScheme();
  const rightPanel = useRightPanel();

  // Pierre captures `density` once at construction (like `initialExpansion`),
  // so snapshot the choice here rather than passing a reactive accessor in the
  // JSX, where it would read as reactive. Keyed on `isTouch` (input modality),
  // not `isMobile` (viewport): roomier rows are a tap-target affordance, so a
  // coarse-pointer tablet wider than `sm` wants them too.
  const treeDensity = isTouch() ? "relaxed" : undefined;

  // Read `codeMode` directly rather than projecting it from `activeTab`.
  // CodeTab now stays mounted across the Inspector tab toggle (#818); a
  // projection-with-fallback (`activeTab.kind === "code" ? mode : "local"`)
  // would flip `view()` from the persisted mode (e.g. `"browse"`) to the
  // fallback `"local"` while Inspector is active, then back on return —
  // a real value transition that fires the `slotKey` effect and
  // wipes selection on every Inspector round-trip in non-local modes.
  const view = rightPanel.codeMode;
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

  const repoPath = () => props.meta?.git?.repoRoot ?? null;

  // History records repo-relative `{ mode, path }` locations with no repo
  // identity of their own, so a stack captured in repo A must not be replayed
  // against repo B after a `cd`. `syncRepo` drops a terminal's history whenever
  // *that same terminal's* repo changes — back/forward then only ever retraces
  // locations from the repo currently shown, and the next selection re-seeds the
  // fresh stack.
  //
  // `CodeTab` is a singleton over the active terminal, so this effect only ever
  // feeds `syncRepo` the *active* terminal's `(id, repo)`. The reset decision
  // can't live here as a compare-against-previous-tick: `repoPath()` shifts on
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
      () => [props.terminalId, repoPath()] as const,
      ([tid, repo]) => {
        if (tid !== null) rightPanel.syncRepo(tid, repo);
      },
    ),
  );

  // Dismiss any open comment composer when the user navigates away from
  // the file/mode/repo the draft was anchored to. Without this, the
  // composer floats over a different file's content and the user has
  // to dismiss it manually. Draft body is lost, which matches every
  // other modal-on-navigate behavior in kolu.
  const composer = useComposer();
  createEffect(
    on(
      () => [selectedPath(), view(), repoPath()] as const,
      () => composer.close(),
      { defer: true },
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
  // The `slotKey` memo doubles as the source of truth for the
  // search-reset effect below; collision-safe by construction since
  // `view()` is a typed enum and `repoPath()` is absolute-or-null.
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
  const slotKey = createMemo(() => `${repoPath() ?? ""}::${view()}`);

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

  const status = app.streams.gitStatus.use(
    () => {
      const p = repoPath();
      const m = diffMode();
      return p && m ? { repoPath: p, mode: m } : null;
    },
    {
      onError: (err) => toast.error(`Git status stream: ${err.message}`),
    },
  );

  const allPaths = app.streams.fsListAll.use(
    () => {
      const p = repoPath();
      return p && view() === "browse" ? { repoPath: p } : null;
    },
    {
      onError: (err) => toast.error(`File list stream: ${err.message}`),
    },
  );

  // Browse decorates the full-repo tree with git status too — overlaying local
  // status (primary) on branch status (fallback) in `treeGitStatus` below.
  // Both inert outside browse (input fn → null), so Local/Branch modes — which
  // read decoration straight off the `status` stream — pay nothing for these.
  const browseLocalStatus = app.streams.gitStatus.use(
    () => {
      const p = repoPath();
      return p && view() === "browse"
        ? { repoPath: p, mode: "local" as const }
        : null;
    },
    {
      onError: (err) => toast.error(`Git status stream: ${err.message}`),
    },
  );
  // Best-effort branch layer: a repo with an `origin` remote whose default
  // branch isn't fetched errors with BASE_BRANCH_NOT_FOUND (review.ts
  // `resolveBase`) — an expected, not broken, state in this passive overlay.
  // Swallow it (no toast): the merge falls back to the always-available local
  // layer. The explicit Branch *mode* still surfaces the same error via its
  // own `status` subscription, where it's actionable ("run git fetch"). A
  // remote-less repo (#1244) degrades to an empty branch status instead of
  // erroring, so it never reaches this handler.
  const browseBranchStatus = app.streams.gitStatus.use(
    () => {
      const p = repoPath();
      return p && view() === "browse"
        ? { repoPath: p, mode: "branch" as const }
        : null;
    },
    {
      onError: () => {},
    },
  );

  const diff = app.streams.gitDiff.use(
    () => {
      const p = repoPath();
      const s = selectedPath();
      const m = diffMode();
      if (!p || !s || !m) return null;
      const file = status()?.files.find((f) => f.path === s);
      if (!file) return null;
      return { repoPath: p, filePath: s, mode: m, oldPath: file.oldPath };
    },
    {
      onError: (err) => toast.error(`Git diff stream: ${err.message}`),
    },
  );

  // Clear the filename filter when the slot changes — the search needle
  // was scoped to the previous file set and rarely makes sense post-
  // switch. Selection itself is per-slot (read/written via
  // `rightPanel.selectedFile(mode)` → `selectedFileByMode` on the
  // per-terminal record) so the new view automatically surfaces its own
  // pick without a clear here. `slotKey` is memoized, so this fires
  // only when the tuple genuinely changes — without the memo, `on(...)`
  // would re-run its callback on every incidental tick of `repoPath()`
  // (metadata cell) or `view()` (per-terminal in-memory store) and wipe
  // the filter spuriously after #818 made CodeTab survive right-panel
  // tab toggles.
  createEffect(
    on(
      slotKey,
      () => {
        setSearchQuery("");
      },
      { defer: true },
    ),
  );

  // Consume-once record for the latest pendingOpen tick. Holds the
  // full request object (reference identity discriminates two
  // structurally-identical clicks — `openInCodeTab` mints a fresh
  // object per call) alongside the resolved path. Storing the
  // request here lets `selectedRange` derive its value without
  // re-running `resolveLineRefPath` (single resolution site per
  // request).
  const [handled, setHandled] = createSignal<{
    request: OpenInCodeTabRequest;
    resolvedPath: string | null;
  } | null>(null);

  // Honor every `openInCodeTab` request — terminal file-ref clicks,
  // right-click "Open path:N" entries, and any future producer. The
  // effect waits for the live `fsListAll` stream to settle so
  // resolution can validate against a complete file list — otherwise
  // a request fired during boot would toast "not found" on a path
  // that just hasn't been enumerated yet. `openInCodeTab` flips the
  // panel to browse mode itself; this effect only sets `selectedPath`.
  createEffect(
    on(
      () => {
        const req = pendingOpen();
        const paths = treePaths();
        const isPending = allPaths.pending();
        return { req, repo: repoPath(), paths, isPending };
      },
      ({ req, repo, paths, isPending }) => {
        if (!req) return;
        if (handled()?.request === req) return;
        if (repo === null || repo !== req.repoRoot) return;
        if (view() !== req.targetMode || isPending) return;
        const rel = resolveLineRefPath({
          rawPath: req.ref.path,
          repoRoot: repo,
          cwd: req.cwd,
          repoPaths: paths,
          allowBasenameFallback: req.allowBasenameFallback,
        });
        if (rel === null) {
          toast.error(`File reference not found: ${req.ref.path}`);
          setHandled({ request: req, resolvedPath: null });
          return;
        }
        // Record the front-door open in history *with* its line ref, so a
        // later back() re-issues it through this same pipeline and repaints
        // the highlight (cheap-v1 "restore where you were"). Idempotent on
        // mode+path, so a re-click of the same path:line refreshes the entry
        // in place rather than deepening history. The echoed Pierre
        // `onSelect(rel)` is suppressed in `handleSelect` so it can't clobber
        // this ref with a plain (mode, path) record.
        select(req.targetMode, rel, {
          ref:
            req.ref.startLine !== null && req.ref.endLine !== null
              ? { startLine: req.ref.startLine, endLine: req.ref.endLine }
              : undefined,
        });
        setHandled({ request: req, resolvedPath: rel });
      },
      { defer: true },
    ),
  );

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

  const treePaths = createMemo(() => {
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
    if (view() === "browse") return [...(allPaths()?.paths ?? [])];
    return status()?.files.map((f) => f.path) ?? [];
  });

  const treeSearch = createMemo(() =>
    projectFileTreeSearch(treePaths(), searchQuery()),
  );

  // Track membership rather than the treePaths array identity: browse paths
  // come from a reconciled store array whose contents can change in place.
  // Gate on the relevant stream's `pending()` — when the gitStatus / fsList
  // stream resubscribes (e.g. on right-panel tab switch, since its inputFn
  // returns a fresh object literal), the value briefly resets to undefined
  // and `treePaths()` collapses to `[]`. Treating that transient empty as
  // "selected file is missing" would null `selectedPath` on every
  // resubscribe and lose the selection across tab toggles. Once the stream
  // has delivered (`!pending()`), an empty paths set IS authoritative —
  // the file truly went away (commit cleared local diff, rm deleted it).
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
        const isPending = isDiffView() ? status.pending() : allPaths.pending();
        const paths = treePaths();
        return { s, sk, pathExists: !s || isPending || paths.includes(s) };
      },
      (cur, prev) => {
        if (prev && prev.sk !== cur.sk) return;
        if (cur.s && !cur.pathExists) select(view(), null, { record: false });
      },
      { defer: true },
    ),
  );

  const treeGitStatus = createMemo(() => {
    // Browse overlays both layers (local primary, branch fallback). Outside
    // browse, decoration comes straight off the active mode's `status` stream.
    if (view() === "browse") {
      const local = browseLocalStatus()?.files ?? [];
      const branch = browseBranchStatus()?.files ?? [];
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
    // Tree-click to a different file ends the click-targeted-highlight
    // session — otherwise navigating back to the originally-targeted
    // file in the tree would resurrect the line range, surprising the
    // user who treated their tree click as a fresh intent. Same-file
    // tree-clicks don't trip this branch (Pierre fires `onSelect(rel)`
    // after our own programmatic `select(..., rel)` and the path
    // equals `handled.resolvedPath` in that case — leaving the highlight
    // intact for the lifetime of the request).
    const h = handled();
    if (h && h.resolvedPath !== null && h.resolvedPath !== path) {
      setHandled(null);
    }
    // Record the visit — unless this is Pierre's echoed re-select of the file a
    // front-door open just resolved (its resolution effect already recorded it
    // *with* the line ref; re-recording here would overwrite the ref with a
    // plain entry). A genuine tree/iframe pick records a (mode, path) entry,
    // dropping the line highlight exactly as the selection itself does.
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
      const repo = repoPath();
      if (repo === null) return;
      openInCodeTab({
        ref: {
          path: loc.path,
          startLine: loc.ref.startLine,
          endLine: loc.ref.endLine,
        },
        repoRoot: repo,
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

  const treeError = (): Error | undefined =>
    isDiffView() ? status.error() : allPaths.error();
  const treeReady = () => (isDiffView() ? status() : allPaths());
  const branchRef = (): string | null => status()?.base?.ref ?? null;
  // True only while Branch mode is the active view *and* its status has
  // loaded with no resolvable base (remote-less repo, #1244). `status`
  // only subscribes for the current view, so this can't be read in
  // browse/local view — there, `status()?.base` reflects local mode (always
  // null) and would falsely claim Branch has no base.
  const branchHasNoBase = (): boolean =>
    view() === "branch" && status()?.base === null;

  // Mode catalog — owns the list of views, their labels, hints, and
  // test IDs. Adding a new mode (e.g. "stash") happens here, plus the
  // data-source switch above. ModeChipPicker is purely a presenter.
  const modeOptions = createMemo<ModeOption[]>(() => {
    const ref = branchRef();
    const noBase = branchHasNoBase();
    return [
      {
        view: "browse",
        label: viewLabel("browse"),
        hint: "Browse the whole repo",
        testId: "diff-mode-browse",
        icon: FileBrowseIcon,
      },
      {
        view: "local",
        group: "Git",
        label: viewLabel("local"),
        hint: "Working tree vs HEAD",
        testId: "diff-mode-local",
        icon: GitBranchIcon,
      },
      {
        view: "branch",
        group: "Git",
        label: viewLabel("branch"),
        hint: ref
          ? `vs ${ref}`
          : noBase
            ? "No branch base to compare"
            : "Working tree vs branch base",
        testId: "diff-mode-branch",
        icon: GitBranchIcon,
      },
    ];
  });

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

  return (
    <Show
      when={repoPath()}
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
      <div
        class="flex flex-col h-full min-h-0 text-[11px]"
        data-testid="diff-tab"
        ref={attachBackForwardInputs}
      >
        <div class="flex items-center h-7 px-1.5 bg-surface-1/30 border-b border-edge shrink-0 gap-2">
          <div class="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              data-testid="code-tab-back-button"
              aria-label="Go back"
              title="Go back (Alt+←)"
              disabled={!rightPanel.canNavigateBack()}
              onClick={goBack}
              class="grid h-5 w-5 place-items-center rounded text-fg-3/70 transition-colors hover:bg-surface-2/60 hover:text-fg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRightIcon class="h-3.5 w-3.5 rotate-180" />
            </button>
            <button
              type="button"
              data-testid="code-tab-forward-button"
              aria-label="Go forward"
              title="Go forward (Alt+→)"
              disabled={!rightPanel.canNavigateForward()}
              onClick={goForward}
              class="grid h-5 w-5 place-items-center rounded text-fg-3/70 transition-colors hover:bg-surface-2/60 hover:text-fg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRightIcon class="h-3.5 w-3.5" />
            </button>
          </div>
          <ModeChipPicker
            view={view()}
            onViewChange={setView}
            modes={modeOptions()}
          />
          <FileSearchInput value={searchQuery()} onChange={setSearchQuery} />
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
            if (sizes[0] !== undefined) rightPanel.setCodeTabTreeSize(sizes[0]);
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
                        if (!m) return "Empty repository";
                        // Branch mode with no resolvable base (remote-less
                        // repo, #1244): there's nothing to compare against, so
                        // "No changes vs base" would be a false clean signal.
                        if (branchHasNoBase()) {
                          return "No branch base to compare";
                        }
                        return EMPTY_STATE[m];
                      })()}
                    </div>
                  }
                >
                  <div
                    class="h-full w-full min-h-0"
                    ref={(el) => {
                      // Keyed on `isMobile` (the mobile drawer layout), NOT
                      // `isTouch`: the workaround is for iOS native scroll
                      // failing to reach Pierre's shadow scroller below the
                      // *portaled* drawer (see pierreTouchScroll.ts). A touch
                      // tablet on the desktop split uses the non-portaled
                      // Resizable panel where native scroll works — attaching
                      // the driver there would preventDefault working scroll.
                      if (isMobile()) attachPierreTouchScroll(el);
                    }}
                  >
                    <FileTree
                      paths={treeSearch().projectedPaths}
                      gitStatus={treeGitStatus()}
                      selectedPath={selectedPath()}
                      onSelect={handleSelect}
                      initialExpansion={isDiffView() ? "open" : "closed"}
                      search={false}
                      expandPaths={treeSearch().expandedAncestors}
                      icons={pierreIconConfig}
                      shadowCss={pierreTreesShadowCss}
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
            class="min-h-0 overflow-auto"
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
                        {(d) => {
                          const repo = repoPath();
                          const tid = props.terminalId;
                          if (repo === null || tid === null) return null;
                          // The comment capture surface is applied here at the
                          // seam — `BrowseDiffView` is a pure presenter, exactly
                          // like `BrowseFileView`, so "is this commentable?"
                          // lives in one place per view family rather than being
                          // re-open-coded inside the leaf. `contentTick` is the
                          // raw hunk string so the highlight overlay re-anchors
                          // when a live edit re-diffs the file.
                          return (
                            <CommentTextSurface
                              terminalId={tid}
                              path={path}
                              contentTick={d().hunks[0] ?? ""}
                              class="h-full w-full"
                              lineAnchored={true}
                            >
                              <BrowseDiffView
                                path={path}
                                hunk={d().hunks[0] ?? ""}
                                theme={diffTheme()}
                                repoRoot={repo}
                              />
                            </CommentTextSurface>
                          );
                        }}
                      </Match>
                    </Switch>
                  </Match>
                  <Match when={!isDiffView()}>
                    {(() => {
                      const repo = repoPath();
                      const tid = props.terminalId;
                      if (repo === null || tid === null) return null;
                      return (
                        <BrowseFileDispatcher
                          terminalId={tid}
                          repoPath={repo}
                          filePath={path}
                          // The live repo file list — the vault a `[[wikilink]]`
                          // in the previewed doc resolves against, pathless —
                          // paired with its readiness as one value. `fsListAll`
                          // resubscribes (and briefly empties `treePaths()`) on
                          // tab toggles; `pending` rides alongside the snapshot
                          // so the click guard reads the readiness of the very
                          // list it resolves against, never a drifted pair.
                          repoVault={{
                            paths: treePaths(),
                            pending: allPaths.pending(),
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
                        />
                      );
                    })()}
                  </Match>
                </Switch>
              )}
            </Show>
          </Resizable.Panel>
        </Resizable>
        <Show when={repoPath() !== null && props.terminalId !== null}>
          {(_present) => (
            <>
              <CommentsTray
                terminalId={props.terminalId as string}
                onJumpTo={(comment) => {
                  const repo = repoPath();
                  if (repo === null) return;
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
                      ref: {
                        path: comment.path,
                        startLine: comment.lineRange.start,
                        endLine: comment.lineRange.end,
                      },
                      repoRoot: repo,
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
              <CommentComposer terminalId={props.terminalId as string} />
            </>
          )}
        </Show>
      </div>
    </Show>
  );
};

export default CodeTab;
