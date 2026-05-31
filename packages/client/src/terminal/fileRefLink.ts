/** Kolu's `path:line[:col][-end]` linkifier — the *domain* half of the
 *  terminal link provider. The generic xterm machinery (turning matches into
 *  clickable `ILink`s) lives in `@kolu/solid-xterm`'s `createLineLinkProvider`;
 *  this module only knows what a file ref looks like. Parsing semantics + the
 *  regex live in `ui/lineRef.ts`. */

import type { LineLinkMatch } from "@kolu/solid-xterm";
import { type LineRef, parseLineRefs } from "../ui/lineRef";

/** Match every `path:line[:col][-end]` reference in one terminal line.
 *
 *  Preserves the per-hover-cell cheap-skip: every ref requires at least one
 *  `/` (slash-containing branch) or one `.` (bare extension branch), so plain
 *  prompts bail before the regex runs — a meaningful win on a hot path that
 *  fires per hover-cell. The matched `LineRef` rides along as the link payload
 *  so the click handler navigates without re-parsing. */
export function matchFileRefs(text: string): LineLinkMatch<LineRef>[] {
  // `:` alone is no longer sufficient since `:N` became optional.
  if (text.indexOf("/") < 0 && text.indexOf(".") < 0) return [];
  return parseLineRefs(text).map((match) => ({
    text: match.text,
    index: match.index,
    payload: {
      path: match.path,
      startLine: match.startLine,
      endLine: match.endLine,
    },
  }));
}
