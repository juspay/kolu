import * as pty from "node-pty";

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const SCROLLBACK_LIMIT = 100 * 1024; // 100KB

export interface PtyHandle {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  getScrollback(): Buffer;
  dispose(): void;
}

export function spawnPty(opts: {
  onData: (data: Buffer) => void;
  onExit: (exitCode: number) => void;
}): PtyHandle {
  const shell = process.env.SHELL || "/bin/bash";
  const cwd = process.env.HOME || "/";

  const proc = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd,
    env: { ...process.env } as Record<string, string>,
  });

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
