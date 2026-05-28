/** xterm.js link provider that linkifies `path:line[:col][-end]`
 *  references in terminal output. Parsing semantics + the regex live
 *  in `ui/lineRef.ts` — this module is just the xterm adapter:
 *  buffer-line → `parseLineRefs` → `ILink[]`. */

import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { type LineRef, parseLineRefs } from "@kolu/file-line-ref";

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
