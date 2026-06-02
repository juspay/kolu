/** xterm.js link provider that linkifies `path:line[:col][-end]`
 *  references in terminal output. Parsing semantics + the regex live
 *  in `ui/lineRef.ts` — this module is just the xterm adapter:
 *  buffer-line → `parseLineRefs` → `ILink[]`. */

import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { type LineRef, type LineRefMatch, parseLineRefs } from "../ui/lineRef";

export interface FileRefLinkOpts {
  onActivate: (ref: LineRef, event: MouseEvent) => void;
}

/** Parse the `path:line` references on a buffer line (0-based index). The one
 *  place both the hover provider and the touch hit-test read a buffer line, so
 *  they can never disagree on what is a link. Returns [] for a missing line or
 *  one with no resolvable reference. */
function lineRefsAt(terminal: Terminal, bufferLine: number): LineRefMatch[] {
  const lineObj = terminal.buffer.active.getLine(bufferLine);
  if (!lineObj) return [];
  const text = lineObj.translateToString(true);
  // Cheap necessary condition: every match requires at least one `/`
  // (slash-containing branch) or one `.` (bare extension branch). Skipping the
  // regex on plain prompts is a meaningful win on a hot path that fires per
  // hover-cell. `:` alone is no longer sufficient since `:N` became optional.
  if (text.indexOf("/") < 0 && text.indexOf(".") < 0) return [];
  return parseLineRefs(text);
}

export function createFileRefLinkProvider(
  terminal: Terminal,
  opts: FileRefLinkOpts,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      // `bufferLineNumber` is xterm's 1-based row; `lineRefsAt` takes a 0-based
      // index into the active buffer (scrollback + viewport).
      const matches = lineRefsAt(terminal, bufferLineNumber - 1);
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
 *  cell and asks here whether a reference covers it. Shares `lineRefsAt` with
 *  the provider, so a tap and a hover never disagree about what is a link.
 *
 *  `col` and `bufferLine` are 0-based xterm buffer indices. Returns the
 *  covering ref, or null for plain content (the tap should focus to type). */
export function fileRefAtCell(
  terminal: Terminal,
  col: number,
  bufferLine: number,
): LineRef | null {
  for (const match of lineRefsAt(terminal, bufferLine)) {
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
