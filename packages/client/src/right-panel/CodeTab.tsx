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

import { FileDiff, FileTree, Virtualizer } from "@kolu/solid-pierre";
import type { GitDiffMode } from "kolu-git/schemas";
import type { TerminalMetadata } from "kolu-common/surface";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  Show,
  Switch,
} from "solid-js";
import { toast } from "solid-sonner";
import { useColorScheme } from "../settings/useColorScheme";
import { app } from "../wire";
import { FileBrowseIcon, FileDiffIcon, GitBranchIcon } from "../ui/Icons";
import {
  renderTreeContextMenu,
  toGitStatusEntries,
} from "../ui/pierreAdapters";
import {
  pierreDiffsStyle,
  pierreIconConfig,
  pierreTreesStyle,
} from "../ui/pierreTheme";
import { resolveLineRefPath } from "../ui/lineRef";
import BrowseFileView from "./BrowseFileView";
import { pendingCodeOpen } from "./codeNavigation";
import CodeMenuFrame from "./CodeMenuFrame";
import { projectFileTreeSearch } from "./fileSearch";
import FileSearchInput from "./FileSearchInput";
import ModeChipPicker, { type ModeOption } from "./ModeChipPicker";
import { useRightPanel } from "./useRightPanel";

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

const CodeTab: Component<{ meta: TerminalMetadata | null }> = (props) => {
  const { themeTypeLiteral: diffTheme } = useColorScheme();
  const rightPanel = useRightPanel();
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);

  // Read `codeMode` directly rather than projecting it from `activeTab`.
  // CodeTab now stays mounted across the Inspector tab toggle (#818); a
  // projection-with-fallback (`activeTab.kind === "code" ? mode : "local"`)
  // would flip `view()` from the persisted mode (e.g. `"browse"`) to the
  // fallback `"local"` while Inspector is active, then back on return —
  // a real value transition that fires the `resetKey` reset effect and
  // wipes selection on every Inspector round-trip in non-local modes.
  const view = rightPanel.codeMode;
  const setView = rightPanel.setCodeMode;

  const repoPath = () => props.meta?.git?.repoRoot ?? null;
  const isDiffView = () => view() !== "browse";
  const diffMode = (): GitDiffMode | undefined =>
    view() === "browse" ? undefined : (view() as GitDiffMode);

  // Filename filter — drives Pierre's tree filter externally. Reset on
  // mode switch so a stale needle doesn't hide the wrong file set.
  const [searchQuery, setSearchQuery] = createSignal("");

  // ── Selection-stability invariant ──────────────────────────────────
  // CodeTab survives right-panel tab toggles and panel collapse (#818)
  // — meaning every reactive surface in this component stays alive
  // across UI state changes that previously destroyed and rebuilt it.
  // Three independent sources of `selectedPath = null` would fire
  // spuriously without explicit guards; each guard defends against a
  // *different* origin of churn, so they don't collapse into one rule:
  //
  //   1. `resetKey` memo (below) — preferences cell ticks on unrelated
  //      pref updates; raw `on([repoPath, view], …)` would re-fire its
  //      callback every tick and wipe selection.
  //   2. `pending()` gate on the membership check — gitStatus / fsList
  //      stream resubscribes briefly drop `treePaths()` to `[]`; without
  //      the gate, the membership check reads transient empty as
  //      "selected file is missing".
  //   3. `handleSelect` ignores Pierre's `null` events — Pierre fires
  //      `onSelectionChange([])` from `resetPaths` and tear-down, not
  //      just user deselect; the Code tab has no UX for explicit
  //      deselect anyway (user switches by clicking another file).
  //
  // The unifying invariant is "preserve selection across non-genuine
  // transitions". Adding a fourth churn source means adding a fourth
  // guard in the same shape — extract a `createStableSignal`-style
  // helper if/when it appears.

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

  // Reset selection when the repo or view changes so a stale path doesn't
  // bleed across modes (e.g. a browse-mode pick showing up in diff mode).
  // Same reset clears the filename filter — the search needle was scoped
  // to the previous file set and rarely makes sense post-switch.
  //
  // The `on()` here is paired with a memoized key so it only fires when
  // the (repoPath, view) tuple actually CHANGES VALUE. Without the memo,
  // SolidJS' `on(...)` re-runs its callback on every upstream signal tick
  // — and the upstream `preferences` cell ticks on activity beyond just
  // tab/repo changes (e.g. unrelated pref updates). Since the callback
  // unconditionally nulls `selectedPath`, an unmemoed accessor wipes the
  // user's selection on every preference tick — visible after #818 made
  // CodeTab survive across right-panel tab toggles.
  //
  // `::` is collision-safe as the separator: `view()` is a typed enum
  // (`"browse" | "local" | "branch"`) so it can't contain `::`, and
  // `repoPath()` is `props.meta?.git?.repoRoot ?? null` — a real
  // absolute path or `null`, never the empty string that would alias
  // null.
  const resetKey = createMemo(() => `${repoPath() ?? ""}::${view()}`);
  createEffect(
    on(
      resetKey,
      () => {
        setSearchQuery("");
        // Skip the selectedPath clear when an incoming request is
        // about to land in the new mode — the resetKey effect runs
        // before the pendingCodeOpen effect (registration order), and
        // an unconditional clear would null what we're about to set.
        // Reading `req.targetMode` (not `view()`) makes the guard
        // robust to user-driven mode flips that race the click.
        const req = pendingCodeOpen();
        if (
          req &&
          req.repoRoot === repoPath() &&
          req.targetMode === view() &&
          handled()?.token !== req.token
        ) {
          return;
        }
        setSelectedPath(null);
      },
      { defer: true },
    ),
  );

  // Consume-once record for the latest pendingCodeOpen tick.
  // Storing the resolved path here lets `selectedRange` derive its
  // value without re-running `resolveLineRefPath` (single resolution
  // site per request) and lets `resetKey` know whether a pending
  // request has already been applied.
  const [handled, setHandled] = createSignal<{
    token: number;
    resolvedPath: string | null;
  } | null>(null);

  // Honor terminal file-ref clicks. The effect waits for the live
  // `fsListAll` stream to settle so resolution can validate against
  // a complete file list — otherwise a request fired during boot
  // would toast "not found" on a path that just hasn't been
  // enumerated yet. The terminal click handler is the sole site that
  // flips the panel to browse mode; this effect only sets
  // `selectedPath`. The `resetKey` effect above guards against
  // clearing selectedPath when this effect is about to set it.
  createEffect(
    on(
      () => {
        const req = pendingCodeOpen();
        const paths = treePaths();
        const isPending = allPaths.pending();
        return { req, repo: repoPath(), paths, isPending };
      },
      ({ req, repo, paths, isPending }) => {
        if (!req) return;
        if (handled()?.token === req.token) return;
        if (repo === null || repo !== req.repoRoot) return;
        if (view() !== req.targetMode || isPending) return;
        const rel = resolveLineRefPath({
          rawPath: req.ref.path,
          repoRoot: repo,
          cwd: req.cwd,
          repoPaths: paths,
        });
        if (rel === null) {
          toast.error(`File reference not found: ${req.ref.path}`);
          setHandled({ token: req.token, resolvedPath: null });
          return;
        }
        setSelectedPath(rel);
        setHandled({ token: req.token, resolvedPath: rel });
      },
      { defer: true },
    ),
  );

  // Highlight range derives from the consume-once record: if the
  // latest handled token matches the latest request AND its resolved
  // path is still the rendered file, surface the line range. Any
  // navigation away (user tree-click, mode switch) flips
  // `selectedPath` and naturally invalidates the memo — no second
  // resolution call.
  const selectedRange = createMemo<{
    start: number;
    end: number;
  } | null>(
    () => {
      const req = pendingCodeOpen();
      if (!req) return null;
      const h = handled();
      if (!h || h.token !== req.token || h.resolvedPath === null) return null;
      if (h.resolvedPath !== selectedPath()) return null;
      return { start: req.ref.startLine, end: req.ref.endLine };
    },
    null,
    {
      // Same-value re-emits cause the line-selection controller to
      // re-fire its initial-range effect with an identical object.
      // Equality-gating here keeps the controller stable when the
      // request hasn't actually changed.
      equals: (a, b) =>
        a === b || (!!a && !!b && a.start === b.start && a.end === b.end),
    },
  );

  const treePaths = createMemo(() => {
    if (view() === "browse") return allPaths()?.paths ?? [];
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
  createEffect(
    on(
      () => {
        const s = selectedPath();
        const isPending = isDiffView() ? status.pending() : allPaths.pending();
        const paths = treePaths();
        return [s, !s || isPending || paths.includes(s)] as const;
      },
      ([path, pathExists]) => {
        if (path && !pathExists) setSelectedPath(null);
      },
      { defer: true },
    ),
  );

  const treeGitStatus = createMemo(() => {
    const s = status();
    return s ? toGitStatusEntries(s.files) : undefined;
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
    // after our own programmatic `setSelectedPath(rel)` and the path
    // equals `handled.resolvedPath` in that case — leaving the highlight
    // intact for the lifetime of the request).
    const h = handled();
    if (h && h.resolvedPath !== null && h.resolvedPath !== path) {
      setHandled(null);
    }
    setSelectedPath(path);
  };

  const treeError = (): Error | undefined =>
    isDiffView() ? status.error() : allPaths.error();
  const treeReady = () => (isDiffView() ? status() : allPaths());
  const branchRef = (): string | null => status()?.base?.ref ?? null;

  // Mode catalog — owns the list of views, their labels, hints, and
  // test IDs. Adding a new mode (e.g. "stash") happens here, plus the
  // data-source switch above. ModeChipPicker is purely a presenter.
  const modeOptions = createMemo<ModeOption[]>(() => {
    const ref = branchRef();
    return [
      {
        view: "browse",
        label: "All files",
        hint: "Browse the whole repo",
        testId: "diff-mode-browse",
        icon: FileBrowseIcon,
      },
      {
        view: "local",
        group: "Git",
        label: "Local",
        hint: "Working tree vs HEAD",
        testId: "diff-mode-local",
        icon: GitBranchIcon,
      },
      {
        view: "branch",
        group: "Git",
        label: "Branch",
        hint: ref ? `vs ${ref}` : "Working tree vs branch base",
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
      >
        <div class="flex items-center h-7 px-1.5 bg-surface-1/30 border-b border-edge shrink-0 gap-2">
          <ModeChipPicker
            view={view()}
            onViewChange={setView}
            modes={modeOptions()}
          />
          <FileSearchInput value={searchQuery()} onChange={setSearchQuery} />
        </div>

        <div
          class="shrink-0 h-[35%] min-h-0 border-b border-edge"
          data-testid="diff-file-list"
        >
          <Switch fallback={<div class="px-2 py-1 text-fg-3/50">Loading…</div>}>
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
                      return m ? EMPTY_STATE[m] : "Empty repository";
                    })()}
                  </div>
                }
              >
                <FileTree
                  paths={treeSearch().projectedPaths}
                  gitStatus={treeGitStatus()}
                  selectedPath={selectedPath()}
                  onSelect={handleSelect}
                  initialExpansion={isDiffView() ? "open" : "closed"}
                  search={false}
                  searchQuery={treeSearch().pierreSearchQuery}
                  onSearchClearedByRowClick={() => setSearchQuery("")}
                  icons={pierreIconConfig}
                  contextMenu={{
                    enabled: true,
                    triggerMode: "both",
                    render: renderTreeContextMenu,
                  }}
                  onError={(err) =>
                    toast.error(`File tree render failed: ${err.message}`)
                  }
                  class="h-full w-full"
                  style={pierreTreesStyle}
                />
              </Show>
            </Match>
          </Switch>
        </div>

        <div class="flex-1 min-h-0 overflow-auto" data-testid="diff-content">
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
              // changes. Pierre's `FileDiff.render(newFileDiff)` reuses
              // the same instance — its line-selection handlers don't
              // re-bind to the new gutter elements, so right-clicking on
              // a line in the second file would yield a "Copy path" menu
              // with no "Copy path:line" entry. Per-file remount gives
              // each file a fresh `FileDiff` and a clean
              // `useLineSelection` range, which is also the right
              // semantic — line refs don't survive across files.
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
                        <CodeMenuFrame path={path}>
                          {(selection) => (
                            // `<Virtualizer>` is the scroll container —
                            // `<FileDiff>` consumes its context and
                            // upgrades to Pierre's `VirtualizedFileDiff`,
                            // windowing huge diffs (50k-line lockfile,
                            // #809 / #514 Phase 8). Without this wrapper
                            // `<FileDiff>` falls back to the vanilla
                            // class — same as before.
                            <Virtualizer
                              class="h-full w-full overflow-auto"
                              style={pierreDiffsStyle}
                            >
                              <FileDiff
                                rawDiff={d().hunks[0] ?? ""}
                                theme={diffTheme()}
                                enableLineSelection
                                onLineSelected={selection.handleSelect}
                                onError={(err) =>
                                  toast.error(
                                    `Diff render failed: ${err.message}`,
                                  )
                                }
                                class="w-full"
                              />
                            </Virtualizer>
                          )}
                        </CodeMenuFrame>
                      )}
                    </Match>
                  </Switch>
                </Match>
                <Match when={!isDiffView()}>
                  {(() => {
                    const repo = repoPath();
                    if (repo === null) return null;
                    return (
                      <BrowseFileView
                        repoPath={repo}
                        filePath={path}
                        theme={diffTheme()}
                        initialSelectedLines={selectedRange()}
                      />
                    );
                  })()}
                </Match>
              </Switch>
            )}
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default CodeTab;
