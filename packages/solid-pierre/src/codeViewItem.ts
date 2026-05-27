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
    // Pierre's `parsePatchFiles` returns `ParsedPatch[]`, each with a
    // `files: FileDiffMetadata[]`. Kolu's server emits one hunk string
    // per file (`GitDiffOutputSchema.hunks` — single per-file patch),
    // so the first patch's first file is the only entry we care about.
    fileDiff = parsePatchFiles(rawDiff)[0]?.files[0];
  } catch (e) {
    onError(toError(e));
    return undefined;
  }
  // Non-empty input that parsed to no file entry is a malformed-diff
  // signal, not "no changes to show" — surface it so the user sees a
  // toast rather than a blank pane indistinguishable from "loading".
  if (!fileDiff) {
    onError(new Error(`No file entry parsed from diff for ${id}`));
    return undefined;
  }
  return { id, type: "diff", fileDiff };
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
