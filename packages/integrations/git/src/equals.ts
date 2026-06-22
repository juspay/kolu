/** Equality predicates for streamed snapshot dedup.
 *
 * Co-located with the schemas they cover (`schemas.ts` types and
 * `browse.ts` outputs) so a schema change forces the predicate to update
 * in the same review. Streaming endpoint handlers pass these directly to
 * the snapshot-stream helper — one named predicate per output type, no
 * `JSON.stringify` shortcuts that silently break on a non-serializable
 * field addition.
 *
 * Each predicate is hand-written rather than a deep-equal library
 * because the output shapes are small and stable; making the comparison
 * explicit names exactly which fields participate in identity, which is
 * what dedup needs anyway. */
import type {
  FsListAllOutput,
  FsReadFileOutput,
  GitBranchStatus,
  GitChangedFile,
  GitDiffOutput,
  GitStatusOutput,
  GitWorkingTreeSummary,
} from "./schemas.ts";

function changedFileEqual(a: GitChangedFile, b: GitChangedFile): boolean {
  return a.path === b.path && a.status === b.status && a.oldPath === b.oldPath;
}

function branchStatusEqual(
  a: GitBranchStatus | null,
  b: GitBranchStatus | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.name === b.name &&
    a.upstream === b.upstream &&
    a.ahead === b.ahead &&
    a.behind === b.behind
  );
}

function workingTreeEqual(
  a: GitWorkingTreeSummary | null,
  b: GitWorkingTreeSummary | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.staged === b.staged &&
    a.modified === b.modified &&
    a.untracked === b.untracked
  );
}

function arrayEqual<T>(
  a: readonly T[],
  b: readonly T[],
  itemEqual: (x: T, y: T) => boolean,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (!itemEqual(x, y)) return false;
  }
  return true;
}

export function gitStatusOutputEqual(
  a: GitStatusOutput,
  b: GitStatusOutput,
): boolean {
  if (!arrayEqual(a.files, b.files, changedFileEqual)) return false;
  // `workingTree` is NOT derivable from `files[]` (it splits staged vs unstaged,
  // which the collapsed file codes drop), and `branch` ahead/behind moves on a
  // commit that leaves the file list untouched — so both must be compared here,
  // or the watcher stream would fail to re-yield after a `git add` / `git commit`.
  if (!branchStatusEqual(a.branch, b.branch)) return false;
  if (!workingTreeEqual(a.workingTree, b.workingTree)) return false;
  const ab = a.base;
  const bb = b.base;
  if (ab === null || bb === null) return ab === bb;
  return ab.ref === bb.ref && ab.sha === bb.sha;
}

export function gitDiffOutputEqual(
  a: GitDiffOutput,
  b: GitDiffOutput,
): boolean {
  return (
    a.oldFileName === b.oldFileName &&
    a.newFileName === b.newFileName &&
    a.binary === b.binary &&
    arrayEqual(a.hunks, b.hunks, (x, y) => x === y)
  );
}

export function fsListAllOutputEqual(
  a: FsListAllOutput,
  b: FsListAllOutput,
): boolean {
  return arrayEqual(a.paths, b.paths, (x, y) => x === y);
}

export function fsReadFileOutputEqual(
  a: FsReadFileOutput,
  b: FsReadFileOutput,
): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "text" && b.kind === "text") {
    return a.content === b.content && a.truncated === b.truncated;
  }
  if (a.kind === "binary" && b.kind === "binary") {
    return a.url === b.url;
  }
  return false;
}
