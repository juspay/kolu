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
import { scopedByEntry } from "@kolu/surface-map/client";
import type { Subscription } from "@kolu/surface/solid";
import { ORPCError } from "@orpc/client";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import { buildTerminalFileUrl, isBinaryPreviewable } from "kolu-common/preview";
import type { TerminalId } from "kolu-common/surface";
import type { GitDiffMode } from "kolu-git/schemas";
import { toast } from "solid-sonner";
import { createSharedRoot } from "../createSharedRoot";
import { windowedSub } from "../hostScope/windowedSub.ts";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { activeHost, activePadiRpc, activePadiStreams, padiMap } from "../wire";
import { createPolledQuery, type PolledQueryConfig } from "./createPolledQuery";
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
  paths: string[];
}

/** Build ONE host's retained Code-tab queries. `ctx.isActive` is this host's
 *  "am I the shown host" gate — see the isActive contract in the header. */
function buildHostCodeTab(host: HostKey, ctx: { isActive: () => boolean }) {
  const store = useTerminalStore();
  const rightPanel = useRightPanel();

  // The shown terminal's selection, read off the app-lifetime singletons (the active
  // projection). Meaningful only under `ctx.isActive` — see the header.
  const shownRepoPath = (): string | null =>
    store.active().meta?.git?.repoRoot ?? null;
  const shownTerminalId = (): TerminalId | null => store.active().id;
  const codeView = (): CodeTabView => rightPanel.codeMode();
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
      PolledQueryConfig<Input, { repoPath: string }, unknown, Result>,
      "live" | "pulseHost" | "active" | "pulseProc" | "pulseInput"
    >,
  ): Subscription<Result> {
    return createPolledQuery({
      ...config,
      ...authorities,
      pulseProc: () => activePadiStreams.subscribeRepoChange.unenrolled,
      pulseInput: (i) => ({ repoPath: i.repoPath }),
    });
  }

  // Always-on local status — feeds the Local badge/count and the browse-tree overlay,
  // independent of the active view (see CodeTab for the passive-vs-active-view split).
  const localStatus = repoQuery({
    input: () => {
      const p = shownRepoPath();
      return p ? { repoPath: p, mode: "local" as const } : null;
    },
    query: (i, signal) => activePadiRpc.git.getStatus(i, { signal }),
    onError: (err) => toast.error(`Git status stream: ${err.message}`),
  });

  // Always-on branch status — feeds the Branch badge/count, base/ref, and overlay.
  // The un-fetched-base case (PRECONDITION_FAILED) is EXPECTED for this passive read
  // and swallowed; any other failure toasts.
  const branchStatus = repoQuery({
    input: () => {
      const p = shownRepoPath();
      return p ? { repoPath: p, mode: "branch" as const } : null;
    },
    query: (i, signal) => activePadiRpc.git.getStatus(i, { signal }),
    onError: (err) => {
      if (err instanceof ORPCError && err.code === "PRECONDITION_FAILED")
        return;
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
    query: (i, signal) => activePadiRpc.git.getStatus(i, { signal }),
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
    query: async (i, signal): Promise<ScopedCodePaths> => {
      const result = await activePadiRpc.fs.listAll(
        { repoPath: i.repoPath },
        { signal },
      );
      return {
        scope: {
          host,
          terminalId: i.terminalId,
          repoRoot: i.repoPath,
          mode: "browse",
        },
        paths: result.paths,
      };
    },
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
    query: async (i, signal): Promise<ScopedCodePaths> => {
      const result = await activePadiRpc.fs.listIgnored(
        { repoPath: i.repoPath },
        { signal },
      );
      return {
        scope: {
          host,
          terminalId: i.terminalId,
          repoRoot: i.repoPath,
          mode: "browse",
        },
        paths: result.paths,
      };
    },
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
    query: (i, signal) => activePadiRpc.git.getDiff(i, { signal }),
    onError: (err) => toast.error(`Git diff stream: ${err.message}`),
  });

  // The browse file-content read — pulses on `subscribeFileChange` (repo+file). Idle
  // outside browse mode / with no selected file (the old dispatcher's mount condition,
  // now expressed as an idle input). The binary/text decision + URL build are verbatim
  // from the retired `BrowseFileDispatcher` owner.
  const fileContent = createPolledQuery<
    { terminalId: TerminalId; repoPath: string; filePath: string },
    { repoPath: string; filePath: string },
    unknown,
    BrowseFileContent
  >({
    ...authorities,
    input: () => {
      const p = shownRepoPath();
      const s = codeSelectedPath();
      const tid = shownTerminalId();
      return codeView() === "browse" && p && s && tid !== null
        ? { terminalId: tid, repoPath: p, filePath: s }
        : null;
    },
    pulseProc: () => activePadiStreams.subscribeFileChange.unenrolled,
    pulseInput: (i) => ({ repoPath: i.repoPath, filePath: i.filePath }),
    query: async (i, signal): Promise<BrowseFileContent> => {
      if (isBinaryPreviewable(i.filePath)) {
        const previewTag = await activePadiRpc.fs.filePreviewTag(
          { repoPath: i.repoPath, filePath: i.filePath },
          { signal },
        );
        return {
          kind: "binary",
          // Cache-bust by CONTENT hash, not mtime, and key the URL by the ACTIVE host's
          // canonical string so the route reads bytes from the same padi the tag came
          // from — a remote host's preview must not resolve against the local default.
          url: `${buildTerminalFileUrl(encodeHostKey(activeHost()), i.terminalId, i.filePath)}?v=${previewTag}`,
        };
      }
      const { content, truncated } = await activePadiRpc.fs.readFile(
        { repoPath: i.repoPath, filePath: i.filePath },
        { signal },
      );
      return { kind: "text", content, truncated };
    },
    onError: (err) => toast.error(`File content stream: ${err.message}`),
    // Delete-while-viewing parity: a file removed under the open Code tab returns a
    // typed NOT_FOUND; swallow it (keep the last content until the selection changes),
    // exactly as the old value stream did (it just stopped yielding).
    swallowError: (err) => err instanceof ORPCError && err.code === "NOT_FOUND",
  });

  return {
    localStatus,
    branchStatus,
    activeStatus,
    allPaths,
    ignoredPaths,
    diff,
    fileContent,
  };
}

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
 * use the same ignored-file partition. */
export async function readFreshCodePaths(
  host: HostKey,
  repoPath: string,
  includeIgnored: boolean,
  signal: AbortSignal,
): Promise<string[]> {
  const rpc = padiMap.entry(host).procedures;
  const [tracked, ignored] = await Promise.all([
    rpc.fs.listAll({ repoPath }, { signal }),
    includeIgnored
      ? rpc.fs.listIgnored({ repoPath }, { signal })
      : Promise.resolve(undefined),
  ]);
  // No loaded levels: this read resolves a terminal link against the
  // authoritative listing, and a lazily-expanded directory's contents are a
  // VIEW concern — a path only reachable by hand-expanding an ignored folder is
  // not something a `path:line` ref can name.
  return mergeBrowseInventory(tracked.paths, ignored?.paths, undefined, {
    trackedPending: false,
    ignoredPending: false,
    showIgnored: includeIgnored,
  }).paths;
}
