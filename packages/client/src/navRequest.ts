/** Payload shared by the desktop and mobile "open this file:line"
 *  front doors (`openInCodeTab` for the right-panel CodeTab,
 *  `openInMobileFiles` for the Files drawer). Both producers (the
 *  terminal link provider, the mobile touchstart capture) emit the
 *  same four fields; both consumers (`CodeTab.tsx`, `MobileCodeSheet.tsx`)
 *  feed them through `resolveLineRefPath` against `fsListAll` before
 *  writing the selection slot.
 *
 *  The two front-door *modules* stay split — desktop is paired with
 *  panel-uncollapse + tab + mode writes that mobile doesn't need (and
 *  the mobile sheet uses a Corvu drawer that desktop doesn't have).
 *  Only the payload shape is shared so a new field (Linear-style
 *  snippet ID, say) lands in one place instead of two. */

import type { CodeTabView } from "kolu-common/surface";
import type { LineRef } from "./ui/lineRef";

export interface NavRequest {
  /** Parsed `path:line[-end]` to navigate to. The path is resolved
   *  relative to `repoRoot` (or, when present, cwd-relative under
   *  `repoRoot`) by the consumer via `resolveLineRefPath`. */
  ref: LineRef;
  /** Per-terminal git repo root that `ref.path` is interpreted under.
   *  Absolute paths beneath this root are also accepted — the resolver
   *  normalizes both shapes. */
  repoRoot: string;
  /** Terminal cwd at the time of the request. Drives the "user typed
   *  `bar.ts:42` while standing in a subdirectory" case; undefined
   *  falls back to repo-relative interpretation only. */
  cwd?: string;
  /** Which Code-tab sub-mode the request expects to land in.
   *  Producers that don't track an authoring mode pass `"browse"`. */
  targetMode: CodeTabView;
}
