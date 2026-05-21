/** Factories for `CodeViewItem` so callers don't reach across the
 *  `solid-pierre` seam to construct item shapes by hand. A Pierre parse-API
 *  or item-shape churn lands in this file alone instead of every consumer
 *  that builds items.
 *
 *  - `diffItem` consumes a raw unified-diff string (kolu's server hands one
 *    per file via `getDiff`) and runs Pierre's `parsePatchFiles` to extract
 *    the single `FileDiffMetadata`. Returns `undefined` for empty / malformed
 *    diffs so the caller can render a placeholder instead of a broken item.
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

export const diffItem = (
  id: string,
  rawDiff: string,
  onError: (err: Error) => void,
): CodeViewDiffItem | undefined => {
  if (!rawDiff) return undefined;
  let fileDiff: FileDiffMetadata | undefined;
  try {
    fileDiff = parsePatchFiles(rawDiff)[0]?.files[0];
  } catch (e) {
    onError(toError(e));
    return undefined;
  }
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
