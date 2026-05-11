import type { IDisposable, ILink, ILinkProvider, Terminal } from "@xterm/xterm";
import { findLineRefs, type LineRef } from "../ui/lineRef";

/** Callback invoked when a terminal file-reference link is activated. */
export type FileReferenceLinkHandler = (ref: LineRef) => void;

/** Register an xterm link provider for repo file references like `src/app.ts:4`. */
export function registerFileReferenceLinks(
  terminal: Terminal,
  onOpen: FileReferenceLinkHandler,
): IDisposable {
  return terminal.registerLinkProvider(
    new FileReferenceLinkProvider(terminal, onOpen),
  );
}

class FileReferenceLinkProvider implements ILinkProvider {
  constructor(
    private readonly terminal: Terminal,
    private readonly onOpen: FileReferenceLinkHandler,
  ) {}

  provideLinks(
    bufferLineNumber: number,
    callback: (links: ILink[] | undefined) => void,
  ): void {
    const line = this.terminal.buffer.active.getLine(bufferLineNumber - 1);
    const text = line?.translateToString(true);
    if (!text) {
      callback(undefined);
      return;
    }

    const links = findLineRefs(text).map((ref): ILink => {
      const { path, start, end } = ref;
      return {
        text: ref.text,
        range: {
          start: { x: ref.startIndex + 1, y: bufferLineNumber },
          end: { x: ref.endIndex, y: bufferLineNumber },
        },
        activate: () => this.onOpen({ path, start, end }),
      };
    });
    callback(links.length > 0 ? links : undefined);
  }
}
