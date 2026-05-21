/** Factories for `CodeViewItem` so callers don't reach across the
 *  `solid-pierre` seam to construct item shapes by hand. A Pierre parse-API
 *  or item-shape churn lands in this file alone instead of every consumer
 *  that builds items.
 *
 *  - `diffItem` consumes a raw unified-diff string (kolu's server hands one
 *    per file via `getDiff`) and runs Pierre's `parsePatchFiles` to extract
 *    the single `FileDiffMetadata`. Returns `undefined` for empty / malformed
 *    diffs so the caller can render a placeholder instead of a broken item.
 *  - `fileItem` packages a filename + body string into Pierre's `FileContents`
 *    shape. */

import {
  type CodeViewDiffItem,
  type CodeViewFileItem,
  parsePatchFiles,
} from "@pierre/diffs";

export const diffItem = (
  id: string,
  rawDiff: string,
): CodeViewDiffItem | undefined => {
  if (!rawDiff) return undefined;
  const fileDiff = parsePatchFiles(rawDiff)[0]?.files[0];
  return fileDiff ? { id, type: "diff", fileDiff } : undefined;
};

export const fileItem = (
  id: string,
  name: string,
  contents: string,
): CodeViewFileItem => ({
  id,
  type: "file",
  file: { name, contents },
});
