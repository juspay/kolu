/** `hostCodeTab` — the Right panel's Code-tab query set, RETAINED per host, for
 *  instant switch-back of the Code tab (padi W9's Code-tab half, completing
 *  W7's K1).
 *
 *  The reads themselves are built by `codeQueries.ts`'s one builder, from a
 *  subject and a state. This module is the Right panel's CALLER of it: the
 *  subject is the focused pane on the shown host, the state is the pane's own
 *  place (`useRightPanel().code`), and one set is built PER host inside a
 *  `scopedByEntry(padiMap, activeHost, …)` owner: created LAZILY on a host's
 *  first activation, RETAINED across every switch-away (paused, value held),
 *  and DISPOSED only when the host leaves `padiMap.entries`. The Right panel
 *  hands its Code view {@link rightPanelCodeQueries} — WINDOWS over the shown
 *  host's set — so a switch-BACK, and a `canvasMode` round-trip that unmounts
 *  the Code tab, both find the value already there with no blank and no
 *  `pending` window.
 *
 *  ── WHY A PARALLEL OWNER, not a `HostScope` member ──────────────────────────
 *  The obvious home is a sibling member of `hostScope/hostScopes.ts` (beside
 *  `createHostWire`). It CANNOT live there: these query inputs read the shown
 *  pane's SELECTION — `useTerminalStore().focused()` (the focused pane + its
 *  metadata) and `useRightPanel()` (the Code-tab mode + per-mode selected file).
 *  Those singletons sit DOWNSTREAM of `hostScopes` in the import graph
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
 *  The subject and the state read the ACTIVE projection (`store.focused()` /
 *  `useRightPanel().code`, on `activeHost`), NOT a host-fixed value — and those
 *  reads are MEANINGFUL ONLY under `ctx.isActive`. While host X is active the
 *  active projection IS X's own shown pane (self-referential, honest: the
 *  subject's host is X, so every read goes to X); while X is backgrounded X's
 *  set is PAUSED, so `createPolledQuery`'s gate never consults these accessors
 *  (frozen value, no dispatch — the switch-back guarantee). A selection changed
 *  while X was away yields a different value-key on resume → a blank + requery,
 *  the honest staleness answer. Future editors MUST keep every input here a
 *  pure read of the active projection; a host-specific read here would be
 *  consulted for the wrong host under the shared active-gate invariant.
 *
 *  ── No cross-scope atomicity ────────────────────────────────────────────────
 *  This owner and `hostScopes` are two SEPARATE owners over the same key set. A reader
 *  that joins a wire fact (`activeScope().wire`) with a codeTab fact (a window here)
 *  MUST tolerate one owner's world existing a tick before the other's — a host's wire
 *  scope and its codeTab scope are created/disposed in lockstep by construction, but
 *  the two `.active()` re-keys are not one atomic transition. No consumer may assume
 *  they flip together within a single reactive tick. */

import type { TerminalMetadata } from "@kolu/padi-client/surface";
import { scopedByEntry } from "@kolu/surface-map/client";
import type { GitFact } from "@kolu/terminal-vocab/schema";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createMemo } from "solid-js";
import { createSharedRoot } from "../createSharedRoot";
import { windowedSub } from "../hostScope/windowedSub.ts";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { activeHost, padiMap } from "../wire";
import { repoLister } from "./codeLister";
import {
  buildCodeQueries,
  type CodeQueries,
  createCodeLeases,
} from "./codeQueries";
import type { CodeGit, CodeSubject } from "./codeSubject";
import { type CodeOwner, codeOwner } from "./codeTabOpenController";
import { useRightPanel } from "./useRightPanel";

/** A terminal's git reading as a Code view's {@link CodeGit}. No reading at
 *  all — no terminal shown — is no repository either. */
export function codeGitOf(git: GitFact | undefined): CodeGit {
  if (git === undefined) return { kind: "none" };
  if (git.kind !== "repo") return { kind: git.kind };
  return {
    kind: "repo",
    root: git.info.repoRoot,
    lister: repoLister(git.info),
  };
}

