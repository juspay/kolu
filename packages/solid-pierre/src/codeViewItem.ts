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
 *  and runs no Pierre editor, so both are `undefined`. */
export type CodeViewItem = PierreItem<undefined>;
export type CodeViewFileItem = PierreFileItem<undefined>;
export type CodeViewDiffItem = PierreDiffItem<undefined>;

declare const cacheIdentity: unique symbol;

export type CacheKey = string & { readonly [cacheIdentity]: true };

export const contentIdentityHash = (id: string, content: string): CacheKey => {
  let h = 0x811c9dc5;
  for (let i = 0; i < content.length; i++) {
    h ^= content.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${id}:${content.length.toString(16)}:${(h >>> 0).toString(16)}` as CacheKey;
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
      fileDiff: { ...fileDiff, cacheKey: contentIdentityHash(itemId, rawDiff) },
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
  file: { name, contents, cacheKey: contentIdentityHash(id, contents) },
});

/** One `CodeViewDiffItem` from a file's before/after TEXT. */
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
      cacheKey: contentIdentityHash(id, `${oldText ?? ""}\u0000${newText}`),
    },
  };
};
