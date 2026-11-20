import { useShown } from "../ui/shown";

import Resizable from "@corvu/resizable";
import {
  CODE_TAB_VIEW_ORDER,
  type CodeTabView,
  type TerminalMetadata,
  viewLabel,
} from "@kolu/padi-client/surface";
import { attachBackForwardMouse } from "@kolu/solid-browser";
import { FileTree, rowPathsCss } from "@kolu/solid-pierre";
import { toError } from "@kolu/surface/run-stream";
import { makeEventListener } from "@solid-primitives/event-listener";
import { Effect } from "effect";
import { encodeHostKey } from "kolu-common/hostKey";
import { buildTerminalFileUrl } from "kolu-common/preview";
import type { TerminalId } from "kolu-common/surface";
import type { GitDiffMode } from "kolu-git/schemas";
import {
  batch,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
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
import { triggerDownload } from "../download";
import { runActionPromise } from "../runAction";
import { useColorScheme } from "../settings/useColorScheme";
import { controlledSizes, realSizes } from "../ui/corvuResizable";
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
import DocLink from "../ui/DocLink";
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
import { activeHost, activePadiRpc } from "../wire";
import BrowseDiffView from "./BrowseDiffView";
import BrowseFileDispatcher from "./BrowseFileDispatcher";
import {
  type BrowseInventory,
  diffInventory,
  diskInventory,
  mergeBrowseInventory,
} from "./browseInventory";
import { codeLister } from "./codeLister";
import {
  type CodeTabOpenResolutionSource,
  type CodeTabScope,
  codeTabRepoSlotKey,
  codeTabSelectionInventoryVerdict,
  createCodeTabOpenController,
  type OpenInCodeTabRequest,
} from "./codeTabOpenController";
import FileSearchInput from "./FileSearchInput";
import { projectFileTreeSearch } from "./fileSearch";
import type { FileWithSource, FileWithUrl } from "@kolu/solid-fileview";
import {
  codeActiveStatus,
  codeAllPaths,
  codeDiskRootLevel,
  leaseCodeQueries,
  codeBranchStatus,
  codeDiff,
  codeFileContent,
  codeIgnoredPaths,
  codeLocalStatus,
  readFreshCodePaths,
  type ScopedCodePaths,
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

function openExternalFromSandboxedPreview(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

function ignoredRowDimmingSheet(ignored: readonly string[]): string {
  return ignored.length === 0
    ? pierreTreesShadowCss
    : `${pierreTreesShadowCss}\n${rowPathsCss(ignored, pierreTreesIgnoredRowDecl)}`;
}

function createSupersedingReads() {
  const byKey = new Map<string, AbortController>();
  return {
    start(key: string): AbortController {
      byKey.get(key)?.abort();
      const ctl = new AbortController();
      byKey.set(key, ctl);
      return ctl;
    },
    settle(key: string, ctl: AbortController): void {
      if (byKey.get(key) === ctl) byKey.delete(key);
    },
    abortAll(): void {
      for (const ctl of byKey.values()) ctl.abort();
      byKey.clear();
    },
  };
}

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
    classList={filterChipAccent(props.pressed === true)}
  >
    {props.children}
  </button>
);

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

const CodeTab: Component<{
  terminalId: TerminalId | null;
  meta: TerminalMetadata | null;
}> = (props) => {
  const { themeTypeLiteral: diffTheme } = useColorScheme();
  const shown = useShown();
  leaseCodeQueries(shown);
  const rightPanel = useRightPanel();
  const treeSizes = controlledSizes(() => [
    rightPanel.codeTabTreeSize(),
    1 - rightPanel.codeTabTreeSize(),
  ]);

  const treeDensity = isTouch() ? "relaxed" : undefined;

  const view = rightPanel.codeMode;
  const setView = rightPanel.setCodeMode;

  const renderTreeMenu = makeTreeContextMenu({
    view,
    navigate: (target, path) => {
      if (path !== null) select(target, path);
      setView(target);
    },
    viewsAvailable: () => lister() !== "disk",
    gitStatus: () => treeGitStatus(),
    download: (path) => {
      const scope = currentScope();
      if (scope === null) {
        toast.error(`Failed to download ${path}: no active terminal`);
        return;
      }
      triggerDownload(
        buildTerminalFileUrl(encodeHostKey(scope.host), scope.terminalId, path),
        path.slice(path.lastIndexOf("/") + 1),
      );
    },
  });

  const gitKind = () => props.meta?.git.kind ?? "none";
  const repoPath = () => {
    const git = props.meta?.git;
    return git?.kind === "repo" ? git.info.repoRoot : null;
  };
  const lister = () => codeLister(props.meta?.git);
  const readsFromDisk = () => lister() === "disk";

  createEffect(
    on(
      () => [props.terminalId, gitKind(), repoPath()] as const,
      ([tid, kind, repo]) => {
        if (tid === null || kind === "unresolved") return;
        rightPanel.syncRepo(tid, repo);
      },
    ),
  );

  const isDiffView = () => view() !== "browse";
  const diffMode = (): GitDiffMode | undefined =>
    view() === "browse" ? undefined : (view() as GitDiffMode);

  const currentScope = (): CodeTabScope | null => {
    const terminalId = props.terminalId;
    const repoRoot = repoPath();
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
    const repoRoot = repoPath();
    return terminalId === null || repoRoot === null
      ? null
      : { terminalId, repoRoot };
  });
  const browseFile = createMemo((): FileWithSource | FileWithUrl | null => {
    const content = codeFileContent();
    const at = commentContext();
    const path = rightPanel.selectedFile("browse");
    if (content === undefined || at === null || path === null) return null;
    return content.kind === "text"
      ? {
          path,
          source: { content: content.content, truncated: content.truncated },
        }
      : {
          path,
          url: `${buildTerminalFileUrl(
            encodeHostKey(activeHost()),
            at.terminalId,
            path,
          )}?v=${content.previewTag}`,
        };
  });
  const selectedPath = (): string | null => rightPanel.selectedFile(view());
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
  const repoSlotKey = createMemo(() => codeTabRepoSlotKey(currentScope()));

  const composer = useComposer();
  const composerAnchorKey = createMemo(() =>
    [
      props.terminalId ?? "",
      selectedPath() ?? "",
      view(),
      repoPath() ?? "",
    ].join("\0"),
  );
  createEffect(on(composerAnchorKey, () => composer.close(), { defer: true }));

  const [searchQuery, setSearchQuery] = createSignal("");

  const localStatus = codeLocalStatus;
  const branchStatus = codeBranchStatus;
  const activeStatus = codeActiveStatus;
  const allPaths = codeAllPaths;
  const ignoredPaths = codeIgnoredPaths;
  const diskRootLevel = codeDiskRootLevel;
  const diff = codeDiff;
  const status = () => activeStatus();
  const statusPending = () => activeStatus.pending();
  const statusError = () => activeStatus.error();

  createEffect(
    on(
      repoSlotKey,
      (key, previous) => {
        if (key === null || previous === null) return;
        setSearchQuery("");
        setRevealDir(null);
        supersedingReads.abortAll();
        setLoadedChildren(new Map());
      },
      { defer: true },
    ),
  );

  const [handled, setHandled] = createSignal<{
    request: OpenInCodeTabRequest;
    resolvedPath: string | null;
  } | null>(null);
  const [freshSelection, setFreshSelection] = createSignal<{
    request: OpenInCodeTabRequest;
    path: string;
  } | null>(null);

  const [revealDir, setRevealDir] = createSignal<{ path: string } | null>(null);

  const [loadedChildren, setLoadedChildren] = createSignal<
    ReadonlyMap<string, readonly string[]>
  >(new Map());

  const supersedingReads = createSupersedingReads();

  const loadLazyDirectory = (dirPath: string): Promise<void> => {
    const p = repoPath();
    if (!p) return Promise.resolve();
    const ctl = supersedingReads.start(dirPath);
    return runActionPromise(
      activePadiRpc.fs.listDirectory({ repoPath: p, dirPath }).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (ctl.signal.aborted) return;
            setLoadedChildren((prev) =>
              new Map(prev).set(dirPath, result.paths),
            );
          }),
        ),
        Effect.tapError((err) =>
          Effect.sync(() => {
            if (ctl.signal.aborted) return;
            toast.error(`Failed to list ${dirPath}: ${toError(err).message}`);
          }),
        ),
        Effect.asVoid,
        Effect.ensuring(
          Effect.sync(() => {
            supersedingReads.settle(dirPath, ctl);
          }),
        ),
      ),
      ctl.signal,
    );
  };

  const finishOpenRequest = (
    req: OpenInCodeTabRequest,
    resolved: Exclude<ReturnType<typeof resolveRef>, null>,
    source: CodeTabOpenResolutionSource,
  ): void => {
    if (resolved.kind === "directory") {
      setSearchQuery("");
      setRevealDir({ path: resolved.path });
      setFreshSelection(null);
      setHandled({ request: req, resolvedPath: null });
      return;
    }
    const rel = resolved.path;
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
        hasLine: request.ref.startLine !== null,
      }),
    readFresh: (request, includeIgnored) => {
      const by = lister();
      return by === null
        ? Effect.fail(new Error("No repository to read"))
        : readFreshCodePaths(
            request.scope.host,
            request.scope.repoRoot,
            by,
            includeIgnored,
          );
    },
    onResolved: finishOpenRequest,
    onNotFound: (request) => {
      toast.error(`File reference not found: ${request.ref.path}`);
      batch(() => {
        setFreshSelection(null);
        setHandled({ request, resolvedPath: null });
      });
    },
    onError: (request, error) => {
      toast.error(`File list refresh: ${error.message}`);
      batch(() => {
        setFreshSelection(null);
        setHandled({ request, resolvedPath: null });
      });
    },
  });

  const selectedRange = createMemo<{
    start: number;
    end: number;
  } | null>(() => {
    const req = pendingOpen();
    if (!req) return null;
    const h = handled();
    if (!h || h.request !== req || h.resolvedPath === null) return null;
    if (h.resolvedPath !== selectedPath()) return null;
    if (req.ref.startLine === null || req.ref.endLine === null) return null;
    return { start: req.ref.startLine, end: req.ref.endLine };
  });

  const treeInventory = createMemo<
    BrowseInventory & { scope: CodeTabScope | null }
  >(() => {
    const stampOf = (
      listing: ScopedCodePaths | undefined,
    ): CodeTabScope | null => {
      const current = currentScope();
      return current !== null && listing?.repoRoot === current.repoRoot
        ? current
        : null;
    };
    if (view() === "browse" && readsFromDisk()) {
      const rootLevel = diskRootLevel();
      return {
        ...diskInventory(
          rootLevel?.paths,
          loadedChildren(),
          diskRootLevel.pending(),
        ),
        scope: stampOf(rootLevel),
      };
    }
    if (view() === "browse") {
      const tracked = allPaths();
      const ignored = ignoredPaths();
      const showIgnored = showIgnoredFiles();
      const inventory = mergeBrowseInventory(
        tracked?.paths,
        ignored?.paths,
        loadedChildren(),
        {
          trackedPending: allPaths.pending(),
          ignoredPending: ignoredPaths.pending(),
          showIgnored,
        },
      );
      const trackedStamp = stampOf(tracked);
      const ignoredStamp = stampOf(ignored);
      const scope =
        trackedStamp !== null && (!showIgnored || ignoredStamp !== null)
          ? trackedStamp
          : null;
      return { ...inventory, scope };
    }
    return {
      ...diffInventory(
        status()?.files.map((f) => f.path) ?? [],
        statusPending(),
      ),
      scope: null,
    };
  });

  const treePaths = () => treeInventory().paths;

  const treeSearch = createMemo(
    () => projectFileTreeSearch(treePaths(), searchQuery()),
    undefined,
    {
      equals: (a, b) =>
        a.projectedPaths.length === b.projectedPaths.length &&
        a.projectedPaths.every((path, i) => path === b.projectedPaths[i]) &&
        a.expandedAncestors.length === b.expandedAncestors.length &&
        a.expandedAncestors.every((path, i) => path === b.expandedAncestors[i]),
    },
  );

  const treeShadowCss = createMemo(() =>
    ignoredRowDimmingSheet(treeInventory().ignored),
  );

  createEffect(
    on(
      () => {
        const s = selectedPath();
        const sk = repoSlotKey();
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
    if (view() === "browse") {
      const local = localStatus()?.files ?? [];
      const branch = branchStatus()?.files ?? [];
      return mergeGitStatusEntries(local, branch);
    }
    const s = status();
    return s ? mergeGitStatusEntries(s.files, []) : undefined;
  });

  const handleSelect = (path: string | null) => {
    if (path === null) return;
    setRevealDir(null);
    const h = handled();
    if (h && h.resolvedPath !== null && h.resolvedPath !== path) {
      setHandled(null);
    }
    select(view(), path, { record: h?.resolvedPath !== path });
  };

  const applyLocation = (loc: BrowserLocation) => {
    if (loc.ref && loc.path !== null) {
      const repo = repoPath();
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

  const browseListing = () => (readsFromDisk() ? diskRootLevel : allPaths);
  const treeError = (): Error | undefined =>
    isDiffView() ? statusError() : browseListing().error();
  const treeReady = () => (isDiffView() ? status() : browseListing()());
  const branchBase = () => {
    const s = branchStatus();
    return s?.mode === "branch" ? s.base : undefined;
  };
  const branchRef = (): string | null => branchBase()?.ref ?? null;
  const branchViewHasNoBase = () =>
    view() === "branch" && branchBase() === null;

  const localCount = (): number => localStatus()?.files.length ?? 0;
  const branchCount = (): number => branchStatus()?.files.length ?? 0;

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
          dividerBefore: true,
        },
        branch: {
          hint: ref
            ? `Working tree vs ${ref}`
            : noBase
              ? NO_BRANCH_BASE
              : "Working tree vs branch base",
          icon: GitBranchIcon,
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
        <Show
          when={gitKind() === "none"}
          fallback={<div class="h-full" data-testid="diff-git-unresolved" />}
        >
          <div
            class="flex flex-col items-center justify-center h-full text-fg-3/40 gap-2 text-[11px]"
            data-testid="diff-no-repo"
          >
            <GitBranchIcon class="w-8 h-8 opacity-40" />
            Not in a git repository
          </div>
        </Show>
      }
    >
      <div
        class="flex flex-col h-full min-h-0 text-[11px]"
        data-testid="diff-tab"
        ref={attachBackForwardInputs}
      >
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
          <Show when={!readsFromDisk()}>
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
          <Show when={view() === "browse" && !readsFromDisk()}>
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

        <Show when={readsFromDisk()}>
          <div
            class="shrink-0 border-b border-edge bg-surface-1/30 px-2 py-1 text-fg-3"
            data-testid="code-tab-disk-notice"
          >
            <span class="font-semibold text-fg-2">Bare repository.</span> Git
            has no file list for this folder, so kolu reads it from disk, one
            folder at a time.{" "}
            <DocLink slug="code-tab" anchor="a-folder-git-cannot-list">
              Learn more
            </DocLink>
          </div>
        </Show>

        <Resizable
          orientation="vertical"
          sizes={treeSizes()}
          onSizesChange={(sizes) => {
            const s = realSizes(sizes);
            if (s) rightPanel.setCodeTabTreeSize(s[0]);
          }}
          class="flex-1 min-h-0 overflow-hidden"
        >
          <Resizable.Panel
            as="div"
            data-testid="diff-file-list"
            data-corvu-no-drag=""
            class="min-h-0 border-b border-edge"
            minSize={0.1}
          >
            <div class="relative h-full w-full">
              <Show when={treeError()}>
                {(err) => (
                  <div
                    class="absolute inset-x-0 top-0 z-10 bg-surface-0 px-2 py-1 text-danger"
                    data-testid="diff-error"
                  >
                    Error: {err().message}
                  </div>
                )}
              </Show>
              <Show when={!treeReady() && !treeError()}>
                <div class="absolute inset-x-0 top-0 z-10 bg-surface-0 px-2 py-1 text-fg-3/50">
                  Loading…
                </div>
              </Show>
              <Show
                when={treeReady() && treePaths().length === 0 && !treeError()}
              >
                <div
                  class="absolute inset-x-0 top-0 z-10 bg-surface-0 px-2 py-4 text-fg-3/50 text-center"
                  data-testid="diff-empty"
                >
                  {diffMode()
                    ? branchViewHasNoBase()
                      ? NO_BRANCH_BASE
                      : EMPTY_STATE[diffMode()!]
                    : readsFromDisk()
                      ? "Empty folder"
                      : "Empty repository"}
                </div>
              </Show>
              <For each={CODE_TAB_VIEW_ORDER}>
                {(mode) => {
                  const frame = createMemo(
                    (
                      previous:
                        | {
                            paths: string[];
                            expanded: readonly string[];
                            gitStatus: ReturnType<typeof treeGitStatus>;
                            selected: string | null;
                            reveal: ReturnType<typeof revealDir>;
                            lazy: readonly string[];
                            epoch: string | null;
                            css: string;
                          }
                        | undefined,
                    ) =>
                      view() === mode && treeReady() && !treeError()
                        ? {
                            paths: treeSearch().projectedPaths,
                            expanded: treeSearch().expandedAncestors,
                            gitStatus: treeGitStatus(),
                            selected: selectedPath(),
                            reveal: revealDir(),
                            lazy: treeInventory().lazyDirs,
                            epoch: repoSlotKey(),
                            css: treeShadowCss(),
                          }
                        : previous,
                  );
                  return (
                    <Show when={frame()}>
                      {(current) => (
                        <div
                          data-code-tree-mode={mode}
                          class="absolute inset-0 h-full w-full min-h-0"
                          style={{
                            "content-visibility":
                              view() === mode ? "visible" : "hidden",
                            opacity: treeError() || !treeReady() ? 0.4 : 1,
                          }}
                          inert={
                            view() !== mode || !!treeError() || !treeReady()
                          }
                          ref={(el) => {
                            if (!isDesktop()) attachPierreTouchScroll(el);
                          }}
                        >
                          <FileTree
                            paths={current().paths}
                            gitStatus={current().gitStatus}
                            selectedPath={current().selected}
                            onSelect={handleSelect}
                            revealRequest={current().reveal}
                            lazyDirectories={current().lazy}
                            onExpandLazyDirectory={loadLazyDirectory}
                            lazyEpoch={current().epoch}
                            initialExpansion={
                              mode === "browse" ? "closed" : "open"
                            }
                            search={false}
                            expandPaths={current().expanded}
                            icons={pierreIconConfig}
                            shadowCss={current().css}
                            contextMenu={{
                              enabled: true,
                              triggerMode: "both",
                              render: renderTreeMenu,
                            }}
                            onError={(err) =>
                              toast.error(
                                `File tree render failed: ${err.message}`,
                              )
                            }
                            density={treeDensity}
                            class="h-full w-full"
                            style={pierreTreesStyle}
                          />
                        </div>
                      )}
                    </Show>
                  );
                }}
              </For>
            </div>
          </Resizable.Panel>

          <Resizable.Handle
            data-testid="diff-tree-content-handle"
            aria-label="Resize tree pane"
            startIntersection={false}
            class="shrink-0 h-0 relative before:absolute before:inset-x-0 before:-top-1 before:h-2 before:cursor-row-resize before:hover:bg-accent/30 before:transition-colors"
            style={{ "z-index": Z_HANDLE_INNER }}
          />

          <Resizable.Panel
            as="div"
            data-testid="diff-content"
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
                    <Show when={commentContext()}>
                      {(present) => (
                        <BrowseFileDispatcher
                          at={{
                            host: encodeHostKey(activeHost()),
                            terminalId: present().terminalId,
                          }}
                          filePath={path}
                          file={browseFile()}
                          error={codeFileContent.error()}
                          repoVault={{
                            paths: treePaths(),
                            pending: treeInventory().pending,
                          }}
                          theme={diffTheme()}
                          initialSelectedLines={selectedRange()}
                          onNavigate={handleSelect}
                          onHistory={(direction) =>
                            direction === "back" ? goBack() : goForward()
                          }
                          onOpenExternal={openExternalFromSandboxedPreview}
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
                    select("browse", comment.path);
                  }
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
