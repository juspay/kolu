import { type Accessor, createSignal, onCleanup } from "solid-js";
import type { CodeTabView } from "@kolu/padi-client/surface";
import type { Subscription } from "@kolu/surface/solid";
import { scopedByEntry } from "@kolu/surface-map/client";
import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import { isBinaryPreviewable } from "kolu-common/preview";
import type { GitDiffMode } from "kolu-git/schemas";
import type { GitFact } from "@kolu/terminal-vocab/schema";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { windowedSub } from "../hostScope/windowedSub.ts";
import {
  FILE_GONE,
  isDeclared,
  WORKTREE_BASE_BRANCH_MISSING,
} from "../rpc/declaredErrors";
import { useTerminalStore } from "../terminal/useTerminalStore";
import {
  activeHost,
  activePadiRpc,
  activePadiStreams,
  padiMap,
  padiRpcOf,
} from "../wire";
import { diskInventory, mergeBrowseInventory } from "./browseInventory";
import { type CodeLister, codeLister } from "./codeLister";
import { createPolledQuery, type PolledQueryConfig } from "./createPolledQuery";
import { showIgnoredFiles } from "./showIgnoredFiles";
import { useRightPanel } from "./useRightPanel";

export type BrowseFileContent =
  | { kind: "text"; content: string; truncated: boolean }
  | { kind: "binary"; previewTag: string };

export interface ScopedCodePaths {
  repoRoot: string;
  paths: readonly string[];
}

const [leases, setLeases] = createSignal<
  readonly { shown: Accessor<boolean> }[]
>([]);
export function leaseCodeQueries(shown: Accessor<boolean>): void {
  const lease = { shown };
  setLeases((previous) => [...previous, lease]);
  onCleanup(() =>
    setLeases((previous) => previous.filter((value) => value !== lease)),
  );
}
const codeShown = () => leases().some((lease) => lease.shown());

export interface ActiveCodeProjection {
  focusedGit: () => GitFact | undefined;
  codeMode: () => CodeTabView;
  selectedFile: (view: CodeTabView) => string | null;
}

function activeCodeProjection(): ActiveCodeProjection {
  const store = useTerminalStore();
  const rightPanel = useRightPanel();
  return {
    focusedGit: () => store.focused().meta?.git,
    codeMode: () => rightPanel.codeMode(),
    selectedFile: (view) => rightPanel.selectedFile(view),
  };
}

function buildHostCodeTab(
  ctx: { isActive: () => boolean },
  projection: ActiveCodeProjection,
) {
  const shownRepoPath = (): string | null => {
    const git = projection.focusedGit();
    return git?.kind === "repo" ? git.info.repoRoot : null;
  };
  const rootListedBy = (by: CodeLister): string | null =>
    codeLister(projection.focusedGit()) === by ? shownRepoPath() : null;
  const codeView = (): CodeTabView => projection.codeMode();
  const codeDiffMode = (): GitDiffMode | undefined =>
    codeView() === "browse" ? undefined : (codeView() as GitDiffMode);
  const codeSelectedPath = (): string | null =>
    projection.selectedFile(codeView());

  const authorities = {
    live: () => padiMap.live(),
    pulseHost: activeHost,
    active: () => ctx.isActive() && codeShown(),
  } as const;

  function repoPulseQuery<Input extends { repoPath: string }, Result>(
    config: Omit<
      PolledQueryConfig<Input, { repoPath: string }, unknown, Result>,
      "live" | "pulseHost" | "active" | "pulseProc" | "pulseInput"
    > & { enabled?: () => boolean },
  ): Subscription<Result> & { readonly complete: Accessor<boolean> } {
    return createPolledQuery({
      ...config,
      ...authorities,
      active: () => authorities.active() && (config.enabled?.() ?? true),
      pulseProc: () => activePadiStreams.subscribeRepoChange.unenrolled,
      pulseInput: (i) => ({ repoPath: i.repoPath }),
    });
  }

  const localStatus = repoPulseQuery({
    input: () => {
      const p = rootListedBy("git");
      return p ? { repoPath: p, mode: "local" as const } : null;
    },
    query: (i) => activePadiRpc.git.getStatus(i),
    onError: (err) => toast.error(`Git status stream: ${err.message}`),
  });

  const branchStatus = repoPulseQuery({
    input: () => {
      const p = rootListedBy("git");
      return p ? { repoPath: p, mode: "branch" as const } : null;
    },
    query: (i) => activePadiRpc.git.getStatus(i),
    onError: (err) => {
      if (isDeclared(err, WORKTREE_BASE_BRANCH_MISSING)) return;
      toast.error(`Git status stream: ${err.message}`);
    },
  });

  const selectedStatus = () =>
    codeDiffMode() === "branch" ? branchStatus : localStatus;
  const activeStatus = Object.assign(() => selectedStatus()(), {
    pending: () => selectedStatus().pending(),
    error: () => selectedStatus().error(),
    complete: () => selectedStatus().complete(),
  });

  const browseInput = (): { repoPath: string } | null => {
    const repoPath = rootListedBy("git");
    return repoPath === null ? null : { repoPath };
  };

  const allPaths = repoPulseQuery({
    enabled: () => codeView() === "browse",
    input: browseInput,
    query: (i) =>
      activePadiRpc.fs.listAll({ repoPath: i.repoPath }).pipe(
        Effect.map(
          (result): ScopedCodePaths => ({
            repoRoot: i.repoPath,
            paths: result.paths,
          }),
        ),
      ),
    onError: (err) => toast.error(`File list stream: ${err.message}`),
  });

  const diskRootLevel = repoPulseQuery({
    enabled: () => codeView() === "browse",
    input: () => {
      const repoPath = rootListedBy("disk");
      return repoPath === null ? null : { repoPath };
    },
    query: (i) =>
      activePadiRpc.fs
        .listDirectory({ repoPath: i.repoPath, dirPath: "" })
        .pipe(
          Effect.map(
            (result): ScopedCodePaths => ({
              repoRoot: i.repoPath,
              paths: result.paths,
            }),
          ),
        ),
    onError: (err) => toast.error(`Folder listing: ${err.message}`),
  });

  const ignoredPaths = repoPulseQuery({
    enabled: () => codeView() === "browse",
    input: () => (showIgnoredFiles() ? browseInput() : null),
    query: (i) =>
      activePadiRpc.fs.listIgnored({ repoPath: i.repoPath }).pipe(
        Effect.map(
          (result): ScopedCodePaths => ({
            repoRoot: i.repoPath,
            paths: result.paths,
          }),
        ),
      ),
    onError: (err) => toast.error(`Ignored file list: ${err.message}`),
  });

  const diff = repoPulseQuery({
    input: () => {
      const p = rootListedBy("git");
      const s = codeSelectedPath();
      const m = codeDiffMode();
      if (!p || !s || !m) return null;
      const file = activeStatus()?.files.find((f) => f.path === s);
      if (!file) return null;
      return { repoPath: p, filePath: s, mode: m, oldPath: file.oldPath };
    },
    query: (i) => activePadiRpc.git.getDiff(i),
    onError: (err) => toast.error(`Git diff stream: ${err.message}`),
  });

  const fileContent = createPolledQuery<
    { repoPath: string; filePath: string },
    { repoPath: string; filePath: string },
    unknown,
    BrowseFileContent
  >({
    ...authorities,
    active: () => authorities.active() && codeView() === "browse",
    input: () => {
      const p = shownRepoPath();
      const s = projection.selectedFile("browse");
      return p && s ? { repoPath: p, filePath: s } : null;
    },
    pulseProc: () => activePadiStreams.subscribeFileChange.unenrolled,
    pulseInput: (i) => i,
    query: (i) =>
      isBinaryPreviewable(i.filePath)
        ? activePadiRpc.fs
            .filePreviewTag({ repoPath: i.repoPath, filePath: i.filePath })
            .pipe(
              Effect.map(
                (previewTag): BrowseFileContent => ({
                  kind: "binary",
                  previewTag,
                }),
              ),
            )
        : activePadiRpc.fs
            .readFile({ repoPath: i.repoPath, filePath: i.filePath })
            .pipe(
              Effect.map(
                ({ content, truncated }): BrowseFileContent => ({
                  kind: "text",
                  content,
                  truncated,
                }),
              ),
            ),
    onError: (err) => toast.error(`File content stream: ${err.message}`),
    swallowError: (err) => isDeclared(err, FILE_GONE),
  });

  return {
    localStatus,
    branchStatus,
    activeStatus,
    allPaths,
    diskRootLevel,
    ignoredPaths,
    diff,
    fileContent,
  };
}

