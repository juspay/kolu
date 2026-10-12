/** Factories for `CodeViewItem` so callers don't reach across the
 *  `solid-pierre` seam to construct item shapes by hand. A Pierre parse-API
 *  or item-shape churn lands in this file alone instead of every consumer
 *  that builds items.
 *
 *  - `diffItems` consumes a raw unified-diff string (kolu's server hands one
 *    per selected path via `getDiff`) and runs Pierre's `parsePatchFiles`,
 *    yielding one item per file in the patch. Usually that is one file, but a
 *    path whose type changed (a directory replaced by a file) is a git
 *    pathspec matching the new file AND everything that used to live under
 *    it — every one of those files is part of that path's change. Returns
 *    `[]` for empty / malformed diffs so the caller can render a placeholder
 *    instead of a broken item.
 *    Parse throws (Pierre's parser is defensive but the contract is not
 *    formally `never-throws`) are routed through the required `onError`
 *    callback so a malformed header surfaces in the same toast lane as
 *    Pierre's render-time throws — silent swallowing would leave a blank
 *    pane indistinguishable from "no diff for this file".
 *  - `fileItem` packages a filename + body string into Pierre's `FileContents`
 *    shape. */

import {
  type CodeViewDiffItem,
  type CodeViewFileItem,
  type FileDiffMetadata,
  parsePatchFiles,
} from "@pierre/diffs";
import { toError } from "./toError";

/** Pierre 1.3 fills a missing `cacheKey` with the filename, so two parses
 *  of the same path with different contents look like the same highlight
 *  target and a live-updating Code tab keeps painting the first snapshot.
 *  Hash the raw input: a hunk/body change is a new cache identity. */
export const contentCacheKey = (id: string, content: string): string => {
  // FNV-1a 32-bit. Length rides along so a collision also needs a matching
  // size, which is enough for this cache-identity use (not a security hash).
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
  // Non-empty input that parsed to no file entry is a malformed-diff
  // signal, not "no changes to show" — surface it so the user sees a
  // toast rather than a blank pane indistinguishable from "loading".
  if (files.length === 0) {
    onError(new Error(`No file entry parsed from diff for ${id}`));
    return [];
  }
  // The first file keeps the caller's `id` — it is the selected path itself,
  // and line selection is keyed by it. Any further file is a former child of a
  // type-changed path and is keyed by its own name, unique within one patch.
  return files.map((fileDiff, i) => {
    const itemId = i === 0 ? id : fileDiff.name;
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
