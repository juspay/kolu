/** A CODE VIEW'S READS — one builder for the query set a Code view stands on,
 *  from what the view is about (a {@link CodeSubject}) and where its place is
 *  kept (a {@link CodeViewState}).
 *
 *  The set is the pulse-then-requery reads: the three git status streams
 *  (local / branch / active-view), the browse file list, the gitignored
 *  overlay, the from-disk root level of a folder git cannot list, the diff,
 *  and the browse file-content — each one {@link createPolledQuery}. Every one
 *  of them calls THE SUBJECT'S HOST: its procedures and its change pulses are
 *  that host's, so a view about a worktree on one machine never reads the
 *  machine the page happens to show.
 *
 *  Who OWNS a set is the caller's business. The Right panel keeps one retained
 *  set per host and hands its view a window over the shown host's
 *  (`hostCodeTab.ts`); another caller builds one under its own owner.
 *
 *  NOTHING READS WHILE NOBODY LOOKS: a set is idle unless `active` says so,
 *  and the caller's `active` includes the set's own {@link createCodeLeases}
 *  — each mounted view leases its visibility on the set it was handed, so a
 *  view shown somewhere else never wakes a set it does not read. */

import type { CodeTabView } from "@kolu/padi-client/surface";
import type { Subscription } from "@kolu/surface/solid";
import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import { isBinaryPreviewable } from "kolu-common/preview";
import type {
  GitDiffMode,
  GitDiffOutput,
  GitStatusOutput,
} from "kolu-git/schemas";
import { type Accessor, createEffect, createSignal } from "solid-js";
import { toast } from "solid-sonner";
import {
  FILE_GONE,
  isDeclared,
  WORKTREE_BASE_BRANCH_MISSING,
} from "../rpc/declaredErrors";
import { padiMap, padiRpcOf } from "../wire";
import { diskInventory, mergeBrowseInventory } from "./browseInventory";
import type { CodeLister } from "./codeLister";
import type { CodeSubject } from "./codeSubject";
import type { CodeViewState } from "./codeViewState";
import { createPolledQuery, type PolledQueryConfig } from "./createPolledQuery";
import { showIgnoredFiles } from "./showIgnoredFiles";

/** The client-side text|binary partition, off the wire. `padiSurface`'s
 *  `fs.readFile` is TEXT-ONLY, so binary vs text is decided here, where the
 *  query lives. A binary-previewable file reads a CONTENT hash
 *  (`fs.filePreviewTag`), from which the view builds the
 *  `/api/terminals/:host/:id/file?v=<tag>` URL so a real content change bumps
 *  the URL (img/iframe reload) while an identical-content rewrite leaves it
 *  stable; a text file reads its content. */
export type BrowseFileContent =
  | { kind: "text"; content: string; truncated: boolean }
  | { kind: "binary"; previewTag: string };

/** A file listing stamped with the REPO it was read for. The terminal is
 *  deliberately absent: a listing is a fact about the repo, so the query is keyed
 *  on the repo alone — a focus move between two panes of one repo must not
 *  refetch it — and the consumer builds the `CodeTabScope` stamp from this repo
 *  plus the owner it is showing. */
export interface ScopedCodePaths {
  repoRoot: string;
  /** `readonly`, because it IS the decoded wire array (Effect's `Schema.Array`
   *  decodes to a readonly array) — carried through rather than copied. */
  paths: readonly string[];
}

type CodeQuery<T> = Subscription<T>;

/** The reads a Code view is handed. */
export interface CodeQueries {
  readonly localStatus: CodeQuery<GitStatusOutput>;
  readonly branchStatus: CodeQuery<GitStatusOutput>;
  readonly activeStatus: CodeQuery<GitStatusOutput>;
  readonly allPaths: CodeQuery<ScopedCodePaths>;
  readonly diskRootLevel: CodeQuery<ScopedCodePaths>;
  readonly ignoredPaths: CodeQuery<ScopedCodePaths>;
  readonly diff: CodeQuery<GitDiffOutput>;
  readonly fileContent: CodeQuery<BrowseFileContent>;
  /** Lease the mounted view's visibility on THIS set; disposal withdraws it. */
  readonly lease: (shown: Accessor<boolean>) => void;
}

/** The visibility leases of ONE query set: each mounted view adds its own
 *  `shown`, and the set reads while any of them is shown. */
