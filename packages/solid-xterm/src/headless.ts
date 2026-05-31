/** `@kolu/solid-xterm/headless` — the **server** side of the electricity grid.
 *
 *  The browser UI (`./index.ts`) and the headless screen mirror plug into the
 *  same package, but they're different sockets: the browser needs the full
 *  rendering `Terminal` from `@xterm/xterm`; the server needs the no-render
 *  `Terminal` from `@xterm/headless` to parse VT output into a buffer it can
 *  serialize for late-joining clients. This Node-only module owns the
 *  `@xterm/headless` + `@xterm/addon-serialize` imports (and the CJS-interop
 *  they require) so `kolu-pty-host` — and any future SSH-backed remote PTY
 *  host — never touches `@xterm/*` directly.
 *
 *  Import this subpath only from server code; it pulls `node:module` and must
 *  not reach a browser bundle. */

import { createRequire } from "node:module";

// @xterm packages ship CJS only — use createRequire for clean ESM interop.
// The require resolves from this package's location, so `@xterm/headless` and
// `@xterm/addon-serialize` are this package's dependencies, not the consumer's.
const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

/** The headless (non-rendering) xterm Terminal — a VT parser + screen buffer. */
export type HeadlessTerminal = InstanceType<typeof Terminal>;
/** SerializeAddon bound to a headless terminal. */
export type HeadlessSerializeAddon = InstanceType<typeof SerializeAddon>;

export interface HeadlessMirrorOptions {
  cols: number;
  rows: number;
  scrollback: number;
}

/** A headless terminal paired with its serialize addon — the unit the PTY host
 *  keeps per child to answer late-join snapshots. */
export interface HeadlessMirror {
  terminal: HeadlessTerminal;
  serialize: HeadlessSerializeAddon;
}

/** Construct a headless screen mirror. `allowProposedApi` is required for
 *  SerializeAddon to reach the buffer. The caller wires its own OSC/title/data
 *  handlers on `terminal` and reads `serialize.serialize()` for snapshots. */
export function createHeadlessMirror(
  opts: HeadlessMirrorOptions,
): HeadlessMirror {
  const terminal = new Terminal({
    cols: opts.cols,
    rows: opts.rows,
    scrollback: opts.scrollback,
    allowProposedApi: true,
  });
  const serialize = new SerializeAddon();
  terminal.loadAddon(serialize);
  return { terminal, serialize };
}

/** Extract plain text from an xterm buffer within a line range. Structurally
 *  typed over the buffer shape so callers needn't import xterm types. */
export function getScreenText(
  buffer: {
    length: number;
    getLine(
      i: number,
    ): { translateToString(trimRight: boolean): string } | undefined;
  },
  startLine?: number,
  endLine?: number,
): string {
  const start = Math.max(0, startLine ?? 0);
  const end = Math.min(buffer.length, endLine ?? buffer.length);
  const lines: string[] = [];
  for (let i = start; i < end; i++) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}
