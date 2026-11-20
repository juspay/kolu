import {
  type CodeViewDiffItem as PierreDiffItem,
  type CodeViewFileItem as PierreFileItem,
  type CodeViewItem as PierreItem,
  type FileDiffMetadata,
  parseDiffFromFile,
  parsePatchFiles,
} from "@pierre/diffs";
import { toError } from "./toError";

/** Pierre parameterizes every rendered item by the line-annotation payload it
 *  carries and by the caret type its editor uses. Kolu renders no annotations
 *  and runs no Pierre editor, so both are `undefined` — pinned ONCE here and
 *  re-exported as the kolu spelling of these types, so the wrapper, the
 *  factories and the host all agree and a future annotation payload is one
 *  edit rather than a sweep of `<undefined>`s. */
export type CodeViewItem = PierreItem<undefined>;
export type CodeViewFileItem = PierreFileItem<undefined>;
export type CodeViewDiffItem = PierreDiffItem<undefined>;

/** Pierre 1.3 fills a missing `cacheKey` with the filename, so two parses
 *  of the same path with different contents look like the same highlight
 *  target and a live-updating Code tab keeps painting the first snapshot.
 *  Hash the raw input: a hunk/body change is a new cache identity. */
export const contentCacheKey = (id: string, content: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${id}:${content.length.toString(16)}:${(h >>> 0).toString(16)}`;
};

export const diffItems = (
  id: string,
  rawDiff: string,
  onError: (err: Error) => void,
): CodeViewDiffItem[] => {
  if (!rawDiff) return [];
  let files: FileDiffMetadata[];
  try {
    files = parsePatchFiles(rawDiff).flatMap((patch) => patch.files);
  } catch (e) {
    onError(toError(e));
    return [];
  }
  if (files.length === 0) {
    onError(new Error(`No file entry parsed from diff for ${id}`));
    return [];
  }
  const own = files.length === 1 ? 0 : files.findIndex((f) => f.name === id);
  if (own === -1) {
    onError(
      new Error(
        `Diff for ${id} has ${files.length} files and none is named ${id}`,
      ),
    );
    return [];
  }
  return files.map((fileDiff, i) => {
    const itemId = i === own ? id : fileDiff.name;
    return {
      id: itemId,
      type: "diff",
      fileDiff: { ...fileDiff, cacheKey: contentCacheKey(itemId, rawDiff) },
    };
  });
};

export const fileItem = (
  id: string,
  name: string,
  contents: string,
): CodeViewFileItem => ({
  id,
  type: "file",
  file: { name, contents, cacheKey: contentCacheKey(id, contents) },
});

/** One `CodeViewDiffItem` from a file's before/after TEXT.
 *
 *  `throwOnError` is left at Pierre's default rather than forced: the inputs
 *  here are two strings the agent already sent, so there is no header to be
 *  malformed — the failure mode `diffItems` guards with `onError` cannot
 *  arise on this path, and a required callback nobody can trigger is a
 *  parameter that teaches a reader the wrong thing.
 *
 *  The cache key hashes BOTH texts, so an agent that rewrites the same path
 *  twice in one turn gets two highlight identities instead of a card still
 *  painting its first snapshot. */
export const textDiffItem = (
  id: string,
  path: string,
  oldText: string | null,
  newText: string,
): CodeViewDiffItem => {
  const fileDiff = parseDiffFromFile(
    oldText === null ? null : { name: path, contents: oldText },
    { name: path, contents: newText },
  );
  return {
    id,
    type: "diff",
    fileDiff: {
      ...fileDiff,
      cacheKey: contentCacheKey(id, `${oldText ?? ""}\u0000${newText}`),
    },
  };
};
