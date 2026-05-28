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
import {
  CodeView,
  type CodeViewItem,
  diffItem,
  FileTree,
  useCodeViewSelection,
} from "@kolu/solid-pierre";
import type { GitDiffMode } from "kolu-git/schemas";
import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
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
import { CommentComposer } from "../comments/CommentComposer";
import { CommentsTray } from "../comments/CommentsTray";
import { CommentTextSurface } from "../comments/CommentTextSurface";
import { useComposer } from "../comments/composerState";
import { useCommentScrollRequest } from "../comments/scrollRequest";
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
import { resolveLineRefPath } from "@kolu/file-line-ref";
import BrowseFileDispatcher from "./BrowseFileDispatcher";
import CodeMenuFrame from "./CodeMenuFrame";
import {
  openInCodeTab,
  type OpenInCodeTabRequest,
  pendingOpen,
} from "./openInCodeTab";
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

const CodeTab: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
}> = (props) => {
  const { themeTypeLiteral: diffTheme } = useColorScheme();
  const rightPanel = useRightPanel();

  // Read `codeMode` directly rather than projecting it from `activeTab`.
  // CodeTab now stays mounted across the Inspector tab toggle (#818); a
  // projection-with-fallback (`activeTab.kind === "code" ? mode : "local"`)
  // would flip `view()` from the persisted mode (e.g. `"browse"`) to the
  // fallback `"local"` while Inspector is active, then back on return —
  // a real value transition that fires the `slotKey` effect and
  // wipes selection on every Inspector round-trip in non-local modes.
  const view = rightPanel.codeMode;
  const setView = rightPanel.setCodeMode;

  const repoPath = () => props.meta?.git?.repoRoot ?? null;

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
  const setSelectedPath = (path: string | null) => {
    rightPanel.setSelectedFile(view(), path);
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
        });
        if (rel === null) {
          toast.error(`File reference not found: ${req.ref.path}`);
          setHandled({ request: req, resolvedPath: null });
          return;
        }
        setSelectedPath(rel);
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
        if (cur.s && !cur.pathExists) setSelectedPath(null);
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

        {/* Vertical split between tree and content via `@corvu/resizable`.
         *  Split fraction persists via `rightPanel.codeTabTreeSize` so
         *  reload restores the user's layout. The outer horizontal split
         *  used to be a Corvu Resizable too (in the now-renamed
         *  `RightPanelLayout`) but has since been replaced by a custom
         *  pointer-drag handle in `RightPanel.tsx` — see the
         *  `startIntersection` opt-out further down for the relic. */}
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
                    expandPaths={treeSearch().expandedAncestors}
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
          </Resizable.Panel>

          <Resizable.Handle
            data-testid="diff-tree-content-handle"
            aria-label="Resize tree pane"
            // Disable startIntersection (the handle's left edge): Corvu's
            // registerHandle keeps a *module-level* handles[] and pairs
            // handles whose orientations differ and rects touch at the
            // corner (see @corvu/resizable/dist/index.js:201–222). The
            // outer horizontal handle is no longer a Corvu Resizable
            // (it's a custom pointer-drag in `RightPanel.tsx` post-#986),
            // so the pairing bug is moot, but the opt-out is kept as
            // defense in case Pierre's tree ever introduces another
            // sibling Resizable that could pair with this handle.
            startIntersection={false}
            // `z-10` raises the ::before pseudo-element above Pierre's tree
            // (which is the previous flex sibling). Without it, the tree's
            // bottom 4px shadow the upper half of the handle's hit area —
            // Pierre's row hit-targets paint above the handle's absolute
            // ::before because both use auto z-index and the tree comes
            // first in document order with positioned descendants. Setting
            // `z-10` on the handle creates a stacking context that lifts
            // the ::before in front of the tree's interior.
            class="shrink-0 h-0 relative z-10 before:absolute before:inset-x-0 before:-top-1 before:h-2 before:cursor-row-resize before:hover:bg-accent/30 before:transition-colors"
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
                          // Single-file diff → one CodeView item. The wrapper
                          // virtualizes long diffs internally (50k-line lockfile,
                          // #809 / #514 Phase 8) — no separate scroll context
                          // component required.
                          const items = createMemo<CodeViewItem[]>(() => {
                            const item = diffItem(
                              path,
                              d().hunks[0] ?? "",
                              (err) =>
                                toast.error(
                                  `Diff parse failed: ${err.message}`,
                                ),
                            );
                            return item ? [item] : [];
                          });
                          return (
                            <CommentTextSurface
                              terminalId={tid}
                              path={path}
                              contentTick={d().hunks[0] ?? ""}
                              class="h-full w-full"
                            >
                              <CodeMenuFrame
                                path={path}
                                onOpen={(ref) => {
                                  openInCodeTab({
                                    ref,
                                    repoRoot: repo,
                                    targetMode: "browse",
                                  });
                                }}
                              >
                                {(selection) => {
                                  const codeViewSelection =
                                    useCodeViewSelection(
                                      () => path,
                                      selection.range,
                                    );
                                  return (
                                    <CodeView
                                      items={items()}
                                      theme={diffTheme()}
                                      diffStyle="unified"
                                      enableLineSelection
                                      selectedLines={codeViewSelection()}
                                      onSelectedLinesChange={(s) =>
                                        selection.handleSelect(s?.range ?? null)
                                      }
                                      onError={(err) =>
                                        toast.error(
                                          `Diff render failed: ${err.message}`,
                                        )
                                      }
                                      class="h-full w-full overflow-auto"
                                      style={pierreDiffsStyle}
                                      data-testid="pierre-diff-view"
                                    />
                                  );
                                }}
                              </CodeMenuFrame>
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
                          theme={diffTheme()}
                          initialSelectedLines={selectedRange()}
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
                    setSelectedPath(comment.path);
                  }
                  useCommentScrollRequest().set({
                    commentId: comment.id,
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
