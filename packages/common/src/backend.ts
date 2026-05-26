/**
 * Backend — the per-terminal world a terminal lives in.
 *
 * A `Backend` is identified by `BackendId` (local machine, or a specific
 * SSH host) and owns every per-terminal stream + one-shot op a terminal
 * needs. R-1 ships `LocalBackend` only; R-2 adds `RemoteBackend` whose
 * methods proxy via oRPC over `ssh stdio` to a `kolu agent --stdio`
 * instance on the remote host.
 *
 * The interface is the single transport boundary in the system. The
 * server's `meta/*.ts` orchestrators are dissolved into `LocalBackend`
 * (provider startup is now internal to `spawnPty`); the kolu server
 * invokes `backend.terminalChannel(id, "git")` and forwards. It does
 * not import from `kolu-git` directly for terminal-scoped work.
 *
 * Streaming methods follow the snapshot-then-delta invariant
 * (`.claude/rules/streaming.md`). The first yield is always a snapshot;
 * subsequent yields are deltas. `RemoteBackend` reuses oRPC's
 * `STREAM_RETRY` plumbing — `kolu agent --stdio` is just another oRPC
 * peer, no bespoke reconnect logic needed.
 *
 * Invariants enforced by convention (not by types):
 *
 * 1. **Kill convergence.** Both `Backend.killTerminal(id)` and
 *    `TerminalHandle.dispose()` must end at the same termination logic
 *    inside the backend — neither path may skip provider teardown,
 *    clipboard cleanup, or registry deregistration. R-2's `RemoteBackend`
 *    must wire `dispose()` through to `killTerminal` so RPC kill and
 *    handle-dispose are observationally indistinguishable.
 *
 * 2. **Snapshot-then-delta streams.** Every `terminalChannel<K>`
 *    iterator's first yield is a full state snapshot; subsequent yields
 *    are deltas. Without this, reconnect via `STREAM_RETRY` silently
 *    accumulates onto stale client state.
 *
 * Gap acknowledged for R-2: `packages/server/src/surface.ts`'s `streams`
 * block (gitStatus, gitDiff, fsListAll, fsReadFile) still calls
 * `kolu-git` directly rather than routing through `Backend.fs`/
 * `Backend.git`. For R-1 the Code tab works because every backend is
 * local; for R-2 those streams must route through the backend or remote
 * tiles will silently read the kolu-server's local filesystem instead of
 * the agent's. Tracked in the R-2 PR description.
 */

import type {
  GitDiffMode,
  GitDiffOutput,
  GitInfo,
  GitStatusOutput,
} from "kolu-git/schemas";
import type { InitialTerminalMetadata, TerminalLocation } from "./surface";

/** Seed metadata for a new terminal. Same shape as
 *  `InitialTerminalMetadata` (used by the `terminal.create` RPC input)
 *  plus the parent-link, which the client-create RPC carries as a
 *  top-level field for clarity. Bundled here so the backend has one
 *  `Object.assign`-shaped opt rather than seven optional fields. */
export interface TerminalSeed extends InitialTerminalMetadata {
  /** Sub-terminal link — present when this terminal is a child of an
   *  existing one. The lifecycle layer (terminals.ts) decides whether
   *  to inherit the parent's location; the backend just sets the
   *  field. */
  parentId?: string;
}

/**
 * Stable identity for a backend instance. Persisted to disk as part of
 * `ServerPersistedTerminalFields.location` so restore picks the same
 * backend a terminal previously lived on.
 */
export type BackendId = TerminalLocation;

/** Inputs for `Backend.spawnPty`. Mirrors today's `createTerminal` shape
 *  without any backend-specific extras — both LocalBackend and
 *  RemoteBackend accept the same options.
 *
 *  `initialMetadata` seeds the client-owned metadata fields (theme,
 *  canvasLayout, parentId, subPanel, rightPanel, intent) BEFORE the
 *  backend's providers emit their first publish — so the first
 *  `terminalMetadata` collection yield carries them, and the canvas
 *  default-cascade effect can't race the providers' churn (#642). The
 *  backend doesn't interpret the contents — it just sets the fields on
 *  the new terminal's metadata before starting providers.
 *
 *  `onExit` fires whenever the PTY process exits — naturally (shell typed
 *  `exit`, crash) or as a result of an explicit `dispose()` /
 *  `killTerminal()`. The `wasNatural` flag distinguishes the two so the
 *  caller knows whether to fan out session-save signals: only natural
 *  exit triggers an autosave; explicit kill already accounted for the
 *  registry change. (`killAllTerminals` drains the registry before
 *  disposing, so every kill-all callback observes `wasNatural=false` and
 *  shutdown doesn't write phantom empty sessions.) */
