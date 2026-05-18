/**
 * `Host` — the seam between "kolu runs a PTY locally" and "kolu drives a
 * PTY on another machine through a helper." Every PTY in the system goes
 * through this abstraction; the rest of the server (terminal lifecycle,
 * metadata providers, session restore) treats `LocalHost` and `RemoteHost`
 * identically.
 *
 * For v0 the interface is intentionally narrow: `spawnPty` (returns a
 * `PtyHandle`, the existing in-process shape) plus an identity for
 * persistence. Capabilities the talk-mode design called out — `exec`,
 * `watch` — are not wired in v0 (kolu-git and AgentProvider integrations
 * still run locally; remote terminals show no branch chip and no agent
 * badge). Adding them is a follow-up that extends this interface and
 * threads the host through the relevant providers.
 */

import type { Logger } from "../log.ts";
import type { PtyHandle } from "../pty.ts";

export interface SpawnPtyOpts {
  /** Stable ID for this terminal — used by the helper to namespace
   *  per-PTY state, and by kolu for logging correlation. */
  terminalId: string;
  /** Initial working directory. For `RemoteHost` this is interpreted on
   *  the remote host, not locally. */
  cwd?: string;
  onData(data: string): void;
  onExit(exitCode: number): void;
  onCwd?(cwd: string): void;
  onTitleChange?(title: string): void;
  onCommandRun?(command: string): void;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export interface ExecOpts {
  cwd?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

export interface Host {
  /** Stable id used in `TerminalCreateInput.hostId` and saved sessions.
   *  For `LocalHost` this is the sentinel "local"; for `RemoteHost` it
   *  is the SSH alias (e.g. `srid-remote-terminal`). */
  readonly id: string;
  /** Human-friendly label for the UI picker. */
  readonly label: string;
  /** Discriminator: "local" or "remote-ssh". The persisted `Location` on
   *  saved terminals uses this to round-trip. */
  readonly kind: "local" | "remote-ssh";

  spawnPty(tlog: Logger, opts: SpawnPtyOpts): Promise<PtyHandle>;

  /** Run `cmd` with `args` and return the captured output. `LocalHost`
   *  shells out to `child_process.execFile`; `RemoteHost` proxies the
   *  call to its helper. Metadata providers (kolu-git in particular)
   *  use this to evaluate git state in the namespace of the terminal's
   *  host instead of always against the controller's local fs. */
  exec(cmd: string, args: string[], opts: ExecOpts): Promise<ExecResult>;

  /** Watch a path for filesystem changes on this host. Returned handle's
   *  `stop()` tears down the underlying watch — `fs.watch` locally,
   *  helper-side `fs.watch` over the SSH socket remotely. */
  watch(
    path: string,
    onChange: (relPath: string) => void,
    opts?: { recursive?: boolean },
  ): Promise<{ stop(): void }>;

  /** Read-only SQLite query. Used by agent providers whose state lives
   *  in a DB on the host (OpenCode's `opencode.db`, Codex's
   *  `state_<N>.sqlite`). Routes through `node:sqlite` on whichever
   *  side the DB physically lives on. */
  queryDb(
    path: string,
    sql: string,
    params?: ReadonlyArray<string | number | null>,
  ): Promise<Array<Record<string, unknown>>>;

  /** Read a UTF-8 file. Used by kolu-git's `readFile` (Code tab content
   *  preview) so the Code-tab can render remote source. Truncation
   *  flag is reported back so the UI can warn. */
  readFile(
    path: string,
    opts?: { maxBytes?: number },
  ): Promise<{ content: string; truncated: boolean }>;

  /** Mtime in ms-since-epoch — feeds the iframe-preview URL's cache
   *  buster. */
  statMtimeMs(path: string): Promise<number>;

  /** Best-effort shutdown — disposes of any long-lived connection (the
   *  SSH child, helper process, etc.). PTYs spawned through this host
   *  are not explicitly disposed here; they are torn down when the
   *  underlying connection ends. */
  shutdown(): Promise<void>;
}
