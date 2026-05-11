/** xterm.js link provider that linkifies file references like
 *  `packages/foo/bar.ts:123`, `src/Type.hs:42-58`, or
 *  `/abs/path.rs:10:4`. Clicking a link opens the file in the right
 *  panel's Code tab at the referenced line(s).
 *
 *  The regex accepts two path shapes:
 *    1. Slash-containing — `(maybe-leading-/)(seg/)+seg`.
 *    2. Bare filename with letter-led extension — `Type.hs`,
 *       `package.json`. Requiring the extension to start with a
 *       letter keeps IPv4-style `192.168.1.1:8080` and version
 *       strings like `1.2.3:5` from getting linkified.
 *
 *  Allowed path chars: word + `.`, `+`, `@`, `~`, `-`. Column suffix
 *  (`:N:M`) is consumed but discarded — only the line range is used. */

import type { ILink, ILinkProvider, Terminal } from "@xterm/xterm";

export interface FileRef {
  /** Path as it appeared in the terminal. Absolute (`/…`) or
   *  repo-relative (`packages/…`). Caller resolves against repoRoot. */
  path: string;
  /** First line of the reference (1-based, inclusive). */
  startLine: number;
  /** Last line. Equal to startLine when no range was given. */
  endLine: number;
}

const FILE_REF_RE =
  /(\/?(?:[\w.+@~-]+\/)+[\w.+@~-]+|[\w.+@~-]+\.[A-Za-z]\w*):(\d+)(?::\d+|-(\d+))?/g;

interface ParsedMatch {
  ref: FileRef;
  index: number;
  text: string;
}

export function parseFileRefs(line: string): ParsedMatch[] {
  const out: ParsedMatch[] = [];
  FILE_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  m = FILE_REF_RE.exec(line);
  while (m !== null) {
    const path = m[1];
    const start = Number(m[2]);
    const end = m[3] !== undefined ? Number(m[3]) : start;
    if (path && start >= 1 && end >= start) {
      out.push({
        ref: { path, startLine: start, endLine: end },
        index: m.index,
        text: m[0],
      });
    }
    m = FILE_REF_RE.exec(line);
  }
  return out;
}

export interface FileRefLinkOpts {
  onActivate: (ref: FileRef, event: MouseEvent) => void;
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
      const matches = parseFileRefs(text);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }
      const links: ILink[] = matches.map(({ ref, index, text: linkText }) => ({
        range: {
          start: { x: index + 1, y: bufferLineNumber },
          end: { x: index + linkText.length, y: bufferLineNumber },
        },
        text: linkText,
        activate: (event) => opts.onActivate(ref, event),
      }));
      callback(links);
    },
  };
}
