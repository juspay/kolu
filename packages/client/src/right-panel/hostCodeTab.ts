/** `hostCodeTab` — the Code tab's per-host RETAINED query world, for instant
 *  switch-back of the Code tab (padi W9's Code-tab half, completing W7's K1).
 *
 *  It owns the pulse-then-requery reads the Code tab stands on — the three git
 *  status streams (local / branch / active-view), the browse file list, the
 *  gitignored overlay, the diff, and the browse file-content — as one
 *  {@link createPolledQuery} instance PER host,
 *  born inside a `scopedByEntry(padiMap, activeHost, …)` owner: created LAZILY on a
 *  host's first activation, RETAINED across every switch-away (paused, value held),
 *  and DISPOSED only when the host leaves `padiMap.entries`. `CodeTab` and
 *  `BrowseFileDispatcher` read WINDOWS over the active host's instance (the exported
 *  facades below) instead of owning the queries themselves — so a switch-BACK, and a
 *  `canvasMode` round-trip that unmounts the Code tab, both find the value already
 *  there with no blank + no `pending` window.
 *
 *  ── WHY A PARALLEL OWNER, not a `HostScope` member ──────────────────────────
 *  The obvious home is a sibling member of `hostScope/hostScopes.ts` (beside
 *  `createHostWire`). It CANNOT live there: these query inputs read the shown
 *  terminal's SELECTION — `useTerminalStore().active()` (the focused terminal + its
 *  metadata) and `useRightPanel()` (the Code-tab mode + per-mode selected file). Those
 *  singletons sit DOWNSTREAM of `hostScopes` in the import graph
 *  (`hostScopes ← activeWire ← useTerminalStore ← useRightPanel`), so a `hostScopes`
 *  member reading them would close the cycle `hostScopes → (member) → useTerminalStore
 *  → activeWire → hostScopes`, which `biome`'s CI-enforced `noImportCycles` rejects —
 *  anyone who tries to fold this back in will be caught by biome. The import graph is
 *  telling the truth about layering: the QUERY scope depends on VIEW-SELECTION state,
 *  so it belongs downstream of it. This module is that downstream home — its OWN
 *  `createSharedRoot(scopedByEntry(padiMap, activeHost, …))`, a SECOND per-host owner
 *  PARALLEL to `hostScopes`, built from the SAME two inputs (`padiMap` + `activeHost`)
 *  with the SAME primitive, so the two owners' lifetimes are parallel BY CONSTRUCTION
 *  (both keyed on `padiMap.entries`, both `activeHost`-gated) — not by any runtime
 *  coordination. This keeps the two volatilities unbraided (hickey): `createHostWire`
 *  owns wire FACTS (padi server subscriptions); this owns app-level POLLED-query state.
 *  No fact has two authorities.
 *
 *  ── The isActive contract (read this before editing an input) ───────────────
 *  The inputs read the ACTIVE projection (`store.active()` / `useRightPanel()`), NOT a
 *  host-fixed value — and those reads are MEANINGFUL ONLY under `ctx.isActive`. While
 *  host X is active the active projection IS X's own shown terminal (self-referential,
 *  honest); while X is backgrounded X's instance is PAUSED, so `createPolledQuery`'s
 *  gate never consults these accessors (frozen value, no dispatch — the switch-back
 *  guarantee). A selection changed while X was away yields a different value-key on
 *  resume → a blank + requery, the honest staleness answer. Future editors MUST keep
 *  every input here a pure read of the active projection; a host-specific read here
 *  would be consulted for the wrong host under the shared active-gate invariant.
 *
 *  ── No cross-scope atomicity ────────────────────────────────────────────────
 *  This owner and `hostScopes` are two SEPARATE owners over the same key set. A reader
 *  that joins a wire fact (`activeScope().wire`) with a codeTab fact (a facade here)
 *  MUST tolerate one owner's world existing a tick before the other's — a host's wire
 *  scope and its codeTab scope are created/disposed in lockstep by construction, but
 *  the two `.active()` re-keys are not one atomic transition. No consumer may assume
 *  they flip together within a single reactive tick. */

