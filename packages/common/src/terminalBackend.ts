/**
 * `TerminalBackend` — the per-terminal world a terminal lives in.
 *
 * Concretely, the backend owns: what process holds the PTY, what
 * filesystem the Code-tab reads, where the git watcher runs, where the
 * per-terminal providers (Claude Code, OpenCode, Codex, GitHub PR,
 * foreground process) observe their state. Every per-terminal stream
 * and every per-host one-shot fs/git op goes through this object.
 *
 * Two concrete shapes are planned:
 *
 *   - `LocalTerminalBackend` (this PR) — this kolu process. PTY spawned
 *     in-process via `node-pty`, providers watch local files via
 *     `@parcel/watcher`, fs/git ops shell out locally.
 *   - `RemoteTerminalBackend` (future R-2) — a specific SSH host. PTY
 *     runs in a `kolu --stdio` agent on that host; every method proxies
 *     via oRPC over the agent's typed surface.
 *
 * The interface lives in `kolu-common` because both the kolu-server's
 * `LocalTerminalBackend` and the future `RemoteTerminalBackend`
 * reference the same shape. Every consumer downstream — router, surface,
 * orchestrators — talks to `backend.X` and never asks "which kind?". The
 * sole place that pattern-matches on `location.kind` is
 * `getTerminalBackendFor` (server-side resolver).
 *
 * ── Invariants ─────────────────────────────────────────────────────────
 *
 * 1. **Kill convergence.** `killTerminal(id)` is the sole termination
 *    path. `TerminalHandle` does NOT carry `dispose()` — handle-as-
 *    control-surface and kill-as-lifecycle are two distinct roles.
 *
 * 2. **Backend owns its filesystem.** `TerminalBackendFs` /
 *    `TerminalBackendGit` cover BOTH one-shot ops AND watcher
 *    subscriptions — same volatility axis ("where the FS lives"), one
 *    place to dispatch.
 *
 * 3. **Sync shadow entry, async I/O.** `spawnPty` registers a
 *    `TerminalProcess` entry synchronously (so the tile renders
 *    immediately), then any I/O happens on a later tick.
 *    `LocalTerminalBackend`'s I/O is instantaneous so this is a no-op
 *    there; `RemoteTerminalBackend` will need minutes for cold `nix run`
 *    realisation and the contract is what makes the instant-tile UX
 *    work.
 */

import type {
  FsListAllOutput,
  GitDiffMode,
  GitDiffOutput,
  GitStatusOutput,
} from "kolu-git/schemas";
import type {
  InitialTerminalMetadata,
  TerminalId,
  TerminalInfo,
} from "./surface.ts";

/** Where a terminal lives. R-1 has only the local variant; R-2 will
 *  add `{ kind: "remote", host: string }`. The single-variant sum keeps
 *  every dispatch site (`getTerminalBackendFor`, sub-terminal
 *  inheritance) shaped the way they will be in R-2. */
export type TerminalLocation = { kind: "local" };

/** Per-terminal channel payload types — the streams a backend exposes
 *  for one terminal id. Subscribing returns the payload type
 *  corresponding to the channel kind. */
export interface TerminalChannelMap {
  /** Raw PTY output bytes — high frequency, drives xterm.js. */
  data: string;
  /** CWD changed (OSC 7 from PTY). */
  cwd: string;
  /** Terminal title changed (OSC 0/2 from PTY). */
  title: string;
  /** Raw OSC 633;E preexec command line — caller normalises. */
  commandRun: string;
}

/** Options the lifecycle layer hands to `spawnPty`. `cwd` resolves to
 *  the user's home when undefined. `parentId` and `initialMetadata` are
 *  seeded into the registry entry BEFORE per-terminal providers start —
 *  used by session restore to avoid racing post-hoc `setCanvasLayout` /
 *  `setTheme` / `setSubPanel` RPCs against the client's canvas-cascade
 *  effect (#642). */
export interface PtySpawnOpts {
  cwd?: string;
  parentId?: string;
  initialMetadata?: InitialTerminalMetadata;
}

/** Control surface for one running terminal. Read/write on the PTY and
 *  the headless xterm buffer. Deliberately omits `dispose()` —
 *  termination flows through `TerminalBackend.killTerminal` (kill
 *  convergence invariant). */
export interface TerminalHandle {
  /** OS process ID of the spawned shell (local) or a stable opaque id
   *  surfaced by the remote agent. */
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Serialized screen state (VT escape sequences) for late-joining
   *  clients. Empty string when the PTY hasn't produced output yet. */
  getScreenState(): string;
  /** Plain text content of the terminal buffer (scrollback + viewport). */
  getScreenText(startLine?: number, endLine?: number): string;
}

/** Filesystem operations scoped to a backend's host machine. Returns
 *  already-unwrapped values; implementations throw `ORPCError` on
 *  failure so consumers don't repeat error-unwrapping at every call
 *  site. */
export interface TerminalBackendFs {
  listAll(repoPath: string): Promise<FsListAllOutput>;
  readFile(
    repoPath: string,
    filePath: string,
  ): Promise<{ content: string; truncated: boolean }>;
  statFileMtimeMs(repoPath: string, filePath: string): Promise<number>;
  subscribeRepoChange(repoPath: string, onChange: () => void): () => void;
  subscribeFileChange(
    repoPath: string,
    filePath: string,
    onChange: () => void,
  ): () => void;
}

/** Git operations scoped to a backend's host machine. Same unwrap
 *  contract as `TerminalBackendFs`. */
export interface TerminalBackendGit {
  getStatus(repoPath: string, mode: GitDiffMode): Promise<GitStatusOutput>;
  getDiff(
    repoPath: string,
    filePath: string,
    mode: GitDiffMode,
    oldPath?: string,
  ): Promise<GitDiffOutput>;
}

/** Per-terminal world. The sole abstraction over local-vs-remote. */
export interface TerminalBackend {
  /** Spawn a PTY, register the terminal in the shared registry, start
   *  per-terminal providers. Returns synchronously even when the
   *  underlying I/O is async (sync-shadow invariant). The `id` is
   *  caller-supplied so the tile can render before this returns. */
  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo;

  /** Stop providers, kill the PTY, scrub per-terminal scratch storage,
   *  unregister from the shared registry. Sole termination path. */
  killTerminal(id: TerminalId): TerminalInfo | undefined;

  /** Drain and dispose every terminal owned by this backend. Used by
   *  the e2e harness between scenarios. */
  killAllTerminals(): void;

  /** Subscribe to a per-terminal channel. Returns an `AsyncIterable`
   *  that is already wired to the underlying publisher — subscription
   *  happens at call time, not at first iteration, so callers can
   *  subscribe-before-serialize without losing events. */
  subscribeTerminalChannel<K extends keyof TerminalChannelMap>(
    id: TerminalId,
    kind: K,
    signal: AbortSignal | undefined,
  ): AsyncIterable<TerminalChannelMap[K]>;

  readonly fs: TerminalBackendFs;
  readonly git: TerminalBackendGit;
}