/** The owner of a PANE's place — the Right panel's kind of owner. The front
 *  door scopes its requests by it, and the pane's subject carries it. */
export function paneCodeOwner(terminalId: TerminalId): CodeOwner {
  return codeOwner("pane", terminalId);
}

/** The subject of a Code view about ONE TERMINAL — the Right panel's focused
 *  pane: the pane's place, its host, its own git reading, and the terminal
 *  itself, from the one (id, record) pair the caller read together. */
export function codeSubjectOf(
  host: HostKey,
  terminalId: TerminalId | null,
  meta: TerminalMetadata | null,
): CodeSubject {
  return {
    owner: terminalId === null ? null : paneCodeOwner(terminalId),
    host,
    git: codeGitOf(meta?.git),
    terminalId,
  };
}

/** WHAT THE RIGHT PANEL'S CODE VIEW IS ABOUT — the focused pane on the shown
 *  host, from the terminal store's ONE (id, record) bundle (`store.focused()`),
 *  so the pane, its place and its root can never tear apart. `focused()` is a
 *  tile's main terminal OR any split, so focusing a split re-keys everything
 *  onto THAT pane. Said once: the view, the per-host sets below and the
 *  history reset (`RightPanel`) all read this. */
const rightPanelSubject = createSharedRoot(() => {
  const store = useTerminalStore();
  return createMemo((): CodeSubject => {
    const pane = store.focused();
    return codeSubjectOf(activeHost(), pane.id, pane.meta);
  });
});
export const rightPanelCodeSubject: Accessor<CodeSubject> = () =>
  rightPanelSubject()();

/** The Right panel's leases: its one Code view leases here, and every host's
 *  set reads only while that view is shown AND its host is the shown one. */
const leases = createCodeLeases();

// The parallel per-host owner — see the header for WHY this is its own owner and not a
// `hostScopes` member. `createSharedRoot`: a lazy-once value inside the never-disposed
// app-lifetime root, so its `padiMap` read is decoupled from import order (a unit test
// can stand up a mock `padiMap` before the owner first reads it).
const codeTabScopes = createSharedRoot(() =>
  scopedByEntry(padiMap, activeHost, (_host, ctx) =>
    buildCodeQueries({
      subject: rightPanelCodeSubject,
      state: useRightPanel().code,
      active: () => ctx.isActive() && leases.shown(),
    }),
  ),
);

/** The ACTIVE host's retained set — `undefined` only during the removal race (the
 *  active host left the pool; `wire.ts`'s reconcile re-points `activeHost` a tick
 *  later). The windows below floor that gap. */
const activeSet = () => codeTabScopes().active();

/** The query set the Right panel hands its Code view: STABLE windows over the
 *  active host's retained set, each delegating to the active host's query so a
 *  switch-BACK reads the held value with no resubscribe. `windowedSub` floors the
 *  removal-race `undefined` (value → floor, pending → true, error passthrough). */
export const rightPanelCodeQueries: CodeQueries = {
  localStatus: windowedSub(
    () => activeSet()?.localStatus,
    (v) => v,
    undefined,
  ),
  branchStatus: windowedSub(
    () => activeSet()?.branchStatus,
    (v) => v,
    undefined,
  ),
  activeStatus: windowedSub(
    () => activeSet()?.activeStatus,
    (v) => v,
    undefined,
  ),
  allPaths: windowedSub(
    () => activeSet()?.allPaths,
    (v) => v,
    undefined,
  ),
  diskRootLevel: windowedSub(
    () => activeSet()?.diskRootLevel,
    (v) => v,
    undefined,
  ),
  ignoredPaths: windowedSub(
    () => activeSet()?.ignoredPaths,
    (v) => v,
    undefined,
  ),
  diff: windowedSub(
    () => activeSet()?.diff,
    (v) => v,
    undefined,
  ),
  fileContent: windowedSub(
    () => activeSet()?.fileContent,
    (v) => v,
    undefined,
  ),
  lease: leases.lease,
};
