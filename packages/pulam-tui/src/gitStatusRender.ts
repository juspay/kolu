/**
 * Pure rendering helpers for `pulam-tui git-status` — no I/O, no transport, no
 * OpenTUI. The PROJECTION (how `GitStatusOutput` files are grouped, their tone,
 * and the branch summary) lives here as plain data so it is unit-tested under
 * Node/vitest and never depends on the Bun renderer; `gitStatusView.tsx` only
 * maps a tone to a colour and paints.
 *
 * R4.7 is the first consumer of the surface's fs/git *stream* — the
 * `subscribeRepoChange` `{seq}` pulse re-running `git.getStatus`. The view is
 * deliberately thin: working tree (staged · modified · untracked) and branch
 * (name · ahead/behind). No file content, no diff — `git status` alone drives
 * the exact procedure-plus-pulse loop kolu's Code tab depends on, so it is the
 * whole proof.
 */

import type {
  GitChangeStatus,
  GitChangedFile,
  GitStatusOutput,
} from "@kolu/terminal-workspace/surface";
import type { AwarenessValue } from "@kolu/terminal-workspace/surface";
import { cell, sanitize, type FieldTone } from "./render.ts";

const DASH = "—";

/** The three working-tree groups the view shows, in display order. */
export type StatusGroupName = "staged" | "modified" | "untracked";

/** A section of the view: a label, a tone, and the files in it. */
export interface GitStatusSection {
  name: StatusGroupName;
  label: string;
  tone: FieldTone;
  files: GitChangedFile[];
}

/** The branch-mode comparison: how many files differ from the base ref, and
 *  what that ref is. Null when branch mode had no base (a remote-less repo). */
export interface BranchComparison {
  ref: string;
  fileCount: number;
}

/** The whole view as plain data, projected from the two `git.getStatus` calls
 *  plus the branch name (read from the awareness collection). The view paints
 *  this; the data layer produces it. */
export interface GitStatusView {
  repoName: string;
  branch: string | null;
  sections: GitStatusSection[];
  branchComparison: BranchComparison | null;
  seq: number;
  error: string | null;
}

/** Bucket a `GitChangeStatus` into one of the three working-tree groups. Staged
 *  = newly added to the index (`A`); Modified = a tracked file with any change
 *  (`M`, `D`, `R`, `C`, `T`, `U`); Untracked = `?`. The exhaustive switch over
 *  the closed `GitChangeStatus` union means a new status code forces a decision
 *  here rather than silently falling to `modified`. */
function statusGroup(status: GitChangeStatus): StatusGroupName {
  switch (status) {
    case "A":
      return "staged";
    case "M":
    case "D":
    case "R":
    case "C":
    case "T":
    case "U":
      return "modified";
    case "?":
      return "untracked";
  }
}

const GROUP_META: Record<StatusGroupName, { label: string; tone: FieldTone }> =
  {
    staged: { label: "Staged", tone: "pass" },
    modified: { label: "Modified", tone: "plain" },
    untracked: { label: "Untracked", tone: "pending" },
  };

/** The display order of the three groups. */
const GROUP_ORDER: readonly StatusGroupName[] = [
  "staged",
  "modified",
  "untracked",
];

/** The one-letter status glyph the view paints beside each file. Matches the
 *  raw `GitChangeStatus` code — no transformation, so a new code surfaces
 *  verbatim rather than being silently mapped. */
export function statusGlyph(status: GitChangeStatus): string {
  return status;
}

/** Derive the repo name from an absolute path — the last path component. */
function repoNameFromPath(repoPath: string): string {
  return sanitize(repoPath.replace(/\/+$/, "").split("/").pop() || repoPath);
}

/** Find the branch name for `repoPath` by matching against the awareness
 *  collection's `git` fields. A terminal whose `git.repoRoot` or
 *  `git.worktreePath` equals `repoPath` carries the branch. Returns null when
 *  no terminal is in that repo (the branch is still unknown from awareness). */
export function branchFromAwareness(
  entries: Array<[string, AwarenessValue]>,
  repoPath: string,
): string | null {
  const normalized = repoPath.replace(/\/+$/, "");
  for (const [, v] of entries) {
    const git = v.git;
    if (!git) continue;
    if (
      git.repoRoot.replace(/\/+$/, "") === normalized ||
      git.worktreePath.replace(/\/+$/, "") === normalized
    ) {
      return sanitize(git.branch) || null;
    }
  }
  return null;
}

/** Group `GitChangedFile[]` into the three working-tree sections, in display
 *  order. Empty groups are omitted (the view shows only what exists). */
function groupFiles(files: GitChangedFile[]): GitStatusSection[] {
  const buckets: Record<StatusGroupName, GitChangedFile[]> = {
    staged: [],
    modified: [],
    untracked: [],
  };
  for (const f of files) {
    buckets[statusGroup(f.status)].push(f);
  }
  return GROUP_ORDER.filter((name) => buckets[name].length > 0).map((name) => ({
    name,
    label: GROUP_META[name].label,
    tone: GROUP_META[name].tone,
    files: buckets[name].sort((a, b) => a.path.localeCompare(b.path)),
  }));
}

/** Project the live git status view. Pure: same input, same output. The `seq`
 *  is the latest pulse counter (the liveness proof — it increments on each
 *  repo change). `error` is non-null when the latest re-query failed; the view
 *  surfaces it rather than collapsing to an empty screen. */
export function projectGitStatus(
  localStatus: GitStatusOutput | null,
  branchStatus: GitStatusOutput | null,
  branch: string | null,
  repoPath: string,
  seq: number,
  error: string | null,
): GitStatusView {
  const sections = localStatus !== null ? groupFiles(localStatus.files) : [];
  const branchComparison = deriveBranchComparison(branchStatus);
  return {
    repoName: repoNameFromPath(repoPath),
    branch,
    sections,
    branchComparison,
    seq,
    error,
  };
}

/** Derive the branch-mode summary: the base ref and how many files differ from
 *  it. Null when branch mode had no base (a remote-less repo) or when the
 *  status hasn't been queried yet. */
function deriveBranchComparison(
  branchStatus: GitStatusOutput | null,
): BranchComparison | null {
  if (!branchStatus || !branchStatus.base) return null;
  return {
    ref: sanitize(branchStatus.base.ref) || DASH,
    fileCount: branchStatus.files.length,
  };
}

/** `--json` — a flat object with the repo path, branch, and the local-mode
 *  status (files + base), for scripting. Honest `null` fields when the query
 *  failed or the branch is unknown, never an empty-object collapse. */
export function formatGitStatusJson(args: {
  repoPath: string;
  branch: string | null;
  status: GitStatusOutput | null;
  branchStatus: GitStatusOutput | null;
}): string {
  return JSON.stringify(
    {
      repoPath: args.repoPath,
      branch: args.branch,
      local: args.status,
      branchMode: args.branchStatus,
    },
    null,
    2,
  );
}

/** Pad a file path to `w` chars, or truncate with an ellipsis. Reuses the
 *  shared `cell` so the truncation rule is the same as the dashboard's. */
export function fileCell(path: string, w: number): string {
  return cell(sanitize(path), w);
}
