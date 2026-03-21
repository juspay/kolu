/**
 * Pure PTY lifecycle wrapper around node-pty.
 *
 * Transport-agnostic: communicates via onData/onExit callbacks.
 * Maintains a scrollback buffer for late-joining clients.
 */
import * as pty from "node-pty";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const SCROLLBACK_LIMIT = 100 * 1024; // 100KB

export interface PtyHandle {
  /** OS process ID of the spawned shell. */
  readonly pid: number;
  /** Send input to the PTY (keystrokes, pasted text). */
  write(data: string): void;
  /** Resize the PTY grid. */
  resize(cols: number, rows: number): void;
  /** Concatenated scrollback buffer for replay on late-joining clients. */
  getScrollback(): Buffer;
  /** Kill the PTY process and release resources. */
  dispose(): void;
}

/** Spawn a shell in a PTY, calling back on data and exit. */
export function spawnPty(opts: {
  onData: (data: Buffer) => void;
  onExit: (exitCode: number) => void;
}): PtyHandle {
  const proc = pty.spawn(process.env.SHELL || "/bin/bash", [], {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd: process.env.HOME || "/",
    env: process.env,
  });

  // Ring buffer: drops oldest chunks when over SCROLLBACK_LIMIT
  let scrollback: Buffer[] = [];
  let scrollbackSize = 0;

  const dataDisposable = proc.onData((data: string) => {
    const buf = Buffer.from(data, "utf-8");
    scrollback.push(buf);
    scrollbackSize += buf.length;
    while (scrollbackSize > SCROLLBACK_LIMIT && scrollback.length > 0) {
      scrollbackSize -= scrollback.shift()!.length;
    }
    opts.onData(buf);
  });

  const exitDisposable = proc.onExit(({ exitCode }) => {
    opts.onExit(exitCode);
  });

  return {
    pid: proc.pid,
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    getScrollback: () => Buffer.concat(scrollback),
    dispose() {
      dataDisposable.dispose();
      exitDisposable.dispose();
      proc.kill();
      scrollback = [];
      scrollbackSize = 0;
    },
  };
}
