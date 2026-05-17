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
  GitChangedFile,
  GitDiffOutput,
  GitStatusOutput,
} from "./schemas.ts";

function changedFileEqual(a: GitChangedFile, b: GitChangedFile): boolean {
  return a.path === b.path && a.status === b.status && a.oldPath === b.oldPath;
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
