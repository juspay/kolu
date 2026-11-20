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

function branchStatusEqual(a: GitBranchStatus, b: GitBranchStatus): boolean {
  return (
    a.name === b.name &&
    a.upstream === b.upstream &&
    a.ahead === b.ahead &&
    a.behind === b.behind
  );
}

function workingTreeEqual(
  a: GitWorkingTreeSummary,
  b: GitWorkingTreeSummary,
): boolean {
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
  if (a.mode !== b.mode) return false;
  if (!arrayEqual(a.files, b.files, changedFileEqual)) return false;
  if (a.mode === "local" && b.mode === "local") {
    return (
      branchStatusEqual(a.branch, b.branch) &&
      workingTreeEqual(a.workingTree, b.workingTree)
    );
  }
  if (a.mode === "branch" && b.mode === "branch") {
    const ab = a.base;
    const bb = b.base;
    if (ab === null || bb === null) return ab === bb;
    return ab.ref === bb.ref && ab.sha === bb.sha;
  }
  return false;
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
