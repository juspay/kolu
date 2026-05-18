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

  /** Best-effort shutdown — disposes of any long-lived connection (the
   *  SSH child, helper process, etc.). PTYs spawned through this host
   *  are not explicitly disposed here; they are torn down when the
   *  underlying connection ends. */
  shutdown(): Promise<void>;
}