import type { CodeTabView } from "@kolu/padi/surface";
import { Effect } from "effect";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  mapArray,
  on,
  onCleanup,
} from "solid-js";
import { scopedByEntry } from "@kolu/surface-map/client";
import type { Subscription } from "@kolu/surface/solid";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { ancestorDirectoryPaths } from "@kolu/solid-pierre/paths";
import { buildTerminalFileUrl, isBinaryPreviewable } from "kolu-common/preview";
import type { TerminalId } from "kolu-common/surface";
import type { GitDiffMode } from "kolu-git/schemas";
import { toError } from "@kolu/surface/run-stream";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { runActionPromise } from "../runAction";
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
  padiRpcOf,
  padiMap,
} from "../wire";
import { type BrowseRoot, browsableRoot, browseRootOf } from "./browseRoot";
import {
  bindPulse,
  createPolledQuery,
  type PolledQueryConfig,
} from "./createPolledQuery";
import { mergeBrowseInventory } from "./browseInventory";
import type { CodeTabScope } from "./codeTabOpenController";
import { showIgnoredFiles } from "./showIgnoredFiles";
import { useRightPanel } from "./useRightPanel";

/** The client-side text|binary partition, off the wire (moved verbatim from the old
 *  `BrowseFileDispatcher` owner). `padiSurface`'s `fs.readFile` is TEXT-ONLY, so the
 *  dispatcher decided binary vs text itself; that decision now rides here, where the
 *  query lives. A binary-previewable file reads a CONTENT hash (`fs.filePreviewTag`)
 *  and builds the `/api/terminals/:host/:id/file?v=<tag>` URL so a real content change
 *  bumps the URL (img/iframe reload) while an identical-content rewrite leaves it
 *  stable; a text file reads its content. */
export type BrowseFileContent =
  | { kind: "text"; content: string; truncated: boolean }
  | { kind: "binary"; url: string };

/** A file listing stamped with the exact Code-tab owner that produced it. */
export interface ScopedCodePaths {
  scope: CodeTabScope;
  /** `readonly`, because it IS the decoded wire array (Effect's `Schema.Array`
   *  decodes to a readonly array) — carried through rather than copied. */
  paths: readonly string[];
}

/** Build ONE host's retained Code-tab queries. `ctx.isActive` is this host's
 *  "am I the shown host" gate — see the isActive contract in the header. */
