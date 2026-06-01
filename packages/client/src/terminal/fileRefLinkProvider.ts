/** xterm.js link provider that linkifies `path:line[:col][-end]`
 *  references in terminal output. Parsing semantics + the regex live
 *  in `ui/lineRef.ts` — this module is just the xterm adapter:
 *  buffer-line → `parseLineRefs` → `ILink[]`. */

import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { type LineRef, parseLineRefs } from "../ui/lineRef";

export interface FileRefLinkOpts {
  onActivate: (ref: LineRef, event: MouseEvent) => void;
}

export function createFileRefLinkProvider(
  terminal: Terminal,
  opts: FileRefLinkOpts,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      // `bufferLineNumber` is xterm's 1-based row. `getLine` takes a
      // 0-based index into the active buffer (scrollback + viewport).
      const lineObj = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!lineObj) {
        callback(undefined);
        return;
      }
      const text = lineObj.translateToString(true);
      // Cheap necessary condition: every match requires at least one
      // `/` (slash-containing branch) or one `.` (bare extension
      // branch). Skipping the regex on plain prompts is a meaningful
      // win on a hot-path that fires per hover-cell. `:` alone is no
      // longer sufficient since `:N` became optional.
      if (text.indexOf("/") < 0 && text.indexOf(".") < 0) {
        callback(undefined);
        return;
      }
      const matches = parseLineRefs(text);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      const links: ILink[] = matches.map((match) => ({
        range: {
          start: { x: match.index + 1, y: bufferLineNumber },
          end: { x: match.index + match.text.length, y: bufferLineNumber },
        },
        text: match.text,
        activate: (event) =>
          opts.onActivate(
            {
              path: match.path,
              startLine: match.startLine,
              endLine: match.endLine,
            },
            event,
          ),
      }));
      callback(links);
    },
  };
}

/** Hit-test a `path:line` reference at a buffer cell — the touch counterpart
 *  to the hover link provider above. xterm's built-in link activation is
 *  mouse/hover-driven and never fires for a touch tap, so the mobile tap
 *  handler resolves the ref itself: it converts the tap to a (col, buffer-line)
 *  cell and asks here whether a reference covers it. Uses the same
 *  `parseLineRefs` as the provider, so a tap and a hover never disagree about
 *  what is a link.
 *
 *  `col` and `bufferLine` are 0-based xterm buffer indices. Returns the
 *  covering ref, or null for plain content (the tap should focus to type). */
export function fileRefAtCell(
  terminal: Terminal,
  col: number,
  bufferLine: number,
): LineRef | null {
  const lineObj = terminal.buffer.active.getLine(bufferLine);
  if (!lineObj) return null;
  const text = lineObj.translateToString(true);
  if (text.indexOf("/") < 0 && text.indexOf(".") < 0) return null;
  for (const match of parseLineRefs(text)) {
    // Link range covers source indices [index, index + text.length); the
    // 0-based tap column maps directly onto that span.
    if (col >= match.index && col < match.index + match.text.length) {
      return {
        path: match.path,
        startLine: match.startLine,
        endLine: match.endLine,
      };
    }
  }
  return null;
}
