import * as pty from "node-pty";
import { DEFAULT_COLS, DEFAULT_ROWS, SCROLLBACK_LIMIT } from "kolu-common";

export interface PtyHandle {
  process: pty.IPty;
  scrollback: Buffer[];
  scrollbackSize: number;
  clients: Set<{ send: (data: Buffer | string) => void }>;
}

export function spawnPty(): PtyHandle {
  const shell = process.env.SHELL || "/bin/bash";
  const cwd = process.env.HOME || "/";

  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols: DEFAULT_COLS,
    rows: DEFAULT_ROWS,
    cwd,
    env: { ...process.env } as Record<string, string>,
  });

  const handle: PtyHandle = {
    process: ptyProcess,
    scrollback: [],
    scrollbackSize: 0,
    clients: new Set(),
  };

  ptyProcess.onData((data: string) => {
    const buf = Buffer.from(data, "utf-8");

    // Append to scrollback
    handle.scrollback.push(buf);
    handle.scrollbackSize += buf.length;

    // Trim scrollback if over limit
    while (
      handle.scrollbackSize > SCROLLBACK_LIMIT &&
      handle.scrollback.length > 0
    ) {
      const removed = handle.scrollback.shift()!;
      handle.scrollbackSize -= removed.length;
    }

    // Broadcast to all connected clients
    for (const client of handle.clients) {
      client.send(buf);
    }
  });

  return handle;
}

export function writePty(handle: PtyHandle, data: string): void {
  handle.process.write(data);
}

export function resizePty(handle: PtyHandle, cols: number, rows: number): void {
  handle.process.resize(cols, rows);
}

export function getScrollbackSnapshot(handle: PtyHandle): Buffer {
  return Buffer.concat(handle.scrollback);
}