export function createCodeLeases(): {
  readonly lease: (shown: Accessor<boolean>) => void;
  readonly shown: Accessor<boolean>;
} {
  const [leases, setLeases] = createSignal<
    readonly { shown: Accessor<boolean> }[]
  >([]);
  return {
    // Called from a view's COMPONENT BODY, where writing a signal is
    // REACTIVE_WRITE_IN_OWNED_SCOPE. So the lease is added in the EFFECT
    // phase and dropped by the cleanup that effect returns, which runs on the
    // leasing view's disposal — the lifetime the body-level `onCleanup` used
    // to give it. The compute is a constant, so the effect runs exactly once
    // per mounted view; the only change is that the set reports itself shown
    // from the mounting flush on, rather than from the middle of the body.
    lease: (shown) => {
      const lease = { shown };
      createEffect(
        () => lease,
        (value) => {
          setLeases((previous) => [...previous, value]);
          return () =>
            setLeases((previous) => previous.filter((v) => v !== value));
        },
      );
    },
    shown: () => leases().some((lease) => lease.shown()),
  };
}

/** Build one Code view's queries. `subject` names the host every read goes
 *  to and the root it reads; `state` names the mode and the selected file;
 *  `active` is when the set may read at all. */
export function buildCodeQueries(input: {
  subject: Accessor<CodeSubject>;
  state: Pick<CodeViewState, "codeMode" | "selectedFile">;
  active: Accessor<boolean>;
}): Omit<CodeQueries, "lease"> {
  const { subject, state } = input;
  const host = (): HostKey => subject().host;
  const rpc = () => padiRpcOf(host());
  const streams = () => padiMap.entry(host()).streams;

  const shownRepoPath = (): string | null => {
    const git = subject().git;
    return git.kind === "repo" ? git.root : null;
  };
  // The root, when `by` is who lists it: git, or the disk when git cannot (a
  // bare repo's folder). Every git read below asks for "git", so the failing
  // `git ls-files` / `git status` calls on a root with no working tree are
  // simply never made; the one disk read asks for "disk".
  const rootListedBy = (by: CodeLister): string | null => {
    const git = subject().git;
    return git.kind === "repo" && git.lister === by ? git.root : null;
  };
  const codeView = (): CodeTabView => state.codeMode();
  const codeDiffMode = (): GitDiffMode | undefined =>
    codeView() === "browse" ? undefined : (codeView() as GitDiffMode);
  const codeSelectedPath = (): string | null => state.selectedFile(codeView());

  // The ownership authorities, injected once — `live` is the map's transport
  // liveness, `pulseHost` is the subject's host (a bare host change on the same
  // input value still re-keys the pulse), `active` is the caller's gate.
  const authorities = {
    live: () => padiMap.live(),
    pulseHost: host,
    active: input.active,
  } as const;

  // The three git status reads + the browse file list share the repo-change
  // pulse keyed on `repoPath`. A local helper — this is the only site, so it is
  // a leaf, not a receptacle.
  function repoQuery<Input extends { repoPath: string }, Result>(
    config: Omit<
      PolledQueryConfig<Input, { repoPath: string }, unknown, Result>,
      "live" | "pulseHost" | "active" | "pulseProc" | "pulseInput"
    > & { enabled?: () => boolean },
  ): Subscription<Result> & { readonly complete: Accessor<boolean> } {
    return createPolledQuery({
      ...config,
      ...authorities,
      active: () => authorities.active() && (config.enabled?.() ?? true),
      pulseProc: () => streams().subscribeRepoChange.unenrolled,
      pulseInput: (i) => ({ repoPath: i.repoPath }),
    });
  }

  // Always-on local status — feeds the Local badge/count and the browse-tree
  // overlay, independent of the active view.
  const localStatus = repoQuery({
    input: () => {
      const p = rootListedBy("git");
      return p ? { repoPath: p, mode: "local" as const } : null;
    },
    query: (i) => rpc().git.getStatus(i),
    onError: (err) => toast.error(`Git status stream: ${err.message}`),
  });

  // Always-on branch status — feeds the Branch badge/count, base/ref, and overlay.
  // The un-fetched-base case (`WorktreeBaseBranchMissing`) raises no toast: this
  // passive read runs in every view and only feeds a badge. The Branch view
  // itself shows the error's sentence (with its `git fetch` fix) in its banner,
  // through `activeStatus.error`; any other failure toasts.
  const branchStatus = repoQuery({
    input: () => {
      const p = rootListedBy("git");
      return p ? { repoPath: p, mode: "branch" as const } : null;
    },
    query: (i) => rpc().git.getStatus(i),
    onError: (err) => {
      if (isDeclared(err, WORKTREE_BASE_BRANCH_MISSING)) return;
      toast.error(`Git status stream: ${err.message}`);
    },
  });

  // Reuse the retained status reads; mode changes do not create a second query.
  const selectedStatus = () =>
    codeDiffMode() === "branch" ? branchStatus : localStatus;
  const activeStatus = Object.assign(() => selectedStatus()(), {
    pending: () => selectedStatus().pending(),
    error: () => selectedStatus().error(),
    complete: () => selectedStatus().complete(),
  });

  // "The browse tree is live" — spelled once, so the two listings that feed it
  // cannot drift into querying for different views (a new view mode added to one
  // and not the other would silently fetch an overlay for a tree that isn't
  // mounted). The diff modes read the status files instead of either listing.
  //
  // Keyed on the REPO alone, never the pane: the listing is a fact about the
  // repo, and focus moves between panes are far more frequent than tile
  // switches — with the terminal id in the key, every click between two panes of
  // one repo blanked the tree and re-dispatched `fs.listAll` for a fact that had
  // not changed.
  const browseInput = (): { repoPath: string } | null => {
    const repoPath = rootListedBy("git");
    return repoPath === null ? null : { repoPath };
  };

  // The whole-repo file list.
  const allPaths = repoQuery({
    enabled: () => codeView() === "browse",
    input: browseInput,
    query: (i) =>
      rpc()
        .fs.listAll({ repoPath: i.repoPath })
        .pipe(
          Effect.map(
            (result): ScopedCodePaths => ({
              repoRoot: i.repoPath,
              paths: result.paths,
            }),
          ),
        ),
    onError: (err) => toast.error(`File list stream: ${err.message}`),
  });

  // The root level of a folder git cannot list (a bare repository's folder),
  // read from disk — the `allPaths` of disk mode. One level: every folder in it
  // is opened on click, through the same lazy-directory read the ignored
  // overlay uses. It rides the same repo-change pulse as the git reads, which
  // on such a root moves only with HEAD and the index; nothing new is watched.
  const diskRootLevel = repoQuery({
    enabled: () => codeView() === "browse",
    input: () => {
      const repoPath = rootListedBy("disk");
      return repoPath === null ? null : { repoPath };
    },
    query: (i) =>
      rpc()
        .fs.listDirectory({ repoPath: i.repoPath, dirPath: "" })
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

  // The gitignored overlay — a SEPARATE query, idle (null input) unless the
  // show-ignored toggle is on. Keeping it off `allPaths` is what lets the toggle
  // flip without disturbing the main file list: as a field on that query's input
  // it would join its value key, so every flip would blank the list, unmount
  // `<FileTree>`, and remount it collapsed — losing every hand-expanded folder
  // and the scroll position. Idling the input instead means the toggle costs the
  // extra `git ls-files` spawn only while the user actually wants the overlay.
  const ignoredPaths = repoQuery({
    enabled: () => codeView() === "browse",
    input: () => (showIgnoredFiles() ? browseInput() : null),
    query: (i) =>
      rpc()
        .fs.listIgnored({ repoPath: i.repoPath })
        .pipe(
          Effect.map(
            (result): ScopedCodePaths => ({
              repoRoot: i.repoPath,
              paths: result.paths,
            }),
          ),
        ),
    onError: (err) => toast.error(`Ignored file list: ${err.message}`),
  });

  // The active file's diff — its input reads THIS set's own `activeStatus`
  // result to find the file's `oldPath` (a cross-query dependency that rides
  // one owner).
  const diff = repoQuery({
    input: () => {
      const p = rootListedBy("git");
      const s = codeSelectedPath();
      const m = codeDiffMode();
      if (!p || !s || !m) return null;
      const file = activeStatus()?.files.find((f) => f.path === s);
      if (!file) return null;
      return { repoPath: p, filePath: s, mode: m, oldPath: file.oldPath };
    },
    query: (i) => rpc().git.getDiff(i),
    onError: (err) => toast.error(`Git diff stream: ${err.message}`),
  });

  // The browse file-content read — pulses on `subscribeFileChange` (repo+file).
  // Idle outside browse mode / with no selected file. Keyed on (repo, file),
  // NEVER the terminal: the bytes are a fact about the file, so switching focus
  // between two panes showing the same file must not blank the view — and the
  // one thing that DOES need a terminal, the binary preview URL, is built where
  // the subject's terminal is read (the view), so the URL can never go stale.
  //
  // ITS INPUT IS THE STORED PICK, NOT THE SHOWN FILE, and that is a decision
  // with a cost: once the tree stops showing a condemned pick
  // (`codeTabShownSelection`), this query stays keyed on it — a refcounted
  // (repo, file) watcher pair (`git: file-change` = HEAD + working tree) and a
  // re-read per pulse whose `FileGone` the swallow below discards — until the
  // user picks another file or the repo/host/mode re-keys it. Master's clear
  // retired that watcher at the moment the file went away.
  //
  // It cannot read the shown file. The shown file is a VIEW derivation over
  // `treeInventory` (`CodeTab.tsx`), which merges these listings with the
  // view's OWN lazily-read directory levels; a file reached by expanding a
  // folder of a root git cannot list, or an ignored directory, is listed
  // nowhere else, so a query-layer re-derivation would condemn exactly the
  // files whose content the user just opened. And this set is built per HOST
  // in `hostCodeTab`, upstream of any Code view and retained while none is
  // mounted, so the view's derivation is not in scope here — the only way to
  // bring it in is to write the shown file back into the selection store,
  // which is the clear-write this group deleted.
  //
  // What the standing read buys: the content for a file that comes back is
  // already there, and nothing paints from it while it is condemned (the
  // content pane is gated on the shown file).
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
      const s = state.selectedFile("browse");
      return p && s ? { repoPath: p, filePath: s } : null;
    },
    pulseProc: () => streams().subscribeFileChange.unenrolled,
    pulseInput: (i) => i,
    query: (i) =>
      isBinaryPreviewable(i.filePath)
        ? rpc()
            .fs.filePreviewTag({ repoPath: i.repoPath, filePath: i.filePath })
            .pipe(
              Effect.map(
                // Cache-bust by CONTENT hash, not mtime: a real change bumps the
                // tag (so the consumer's URL changes and the img/iframe reloads)
                // while an identical-content rewrite leaves it stable.
                (previewTag): BrowseFileContent => ({
                  kind: "binary",
                  previewTag,
                }),
              ),
            )
        : rpc()
            .fs.readFile({ repoPath: i.repoPath, filePath: i.filePath })
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
    // Delete-while-viewing parity: a file removed under the open view fails
    // with padi's declared `FileGone`; swallow it (keep the last content until
    // the selection changes).
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

/** Read a fresh authoritative browse inventory for a user-initiated open.
 *
 * The retained `allPaths` window is intentionally allowed to stay visible
 * while its repo-change pulse refreshes in place. That makes the tree stable,
 * but also means a terminal link can arrive in the short interval after a file
 * was created and before the pulse's requery lands. A not-found verdict must
 * therefore confirm against a direct read before consuming the navigation
 * request. The request's captured host selects the padi procedures: an
 * in-flight confirmation must not follow the active-host projection when the
 * user switches hosts. Keep that read beside the query set so both paths
 * use the same partition: git's tracked listing (plus the ignored overlay),
 * or, for a root git cannot list (`lister` `"disk"`), the root's own level read
 * from disk — the failing `git ls-files` is never fired there.
 *
 * No cancellation token: a padi procedure call carries none under Effect
 * (D10/#18). Interrupting this effect's fiber IS the cancellation, and a
 * superseded read is ALSO discarded by `codeTabOpenController`'s own `isCurrent`
 * gate — both, deliberately: interruption is asynchronous, so a read already
 * past its last suspension can still answer after the interrupt is requested,
 * and the gate is what refuses that answer. */
export function readFreshCodePaths(
  host: HostKey,
  repoPath: string,
  lister: CodeLister,
  includeIgnored: boolean,
): Effect.Effect<string[], unknown> {
  const rpc = padiRpcOf(host);
  // No loaded levels in either arm: this read resolves a terminal link against
  // the authoritative listing, and a lazily-expanded directory's contents are a
  // VIEW concern — a path only reachable by hand-opening a folder is not
  // something a `path:line` ref can name.
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
    // The two listings are independent reads of the same repo — concurrent, as
    // the `Promise.all` they replace was. A failure now INTERRUPTS the sibling
    // rather than leaving it running into a rejection nobody reads.
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
