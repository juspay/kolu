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

/** A late-joining client's view of a terminal: the screen state at attach
 *  time plus the live output stream from exactly that point forward. The
 *  backend produces both atomically (subscribe-before-serialize) so no
 *  byte is lost or double-painted across the snapshot/delta boundary. */
export interface TerminalAttachment {
  /** Serialized screen state (VT escape sequences) at the instant of
   *  attach. Empty string when the PTY hasn't produced output yet. */
  snapshot: string;
  /** Live output deltas after the snapshot. Ends on iterator return,
   *  signal abort, or PTY exit. */
  deltas: AsyncIterable<string>;
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
  /** Resolves once the PTY actually exists (a handle vended on the sync
   *  shadow, invariant #3, can be issued verbs before its async spawn has
   *  resolved). Rejects if spawn failed. Consumers that must observe the live
   *  PTY (e.g. `attach`) await this first; fire-and-forget verbs queue behind
   *  it. Optional so a handle whose PTY exists at construction can omit it. */
  readonly ready?: Promise<void>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Serialized screen state (VT escape sequences) for late-joining
   *  clients. Empty string when the PTY hasn't produced output yet. Always a
   *  Promise: even the local handle reads it through the pty-host contract,
   *  and a socket/ssh handle reads it over the wire — callers `await` it. */
  getScreenState(): Promise<string>;
  /** Plain text content of the terminal buffer (scrollback + viewport).
   *  `tailLines` reads only the last N rendered lines — pass it instead of
   *  fetching the whole buffer when only the screen tail matters (e.g. the
   *  screen-scrape detector), so a long scrollback isn't allocated per read. */
  getScreenText(
    startLine?: number,
    endLine?: number,
    tailLines?: number,
  ): Promise<string>;
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
   *  unregister from the shared registry. Sole termination path. Awaits the
   *  pty-host's kill (hence the Promise) — synchronous and infallible
   *  in-process. A socket/ssh backend's kill *can* fail; it still unregisters
   *  (so a failed kill never strands a dead entry in the UI) and relies on
   *  reattach-time reconciliation against `terminal.list` to reap any surviving
   *  orphan — so unregistering is not a promise that the child is gone. */
  killTerminal(id: TerminalId): Promise<TerminalInfo | undefined>;

  /** Drain and dispose every terminal owned by this backend. Used by
   *  the e2e harness between scenarios. */
  killAllTerminals(): Promise<void>;

  /** Attach to a terminal's output: a screen-state snapshot plus the live
   *  delta stream from exactly that point forward. The snapshot is taken
   *  and the delta stream subscribed atomically, so the boundary between
   *  them loses and duplicates nothing. Always a Promise — the attach stream
   *  is opened through the pty-host contract (over the wire for a socket/ssh
   *  backend). */
  attach(
    id: TerminalId,
    signal: AbortSignal | undefined,
  ): Promise<TerminalAttachment>;

  readonly fs: TerminalBackendFs;
  readonly git: TerminalBackendGit;
}
