/**
 * `remoteHandle` — build a PtyHandle-shaped proxy for a remote
 * terminal. The kolu server's terminal-registry stores
 * `TerminalProcess.handle: PtyHandle` (the kolu-pty type); local
 * terminals use the real handle from `spawnPty`, but remote terminals
 * have no local PTY — operations must proxy via `session.client`.
 *
 * `getScreenState` and `getScreenText` return empty strings for the
 * prototype — late-joiner xterm-headless serialization would require
 * adding `terminal.screenState` / `terminal.screenText` to
 * `agentContract` and proxying via the agent's local emulator. For R-3.
 * Live data flows via `Backend.terminalChannel(id, "data")` which
 * starts streaming the moment the client subscribes, so the UX is
 * "instant live data, no scrollback replay on first attach."
 */

import type { PtyHandle } from "kolu-pty";
import { log } from "../log.ts";
import type { HostSession } from "./host-session.ts";

export function remoteHandle(opts: {
  id: string;
  cwd: string;
  session: HostSession;
}): PtyHandle {
  return {
    pid: 0, // Remote pid not exposed; consumers should gate on location.
    cwd: opts.cwd,
    process: "", // Foreground-process detection is server-local on R-2.
    foregroundPid: undefined,
    write(data: string): void {
      if (!opts.session.client) {
        log.warn(
          { host: opts.session.host, id: opts.id },
          "remoteHandle.write: session not connected; dropping input",
        );
        return;
      }
      void opts.session.client.terminal
        .write({ id: opts.id, data })
        .catch((err: Error) => {
          log.error(
            { host: opts.session.host, id: opts.id, err },
            "remoteHandle.write: agent RPC failed",
          );
        });
    },
    resize(cols: number, rows: number): void {
      if (!opts.session.client) {
        log.warn(
          { host: opts.session.host, id: opts.id },
          "remoteHandle.resize: session not connected; dropping resize",
        );
        return;
      }
      void opts.session.client.terminal
        .resize({ id: opts.id, cols, rows })
        .catch((err: Error) => {
          log.error(
            { host: opts.session.host, id: opts.id, err },
            "remoteHandle.resize: agent RPC failed",
          );
        });
    },
    getScreenState(): string {
      // Late-joiner snapshot is R-3; channel data fills on subscribe.
      return "";
    },
    getScreenText(_startLine?: number, _endLine?: number): string {
      return "";
    },
    dispose(): void {
      if (!opts.session.client) {
        log.warn(
          { host: opts.session.host, id: opts.id },
          "remoteHandle.dispose: session not connected; skipping RPC kill",
        );
        return;
      }
      void opts.session.client.terminal
        .kill({ id: opts.id })
        .catch((err: Error) => {
          log.error(
            { host: opts.session.host, id: opts.id, err },
            "remoteHandle.dispose: agent RPC kill failed",
          );
        });
    },
  };
}