function buildHostCodeTab(host: HostKey, ctx: { isActive: () => boolean }) {
  const store = useTerminalStore();
  const rightPanel = useRightPanel();

  // The shown terminal's selection, read off the app-lifetime singletons (the active
  // projection). Meaningful only under `ctx.isActive` — see the header.
  const shownTerminalId = (): TerminalId | null => store.active().id;
  // The shown terminal's browse root and its authority — the ONE derivation,
  // shared with `CodeTab` (`./browseRoot.ts`), so the view and the query world
  // cannot disagree about which root kind is in play. A memo, not a plain
  // accessor, for the same reason as its `CodeTab` twin: every query input
  // below reads it, so a bare function would re-derive once per reader per
  // metadata tick (the multi-consumer-derivation convention).
  const shownRoot = createMemo(
    (): BrowseRoot =>
      browseRootOf(host, shownTerminalId(), store.active().meta),
  );
  const shownRepoPath = (): string | null => {
    const r = shownRoot();
    return r?.kind === "git" ? r.root : null;
  };
  /** The one spelling of a browse query's owner stamp — three queries build it
   *  (tracked, ignored overlay, plain root level), and a `CodeTabScope` field
   *  added later must not need a per-query hunt. */
  const scopeFor = (
    terminalId: TerminalId,
    repoRoot: string,
  ): CodeTabScope => ({
    host,
    terminalId,
    repoRoot,
    mode: "browse",
  });
  /** The armed PLAIN-DIRECTORY root, or null (inside a repo git owns the root;
   *  un-armed means the user hasn't consented to the read yet). */
  const shownDirRoot = (): string | null => {
    const r = shownRoot();
    return r?.kind === "plain" ? r.root : null;
  };
  // The EFFECTIVE view, from the one accessor that owns the coercion — not a
  // second copy of "outside git it's browse" (`useRightPanel.effectiveCodeMode`).
  const codeView = (): CodeTabView =>
    rightPanel.effectiveCodeMode(shownRoot()?.kind === "git");
  const codeDiffMode = (): GitDiffMode | undefined =>
    codeView() === "browse" ? undefined : (codeView() as GitDiffMode);
  const codeSelectedPath = (): string | null =>
    rightPanel.selectedFile(codeView());

  // The ownership authorities are injected here, once — `live` is the active host's
  // transport liveness, `pulseHost` is `activeHost` (the pulse follows the active
  // host), `active` is this instance's own gate. Identical to the retired
  // `perHostPolledQuery`, now hardwired at the query's real home.
  const authorities = {
    live: () => padiMap.live(),
    pulseHost: activeHost,
    active: ctx.isActive,
  } as const;

  // The three git status reads + the browse file list share the repo-change pulse
  // keyed on `repoPath` (what `createRepoPolledQuery` used to bake in). Kept as a
  // local helper — this is the only site, so it is a leaf, not a receptacle.
  function repoQuery<Input extends { repoPath: string }, Result>(
    config: Omit<
      PolledQueryConfig<Input, unknown, Result>,
      "live" | "pulseHost" | "active" | "pulse"
    >,
  ): Subscription<Result> {
    return createPolledQuery({
      ...config,
      ...authorities,
      pulse: (i) =>
        bindPulse(activePadiStreams.subscribeRepoChange.unenrolled, {
          repoPath: i.repoPath,
        }),
    });
  }

  // Always-on local status — feeds the Local badge/count and the browse-tree overlay,
  // independent of the active view (see CodeTab for the passive-vs-active-view split).
  const localStatus = repoQuery({
    input: () => {
      const p = shownRepoPath();
      return p ? { repoPath: p, mode: "local" as const } : null;
    },
    query: (i) => activePadiRpc.git.getStatus(i),
    onError: (err) => toast.error(`Git status stream: ${err.message}`),
  });

  // Always-on branch status — feeds the Branch badge/count, base/ref, and overlay.
  // The un-fetched-base case (`WorktreeBaseBranchMissing`) is EXPECTED for this
  // passive read and swallowed; any other failure toasts.
  const branchStatus = repoQuery({
    input: () => {
      const p = shownRepoPath();
      return p ? { repoPath: p, mode: "branch" as const } : null;
    },
    query: (i) => activePadiRpc.git.getStatus(i),
    onError: (err) => {
      if (isDeclared(err, WORKTREE_BASE_BRANCH_MISSING)) return;
      toast.error(`Git status stream: ${err.message}`);
    },
  });

  // Active-view status — a fresh, view-keyed read for whichever diff mode is showing
  // (browse reads neither). Keying on the active mode means selecting Branch performs
  // a fresh read that can't inherit a stale error from the passive `branchStatus`.
  const activeStatus = repoQuery({
    input: () => {
      const p = shownRepoPath();
      const m = codeDiffMode();
      return p && m ? { repoPath: p, mode: m } : null;
    },
    query: (i) => activePadiRpc.git.getStatus(i),
    onError: (err) => toast.error(`Git status stream: ${err.message}`),
  });

  // "The browse tree is live" — spelled once, so the two listings that feed it
  // cannot drift into querying for different views (a new view mode added to one
  // and not the other would silently fetch an overlay for a tree that isn't
  // mounted). The diff modes read the status files instead of either listing.
  const browseInput = (): {
    terminalId: TerminalId;
    repoPath: string;
  } | null => {
    const p = shownRepoPath();
    const terminalId = shownTerminalId();
    return p && terminalId !== null && codeView() === "browse"
      ? { terminalId, repoPath: p }
      : null;
  };

  // The whole-repo file list.
  const allPaths = repoQuery({
    input: browseInput,
    query: (i) =>
      activePadiRpc.fs.listAll({ repoPath: i.repoPath }).pipe(
        Effect.map(
          (result): ScopedCodePaths => ({
            scope: scopeFor(i.terminalId, i.repoPath),
            paths: result.paths,
          }),
        ),
      ),
    onError: (err) => toast.error(`File list stream: ${err.message}`),
  });

  // The gitignored overlay — a SEPARATE query, idle (null input) unless the
  // show-ignored toggle is on. Keeping it off `allPaths` is what lets the toggle
  // flip without disturbing the main file list: as a field on that query's input
  // it would join its value key, so every flip would blank the list, unmount
  // `<FileTree>`, and remount it collapsed — losing every hand-expanded folder
  // and the scroll position. Idling the input instead means the toggle costs the
  // extra `git ls-files` spawn only while the user actually wants the overlay.
  const ignoredPaths = repoQuery({
    input: () => (showIgnoredFiles() ? browseInput() : null),
    query: (i) =>
      activePadiRpc.fs.listIgnored({ repoPath: i.repoPath }).pipe(
        Effect.map(
          (result): ScopedCodePaths => ({
            scope: scopeFor(i.terminalId, i.repoPath),
            paths: result.paths,
          }),
        ),
      ),
    onError: (err) => toast.error(`Ignored file list: ${err.message}`),
  });

  // The active file's diff — its input reads THIS scope's own `activeStatus` result to
  // find the file's `oldPath` (a cross-query dependency that rides one owner).
  const diff = repoQuery({
    input: () => {
      const p = shownRepoPath();
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

  // ONE file-content read, shared by the git-mode and plain-directory queries
  // below, so the binary/text partition and the URL build cannot fork. The
  // decision + build are verbatim from the retired `BrowseFileDispatcher` owner.
  const readFileContent = (i: {
    terminalId: TerminalId;
    repoPath: string;
    filePath: string;
  }): Effect.Effect<BrowseFileContent, unknown> =>
    isBinaryPreviewable(i.filePath)
      ? activePadiRpc.fs
          .filePreviewTag({ repoPath: i.repoPath, filePath: i.filePath })
          .pipe(
            Effect.map(
              (previewTag): BrowseFileContent => ({
                kind: "binary",
                // Cache-bust by CONTENT hash, not mtime, and key the URL by the ACTIVE
                // host's canonical string so the route reads bytes from the same padi
                // the tag came from — a remote host's preview must not resolve against
                // the local default.
                url: `${buildTerminalFileUrl(encodeHostKey(activeHost()), i.terminalId, i.filePath)}?v=${previewTag}`,
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
          );

  // ONE browse file-content read for BOTH root kinds — same query, same retained
  // value, and the PULSE chosen from the input:
  //
  //   - inside a git repo, `subscribeFileChange` (repo + file): the narrow
  //     per-file axis, so `git commit` / `git add` fire no wasted re-reads;
  //   - outside one, `subscribeDirChange` on the file's PARENT directory —
  //     without git there is no head/working-tree watcher to compose a per-file
  //     pulse from, and the parent-dir handle already carries direct-child
  //     writes and the editor temp+rename idiom (see `refcounted-dir-watcher`).
  //
  // Deliberately not two queries: each would own its own retained value and
  // shown key, so a git-presence flip (a `cd` from a repo to a plain directory)
  // discarded the other's content and blanked the panel — the exact
  // instant-switch-back-by-ownership invariant this module exists to protect.
  // The root kind is a pulse-SOURCE fact, which is why it belongs in `pulse`.
  const fileContent = createPolledQuery<
    {
      terminalId: TerminalId;
      repoPath: string;
      filePath: string;
      git: boolean;
    },
    unknown,
    BrowseFileContent
  >({
    ...authorities,
    input: () => {
      const r = shownRoot();
      const root = browsableRoot(r);
      const s = codeSelectedPath();
      const tid = shownTerminalId();
      return codeView() === "browse" && root && s && tid !== null
        ? {
            terminalId: tid,
            repoPath: root,
            filePath: s,
            git: r?.kind === "git",
          }
        : null;
    },
    // Outside git the file's pulse is its PARENT DIRECTORY's non-recursive
    // watch. That covers the editor temp+rename idiom and (on the fs.watch
    // edge) in-place child writes — but it is BEST-EFFORT for content-only
    // writes: the watcher's dropped-edge poll floor observes directory-entry
    // facts, not child bytes, so an in-place write whose edge is dropped under
    // load waits for the next event. Accepted deliberately over a narrow
    // per-file stream member (see the PR's adjudication note): bounded
    // staleness on an already-open preview, vs a second wire member and a
    // per-open-file handle in both root kinds.
    pulse: (i) =>
      i.git
        ? bindPulse(activePadiStreams.subscribeFileChange.unenrolled, {
            repoPath: i.repoPath,
            filePath: i.filePath,
          })
        : bindPulse(activePadiStreams.subscribeDirChange.unenrolled, {
            repoPath: i.repoPath,
            dirPath: parentDirKey(i.filePath),
          }),
    query: readFileContent,
    onError: (err) => toast.error(`File content stream: ${err.message}`),
    // Delete-while-viewing parity: a file removed under the open Code tab fails
    // with padi's declared `FileGone`; swallow it (keep the last content until the
    // selection changes), exactly as the old value stream did (it just stopped
    // yielding).
    swallowError: (err) => isDeclared(err, FILE_GONE),
  });

  // ── The browse tree's LEVELS ────────────────────────────────────────────
  // "The levels of this browse tree" is ONE thing with ONE home and ONE
  // lifetime: level `""` (a plain root's top level) and one level per directory
  // the user has expanded are members of the same family, born here, in this
  // host's retained world.
  //
  // They used to be split by DEPTH, which is not an axis: level 1 lived here as
  // its own named query (paused-not-destroyed on a host switch, value retained)
  // while levels 2..N lived in the `CodeTab` singleton across four state
  // locations (an intent signal, a loaded-children signal, a promise-waiter map,
  // an in-flight AbortController map) and were DISPOSED whenever `slotKey`
  // changed — so a host switch and back left the root warm and every expanded
  // folder shut. Half the invariant kept, and a five-statement reset ritual to
  // keep the four locations agreeing.
  //
  // And ONE mechanism, chosen by REFRESH POLICY rather than by an unrelated
  // axis. A level is either WATCHED — a plain-directory level, whose own
  // `subscribeDirChange` handle keeps it fresh — or a ONE-SHOT read — a
  // gitignored overlay level, which nothing watches BY CONSTRUCTION (the
  // watcher's ignore set is built from `listIgnored`, so inventing a pulse for
  // it would mean watching exactly the churn — `node_modules`, build output —
  // that the ignore set exists to keep out; re-expanding is its refresh). Both
  // are entries of the same `mapArray`, so both get one writer per level, owner
  // disposal as supersession, and the same settlement — instead of two
  // hand-rolled implementations selected by a `gitRoot()` test, with two
  // different supersession stories that disagreed (#2138).
  const [expandedDirs, setExpandedDirs] = createSignal<ReadonlySet<string>>(
    new Set(),
  );
  /** The click's waiter per level — resolved by that level's first arrival,
   *  rejected by its failure. `<FileTree>`'s outcome contract, settled from the
   *  ONE place a level can land. Not reactive: nothing renders from it. */
  const levelWaiters = new Map<
    string,
    { resolve: () => void; reject: (err: Error) => void }
  >();

  /** One level's read, whatever its policy: the contents, the readiness, and the
   *  scope it was produced under. */
  interface CodeLevel {
    dirKey: string;
    paths: Accessor<readonly string[] | undefined>;
    pending: Accessor<boolean>;
    error: Accessor<Error | undefined>;
  }

  // The level keys, each carrying EVERYTHING the entry is scoped to — policy,
  // terminal, root — so a change to any of them disposes the entry
  // STRUCTURALLY rather than through a reset effect. `\0` can't appear in a
  // path, so the split is unambiguous.
  const levelKeys = (): string[] => {
    const r = shownRoot();
    const tid = shownTerminalId();
    if (r === null || r.kind === "unarmed" || tid === null) return [];
    if (codeView() !== "browse") return [];
    // A plain root's own top level is level `""` — the always-registered member
    // of this family, not a special case. Inside a repo the root inventory is
    // `allPaths` (git's whole-repo listing), and only the overlay's collapsed
    // directories are levels.
    const keys =
      r.kind === "plain" ? ["", ...expandedDirs()] : [...expandedDirs()];
    return keys.map((k) => `${r.kind}\0${tid}\0${r.root}\0${k}`);
  };

  const levelEntries = createMemo(
    mapArray(levelKeys, (key): CodeLevel => {
      const [kind, , root, ...rest] = key.split("\0");
      const dirKey = rest.join("\0");
      const settle = (outcome: "resolve" | "reject", err?: Error): void => {
        const waiter = levelWaiters.get(dirKey);
        if (!waiter) return;
        levelWaiters.delete(dirKey);
        if (outcome === "resolve") waiter.resolve();
        else waiter.reject(err ?? new Error("directory load failed"));
      };
      if (kind === "plain") {
        // WATCHED: read AND watched by one polled query riding the
        // non-recursive `subscribeDirChange` pulse for exactly this directory
        // (its snapshot frame performs the first read, so the click issues no
        // RPC of its own). N expanded folders cost N single-directory handles,
        // never a recursive crawl.
        //
        // A plain boolean rather than reading `level()` inside its own config:
        // the self-reference defeats TS's inference, and the fact wanted is
        // exactly "has any listing ever landed", not the current value.
        let levelHasValue = false;
        const level = createPolledQuery<
          { repoPath: string; dirPath: string },
          unknown,
          { paths: readonly string[] }
        >({
          ...authorities,
          input: () => ({ repoPath: root as string, dirPath: dirKey }),
          pulse: (i) =>
            bindPulse(activePadiStreams.subscribeDirChange.unenrolled, i),
          query: (i) => activePadiRpc.fs.listDirectory(i),
          onError: (err) => {
            toast.error(`Failed to list ${dirKey || root}: ${err.message}`);
            settle("reject", err);
          },
          // A level whose directory vanished mid-watch: keep the last listing;
          // the parent's own pulse re-lists and drops the row authoritatively.
          // ONLY once a listing exists, though — a FIRST frame that fails with
          // FileGone has no value to keep, and swallowing it would leave the
          // expand waiter unsettled forever: no reject, no toast, the folder
          // wedged open-and-empty (root level ``""``: stuck on Loading…).
          swallowError: (err) => isDeclared(err, FILE_GONE) && levelHasValue,
        });
        createEffect(() => {
          if (level()) {
            levelHasValue = true;
            settle("resolve");
          }
        });
        return {
          dirKey,
          paths: () => level()?.paths,
          pending: level.pending,
          error: level.error,
        };
      }
      // ONE-SHOT: nothing watches an ignored path, so this level is read once
      // and refreshed only by a deliberate reopen. Owner disposal IS the
      // supersession — `onCleanup` interrupts the read's fiber, which is what
      // the hand-rolled controller map, its identity guards and its
      // `ensuring` retirement used to do by hand.
      const [paths, setPaths] = createSignal<readonly string[] | undefined>();
      const [error, setError] = createSignal<Error | undefined>();
      const ctl = new AbortController();
      onCleanup(() => ctl.abort());
      void runActionPromise(
        activePadiRpc.fs.listDirectory({
          repoPath: root as string,
          dirPath: dirKey,
        }),
        ctl.signal,
      )
        .then((result) => {
          setPaths(result.paths);
          settle("resolve");
        })
        .catch((err: unknown) => {
          // A superseded read owns no outcome — neither the toast (a failure
          // belonging to a tree the user has already left is not theirs to see)
          // nor the rejection.
          if (ctl.signal.aborted) return;
          const e = toError(err);
          toast.error(`Failed to list ${dirKey}: ${e.message}`);
          setError(e);
          settle("reject", e);
        });
      return {
        dirKey,
        paths,
        pending: () => paths() === undefined && error() === undefined,
        error,
      };
    }),
  );

  /** The browse tree's levels AND the ROOT level's readiness, minted as ONE
   *  value — DERIVED from the live entries rather than pushed into a shared map
   *  by N effects, so a level's contents leave exactly when its owner dies and
   *  no explicit clear is needed. The root level carries the scope it was read
   *  under, the same stamp `allPaths` carries. */
  const dirLevels = createMemo(() => {
    const levels = new Map<string, readonly string[]>();
    let root: ScopedCodePaths | undefined;
    let pending = true;
    let error: Error | undefined;
    const repoRoot = shownDirRoot();
    const tid = shownTerminalId();
    for (const entry of levelEntries()) {
      const paths = entry.paths();
      if (paths) levels.set(entry.dirKey, paths);
      if (entry.dirKey !== "") continue;
      pending = entry.pending();
      error = entry.error();
      if (paths && repoRoot !== null && tid !== null) {
        root = {
          scope: scopeFor(tid, repoRoot),
          paths,
        };
      }
    }
    return { levels, root, pending, error };
  });

  /** Register the intent to have a level. The ONLY entry point for BOTH
   *  policies: registering spawns the level's owner, and that owner is the
   *  level's single writer — the two-writer race a click-read racing a
   *  pulse-read allowed is unspellable.
   *
   *  `signal` is `<FileTree>`'s supersession token (it owns the row's fate, and
   *  aborts when the same key is re-reported / collapses / the epoch bumps), so
   *  this settles the superseded waiter quietly and lets the newest registration
   *  own the outcome. */
  const expandLevel = (dirPath: string, signal: AbortSignal): Promise<void> => {
    // Already loaded and still registered — a re-report with no collapse in
    // between (a key that left `lazyDirectories` and came back). The standing
    // level owner has kept it fresh, so there is nothing to wait for.
    if (dirLevels().levels.has(dirPath)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter = { resolve, reject };
      levelWaiters.set(dirPath, waiter);
      signal.addEventListener("abort", () => {
        if (levelWaiters.get(dirPath) === waiter) levelWaiters.delete(dirPath);
        // Supersession is not a verdict — settle quietly; the wrapper ignores
        // an aborted load's outcome.
        resolve();
      });
      setExpandedDirs((prev) =>
        prev.has(dirPath) ? prev : new Set(prev).add(dirPath),
      );
    });
  };

  /** Retire a level — `<FileTree>`'s CLOSE edge. Dropping the registration
   *  disposes its owner, which takes the pulse subscription, the server-side
   *  handle and the level's contents with it. */
  const collapseLevel = (dirPath: string): void => {
    levelWaiters.delete(dirPath);
    setExpandedDirs((prev) => {
      if (!prev.has(dirPath)) return prev;
      const next = new Set(prev);
      next.delete(dirPath);
      return next;
    });
  };

  // The intent is scoped to the SLOT that was browsed — its terminal, its root,
  // and its view: repo-relative keys collide across roots (`out/` exists in
  // both), so carrying them over would spawn a level query for a directory the
  // new root may not even have, and intent surviving a switch to a diff view
  // would keep N levels registered behind rows the tree no longer paints.
  // `<FileTree>`'s own record of which lazy dirs are open is invalidated on this
  // same transition (`lazyEpoch` is `slotKey`). This ONE clear is all that is
  // left of the five-statement reset ritual: the entries need none, because their
  // keys carry the slot and they are disposed structurally.
  createEffect(
    on(
      () =>
        `${shownTerminalId() ?? ""}\0${browsableRoot(shownRoot()) ?? ""}\0${codeView()}`,
      () => setExpandedDirs(new Set<string>()),
      { defer: true },
    ),
  );

  return {
    localStatus,
    branchStatus,
    activeStatus,
    allPaths,
    ignoredPaths,
    dirLevels,
    expandLevel,
    collapseLevel,
    diff,
    fileContent,
  };
}

/** The directory key whose non-recursive watch covers `filePath` — Pierre's
 *  folder key WITH its trailing slash (`""` for a root-level entry), which is
 *  the spelling every other directory key the client puts on the wire uses (the
 *  per-level queries pass `dirKey` straight through). Built from the client's
 *  EXISTING parent-directory derivation rather than a second hand-rolled
 *  `lastIndexOf("/")` slice that invented a slash-less spelling for the same
 *  directory — two names on the wire for one thing, working only because the
 *  server normalises both. */
const parentDirKey = (filePath: string): string => {
  const parents = ancestorDirectoryPaths(filePath);
  return parents[parents.length - 1] ?? "";
};

/** One host's retained Code-tab query world. */
export type HostCodeTab = ReturnType<typeof buildHostCodeTab>;

// The parallel per-host owner — see the header for WHY this is its own owner and not a
// `hostScopes` member. `createSharedRoot`: a lazy-once value inside the never-disposed
// app-lifetime root, so its `padiMap` read is decoupled from import order (a unit test
// can stand up a mock `padiMap` before the owner first reads it).
const codeTabScopes = createSharedRoot(() =>
  scopedByEntry(padiMap, activeHost, (host, ctx) =>
    buildHostCodeTab(host, ctx),
  ),
);

/** The ACTIVE host's retained Code-tab queries — `undefined` only during the removal
 *  race (the active host left the pool; `wire.ts`'s reconcile re-points `activeHost` a
 *  tick later). The facades below floor that gap exactly as the pre-W9 pending sub did. */
const activeHostCodeTab = (): HostCodeTab | undefined =>
  codeTabScopes().active();

// Windowed facades over the active host's retained instance — STABLE references (held
// by `CodeTab` / `BrowseFileDispatcher`), each delegating to the active host's query so
// a switch-BACK reads the held value with no resubscribe. `windowedSub` floors the
// removal-race `undefined` (value → floor, pending → true, error passthrough).
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
/** The browse tree's levels + the root level's readiness, for the ACTIVE host.
 *  Not a `windowedSub`: this is one derived VALUE (levels + root + readiness), not
 *  a `Subscription`, and its removal-race floor is the same empty world an
 *  un-armed root reads as. */
const EMPTY_LEVELS = {
  levels: new Map<string, readonly string[]>(),
  root: undefined,
  pending: true,
  error: undefined,
} as const;
export const codeDirLevels = (): {
  levels: ReadonlyMap<string, readonly string[]>;
  root: ScopedCodePaths | undefined;
  pending: boolean;
  error: Error | undefined;
} => activeHostCodeTab()?.dirLevels() ?? EMPTY_LEVELS;

/** Register a lazy level (`<FileTree>`'s open edge) and retire one (its close
 *  edge) on the active host's retained level family. During the removal race
 *  there is no world to register in, so the expand settles quietly — the tree's
 *  own record is invalidated by the same transition. */
export const codeExpandLevel = (
  dirPath: string,
  signal: AbortSignal,
): Promise<void> =>
  activeHostCodeTab()?.expandLevel(dirPath, signal) ?? Promise.resolve();
export const codeCollapseLevel = (dirPath: string): void =>
  activeHostCodeTab()?.collapseLevel(dirPath);
export const codeDiff = windowedSub(
  () => activeHostCodeTab()?.diff,
  (v) => v,
  undefined,
);
// ONE query, so no fork here: the git-vs-plain pulse choice is a property of the
// query's INPUT (see `fileContent`), not of which query a facade picks. The
// facade used to re-derive git presence a THIRD time to make that pick — a
// third authority on one fact, over the same `store.active().meta` the other two
// read.
export const codeFileContent = windowedSub(
  () => activeHostCodeTab()?.fileContent,
  (v) => v,
  undefined,
);

/** Read a fresh authoritative browse inventory for a user-initiated open.
 *
 * The retained `codeAllPaths` window is intentionally allowed to stay visible
 * while its repo-change pulse refreshes in place. That makes the tree stable,
 * but also means a terminal link can arrive in the short interval after a file
 * was created and before the pulse's requery lands. A not-found verdict must
 * therefore confirm against a direct read before consuming the navigation
 * request. The request's captured host selects the padi procedures: an
 * in-flight confirmation must not follow the active-host projection when the
 * user switches hosts. Keep that read beside the retained query so both paths
 * use the same ignored-file partition.
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
  includeIgnored: boolean,
): Effect.Effect<string[], unknown> {
  const rpc = padiRpcOf(host);
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
        // No loaded levels: this read resolves a terminal link against the
        // authoritative listing, and a lazily-expanded directory's contents are
        // a VIEW concern — a path only reachable by hand-expanding an ignored
        // folder is not something a `path:line` ref can name.
        mergeBrowseInventory(tracked.paths, ignored?.paths, undefined, {
          trackedPending: false,
          ignoredPending: false,
          showIgnored: includeIgnored,
        }).paths,
    ),
  );
}
