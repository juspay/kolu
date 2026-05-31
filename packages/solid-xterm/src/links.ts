/** Generic xterm link provider: turns per-line text matches into clickable
 *  xterm `ILink`s. The *what* to match (file refs, URLs, issue numbers, …)
 *  is injected by the consumer — this module only knows how to map a
 *  `{text, index}` hit on a buffer line into xterm's 1-based link geometry.
 *
 *  Kolu's `path:line` linkifier is one such consumer; the matching/regex
 *  semantics live in Kolu domain code (`ui/lineRef`), not here. */

import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";

/** One match within a buffer line, plus an opaque payload handed back to
 *  `onActivate` when the link is clicked. */
export interface LineLinkMatch<T> {
  /** The exact substring that matched (becomes the link's `text`). */
  text: string;
  /** 0-based start index of `text` within the line string. */
  index: number;
  /** Consumer data forwarded to `onActivate` verbatim. */
  payload: T;
}

export interface LineLinkOpts<T> {
  /** Find every linkable match in one line's plain text. Called per
   *  hover-cell on xterm's hot path, so the consumer should keep it cheap
   *  (e.g. a fast `indexOf` precondition before any regex). */
  match: (lineText: string) => LineLinkMatch<T>[];
  onActivate: (payload: T, event: MouseEvent) => void;
}

/** Build an `ILinkProvider` for `terminal` that linkifies whatever `match`
 *  finds on each line. Register it via `terminal.registerLinkProvider(...)`. */
export function createLineLinkProvider<T>(
  terminal: Terminal,
  opts: LineLinkOpts<T>,
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
      const matches = opts.match(text);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      const links: ILink[] = matches.map((m) => ({
        range: {
          start: { x: m.index + 1, y: bufferLineNumber },
          end: { x: m.index + m.text.length, y: bufferLineNumber },
        },
        text: m.text,
        activate: (event) => opts.onActivate(m.payload, event),
      }));
      callback(links);
    },
  };
}