export type HostCodeTab = ReturnType<typeof buildHostCodeTab>;

const codeTabScopes = createSharedRoot(() =>
  scopedByEntry(padiMap, activeHost, (_host, ctx) =>
    buildHostCodeTab(ctx, activeCodeProjection()),
  ),
);

const activeHostCodeTab = (): HostCodeTab | undefined =>
  codeTabScopes().active();

export const codeLocalStatus = windowedSub(
  () => activeHostCodeTab()?.localStatus,
  (v) => v,
  undefined,
);
export const codeBranchStatus = windowedSub(
  () => activeHostCodeTab()?.branchStatus,
  (v) => v,
  undefined,
);
export const codeActiveStatus = windowedSub(
  () => activeHostCodeTab()?.activeStatus,
  (v) => v,
  undefined,
);
export const codeAllPaths = windowedSub(
  () => activeHostCodeTab()?.allPaths,
  (v) => v,
  undefined,
);
export const codeIgnoredPaths = windowedSub(
  () => activeHostCodeTab()?.ignoredPaths,
  (v) => v,
  undefined,
);
export const codeDiff = windowedSub(
  () => activeHostCodeTab()?.diff,
  (v) => v,
  undefined,
);
export const codeFileContent = windowedSub(
  () => activeHostCodeTab()?.fileContent,
  (v) => v,
  undefined,
);
export const codeDiskRootLevel = windowedSub(
  () => activeHostCodeTab()?.diskRootLevel,
  (v) => v,
  undefined,
);

export function readFreshCodePaths(
  host: HostKey,
  repoPath: string,
  lister: CodeLister,
  includeIgnored: boolean,
): Effect.Effect<string[], unknown> {
  const rpc = padiRpcOf(host);
  if (lister === "disk")
    return rpc.fs
      .listDirectory({ repoPath, dirPath: "" })
      .pipe(
        Effect.map((root) => diskInventory(root.paths, undefined, false).paths),
      );
  return Effect.all(
    [
      rpc.fs.listAll({ repoPath }),
      includeIgnored
        ? rpc.fs.listIgnored({ repoPath })
        : Effect.succeed(undefined),
    ],
    { concurrency: 2 },
  ).pipe(
    Effect.map(
      ([tracked, ignored]) =>
        mergeBrowseInventory(tracked.paths, ignored?.paths, undefined, {
          trackedPending: false,
          ignoredPending: false,
          showIgnored: includeIgnored,
        }).paths,
    ),
  );
}