export interface PtySpawnOpts {
  cwd?: string;
  initialMetadata?: TerminalSeed;
  onExit?: (exitCode: number, wasNatural: boolean) => void;
}

/** A live terminal owned by a backend. `id` is shared across the system
 *  (the wire `TerminalId`); `write`/`resize`/`dispose` are the control
 *  surface. `dispose()` is observationally identical to
 *  `Backend.killTerminal(id)` — see the kill-convergence invariant in
 *  the module doc. */
export interface TerminalHandle {
  readonly id: string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
}

/** Per-terminal streaming channels. Snapshot-then-delta on every key. */
export interface TerminalChannelMap {
  /** Raw PTY bytes — high-throughput stream. */
  data: string;
  /** OSC 7 cwd updates. */
  cwd: string;
  /** OSC 0/2 title updates. */
  title: string;
  /** Git context for the terminal's cwd. */
  git: GitInfo | null;
  /** OSC 633;E preexec command lines (raw). */
  commandRun: string;
}

/** One-shot filesystem ops scoped to whatever filesystem the backend
 *  represents. For `LocalBackend` this is the local FS; for
 *  `RemoteBackend` it's the remote agent's FS. The kolu server treats
 *  them identically. */
export interface BackendFs {
  listAll(repoPath: string): Promise<string[]>;
  readFile(
    repoPath: string,
    filePath: string,
  ): Promise<{ content: string; truncated: boolean }>;
}

/** One-shot git ops. Types mirror `kolu-git/schemas` so the wire shape
 *  is identical regardless of backend. */
export interface BackendGit {
  getDiff(
    repoPath: string,
    filePath: string,
    mode: GitDiffMode,
    oldPath?: string,
  ): Promise<GitDiffOutput>;
  getStatus(repoPath: string, mode: GitDiffMode): Promise<GitStatusOutput>;
}

/**
 * The Backend interface — see module doc. R-1 ships `LocalBackend`. R-2
 * adds `RemoteBackend` and the binary serving its protocol
 * (`kolu agent --stdio`).
 *
 * Per-terminal screen-state reads (`getScreenState`, `getScreenText`)
 * deliberately do NOT live here: the xterm-headless emulator buffer is
 * per-terminal local state that survives backend swaps (a Phase-3
 * remote-agent reattach still serializes the local emulator's
 * scrollback). The emulator lives next to its handle in the registry;
 * callers read it via `getTerminal(id)?.handle.getScreenState()` rather
 * than through this interface.
 */
export interface Backend {
  readonly id: BackendId;

  /** Create a new terminal owned by this backend. */
  spawnPty(opts: PtySpawnOpts): Promise<TerminalHandle>;

  /** Subscribe to a terminal's stream of `kind`. Snapshot-then-delta;
   *  late joiners (e.g. tab refresh) receive the current snapshot
   *  before any deltas. Aborting the iterator closes the subscription. */
  terminalChannel<K extends keyof TerminalChannelMap>(
    terminalId: string,
    kind: K,
    signal?: AbortSignal,
  ): AsyncIterable<TerminalChannelMap[K]>;

  /** Kill a terminal owned by this backend. Returns true if the
   *  terminal was registered and the kill ran; false if the id was
   *  unknown (already cleaned up). Observationally identical to calling
   *  `dispose()` on the same terminal's handle — see kill-convergence
   *  invariant in the module doc. */
  killTerminal(terminalId: string): boolean;

  /** Filesystem and git one-shot ops on the backend's filesystem. */
  readonly fs: BackendFs;
  readonly git: BackendGit;
}
