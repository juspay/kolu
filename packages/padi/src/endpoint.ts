/**
 * `TerminalEndpoint` — the per-terminal world a terminal lives in.
 *
 * Concretely, the endpoint owns: what process holds the PTY, what
 * filesystem the Code-tab reads, where the git watcher runs, where the
 * per-terminal providers (Claude Code, OpenCode, Codex, GitHub PR,
 * foreground process) observe their state. Every per-terminal stream
 * and every per-host one-shot fs/git op goes through this object.
 *
 * There is **one** endpoint shape, not a family of backends. An endpoint
 * is three surfaces — PTY · fs · git — **bound to a transport**:
 *
 *   - **Local** (today) — this kolu process. PTY spawned in-process via
 *     `node-pty`, providers watch local files via `@parcel/watcher`,
 *     fs/git ops shell out locally.
 *   - **Remote** (P3, kaval-sessions) — the *same* surfaces dialed over
 *     ssh to a kaval on another host; fs/git mirror over the `HostSession`
 *     link rather than shelling out here. Not a separate implementation
 *     class — the same shape, a different transport.
 *
 * The interface lives in `kolu-common` because downstream consumers
 * (router, surface, orchestrators) and P3's remote-endpoint impl share
 * the same shape. Consumers talk to `endpoint.X` and never ask "where
 * does this live?" — the binding to a host is the endpoint's own concern.
 *
 * ── Invariants ─────────────────────────────────────────────────────────
 *
 * 1. **Kill convergence.** `killTerminal(id)` is the sole termination
 *    path. `TerminalHandle` does NOT carry `dispose()` — handle-as-
 *    control-surface and kill-as-lifecycle are two distinct roles.
 *
 * 2. **The endpoint owns its filesystem.** `TerminalEndpointFs` /
 *    `TerminalEndpointGit` cover BOTH one-shot ops AND watcher
 *    subscriptions — same volatility axis ("where the FS lives"), one
 *    place the surfaces bind.
 *
 * 3. **Sync shadow entry, async I/O.** `spawnPty` registers a
 *    `TerminalProcess` entry synchronously (so the tile renders
 *    immediately), then any I/O happens on a later tick. The local
 *    endpoint's I/O is instantaneous so this is a no-op there; a remote
 *    endpoint (P3) will need minutes for cold `nix run` realisation and
 *    the contract is what makes the instant-tile UX work.
 */

import type {
  TerminalEndpointFs,
  TerminalEndpointGit,
} from "./terminalWorkspace/endpoint.ts";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { InitialTerminalMetadata, TerminalInfo } from "./vocab.ts";

/** RIS (`ESC c`) — a full terminal reset. An overflow-driven re-attach snapshot
 *  frame's `data` LEADS with this (see `reattachingDeltas`) so the consumer's
 *  screen + scrollback clear before the fresh snapshot repaints; the INITIAL
 *  attach snapshot does not. The client discriminates on `data.startsWith(
 *  TERMINAL_RESET)` so it can tell the reset a snapshot frame carries (expected)
 *  from a later live-delta RIS (foreign) when re-seeding backfill. Lives here —
 *  the client-reachable frame-type barrel — rather than in the server-only
 *  `reattachingDeltas` so both sides read the one source of truth. */
export const TERMINAL_RESET = "\x1bc";

/** A terminal grid — cols × rows. padi's OWN boundary type, deliberately not
 *  imported from the xterm kit or kaval (this module imports zero kaval/kit
 *  symbols by design — same rule that makes `PtySpawnOpts` a hand-declaration
 *  here); it carries a distinct name so padi's grid and the kit's
 *  identically-shaped grid type never read as one type in a grep. */
export interface EndpointGrid {
  cols: number;
  rows: number;
}

/** A late-joining client's view of a terminal: the screen state at attach
 *  time plus the live output stream from exactly that point forward. The
 *  endpoint produces both atomically (subscribe-before-serialize) so no
 *  byte is lost or double-painted across the snapshot/delta boundary. */
export interface TerminalAttachment {
  /** Serialized screen state (VT escape sequences) at the instant of
   *  attach — the recent screenful, not the whole mirror (older history
   *  streams in via `getHistory` as the client scrolls up). Empty string when
   *  the PTY hasn't produced output yet. */
  snapshot: string;
  /** Absolute mirror-line index of the snapshot's top row — the seed for the
   *  client's scrollback-backfill cursor (see `TerminalHistoryChunk`). */
  topLine: number;
  /** Reflow generation the snapshot was serialized under — the client stamps it
   *  on every `getHistory` so a later width reflow makes its stale absolute
   *  cursor a no-splice `stale` reply (F3). Undefined only from an older kaval
   *  that predates the field (fail-open — no gate). */
  reflowEpoch?: number;
  /** Live output deltas after the snapshot. Ends on iterator return,
   *  signal abort, or PTY exit. Each re-attach frame (after an overflow drop)
   *  carries its own fresh `topLine`, so a mid-stream re-seed stays anchored. */
  deltas: AsyncIterable<TerminalAttachFrame>;
}

/** One frame of the terminal byte stream a client consumes — a discriminated
 *  union, mirroring kaval's own `TerminalDataMsg` shape one hop up rather than
 *  flattening it to an optional field (the streaming-convention "explicit
 *  discriminated union" for snapshot-vs-delta, `.claude/rules/streaming.md` §2).
 *  A `delta` is just bytes to write. A `snapshot` frame — the stream's first
 *  frame and every overflow-driven re-attach — carries the fresh `topLine` seed
 *  for the client's backfill cursor. Modelling it as a union makes the two
 *  malformed states the old `{ data, topLine? }` shape permitted (a snapshot
 *  without its anchor, a delta carrying one) unrepresentable, so the consumer
 *  discriminates on `kind`, never on field presence. */
export type TerminalAttachFrame =
  | { kind: "delta"; data: string }
  | {
      kind: "snapshot";
      data: string;
      topLine: number;
      /** Reflow generation of the mirror this snapshot was taken under — the
       *  client re-seeds its backfill epoch from it so a foreign-resize reflow
       *  halts backfill rather than corrupting it (F3). Undefined from a kaval
       *  predating contract 5.2 (fail-open). */
      reflowEpoch?: number;
    };

/** One older-scrollback reply for the client's in-place backfill — the padi
 *  mirror of kaval's `PtyHistoryChunk`, a discriminated union so a served chunk
 *  and a stale-reflow halt can't be conflated (like `TerminalAttachFrame`).
 *  `topLine` is an absolute mirror-line index (see `TerminalHandle.getHistory`). */
export type TerminalHistoryChunk =
  | {
      kind: "chunk";
      /** VT-serialized bytes for the chunk's rows, replayed at the live width.
       *  Empty when nothing older remains. */
      chunk: string;
      /** Absolute mirror-line index of the chunk's top row — the caller's next
       *  cursor. Equal to the input `before` when the chunk is empty. */
      topLine: number;
      /** True once the chunk reaches the oldest line the mirror still holds. */
      exhausted: boolean;
    }
  /** The caller's stamped `epoch` no longer matches the mirror's reflow
   *  generation (a width reflow renumbered absolute rows since the cursor was
   *  seeded): NOTHING is served and the caller HALTS backfill until re-seed (F3).
   *  Only reachable when the caller sent an epoch (fail-open otherwise). */
  | { kind: "stale" };

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
  /** A ready-to-run agent resume invocation (the output of `resumeAgentCommand`,
   *  e.g. `claude -c`), written into the fresh PTY as type-ahead once its sensors
   *  are wired. Set only on WAKE — session-restore-of-one resumes the sleeping
   *  terminal's agent exactly as a reboot does. Undefined for an ordinary spawn. */
  resumeCommand?: string;
}

/** Control surface for one running terminal. Read/write on the PTY and
 *  the headless xterm buffer. Deliberately omits `dispose()` —
 *  termination flows through `TerminalEndpoint.killTerminal` (kill
 *  convergence invariant). */
export interface TerminalHandle {
  /** OS process ID of the spawned shell (local) or a stable opaque id
   *  surfaced by a remote endpoint. */
  readonly pid: number;
  /** Resolves once the PTY actually exists (a handle vended on the sync
   *  shadow, invariant #3, can be issued verbs before its async spawn has
   *  resolved). Rejects if spawn failed. Consumers that must observe the live
   *  PTY (e.g. `attach`) await this first; fire-and-forget verbs queue behind
   *  it. Optional so a handle whose PTY exists at construction can omit it. */
  readonly ready?: Promise<void>;
  write(data: string): void;
  /** Awaited, unlike `write`: a resize is a CLAIM about the consumer's grid, and
   *  a claim the host never accepted leaves that consumer rendering against a
   *  size the PTY does not have. The caller must be able to learn it failed, so
   *  this rejects rather than logging and resolving. */
  resize(cols: number, rows: number): Promise<void>;
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
  /** Older-scrollback read for the client's in-place backfill: serialize up to
   *  `max` mirror rows immediately ABOVE absolute line `before` (the client's
   *  cursor — the attach `topLine`, then each reply's `topLine`). Absolute
   *  addressing keeps the backfill seam race-free against live output. */
  getHistory(
    before: number | undefined,
    max: number,
    epoch?: number,
  ): Promise<TerminalHistoryChunk>;
}

// `TerminalEndpointFs` / `TerminalEndpointGit` — the fs/git half of the endpoint
// — live in `./terminalWorkspace/endpoint.ts` (folded into padi by L7, beside the
// one impl padi drives). The composite below imports them as types.

/** Per-terminal world — the three surfaces (PTY · fs · git) bound to an
 *  endpoint. Local today; P3 binds the same shape to a remote kaval. */
export interface TerminalEndpoint {
  /** Spawn a PTY, register the terminal in the shared registry, start
   *  per-terminal providers. Returns synchronously even when the
   *  underlying I/O is async (sync-shadow invariant). The `id` is
   *  caller-supplied so the tile can render before this returns. */
  spawnPty(id: TerminalId, opts: PtySpawnOpts): TerminalInfo;

  /** Stop providers, CLAIM the terminal (unregister from the shared registry),
   *  kill the PTY, then scrub per-terminal scratch storage. Sole termination
   *  path. Awaits the pty-host's kill (hence the Promise).
   *
   *  The claim comes BEFORE the kill on purpose, and it is unconditional: an
   *  implementation must not make unregistering depend on the kill succeeding.
   *  That buys idempotence under concurrency — the guard and the claim are one
   *  indivisible step, so a second overlapping kill returns `undefined` instead
   *  of driving a second teardown and a second signal at a pid the OS may have
   *  recycled. It costs nothing, because a kill *can* fail (a socket/ssh
   *  endpoint especially) and unregistering-anyway was already the behaviour, so
   *  that a failed kill never strands a dead entry in the UI. Unregistering is
   *  therefore not a promise that the child is gone; reattach-time
   *  reconciliation against `terminal.list` reaps a surviving orphan. The
   *  scratch scrub stays AFTER the kill so the PTY cannot re-create it. */
  killTerminal(id: TerminalId): Promise<TerminalInfo | undefined>;

  /** Drain and dispose every terminal owned by this endpoint. Used by
   *  the e2e harness between scenarios. */
  killAllTerminals(): Promise<void>;

  /** Attach to a terminal's output: a screen-state snapshot plus the live
   *  delta stream from exactly that point forward. The snapshot is taken
   *  and the delta stream subscribed atomically, so the boundary between
   *  them loses and duplicates nothing. Always a Promise — the attach stream
   *  is opened through the pty-host contract (over the wire for a socket/ssh
   *  endpoint).
   *
   *  `resizeTo` RESIZES the terminal before serializing — a real resize, with a
   *  SIGWINCH to the child and a reflow of the mirror every other attached
   *  client shares, so this "read" is a WRITE whenever it is present and differs
   *  from the terminal's current grid (policy: last-attach-wins). Fused on
   *  purpose: the returned bytes are laid out for a specific cols×rows, so the
   *  size must travel WITH the request instead of racing it through a separate
   *  resize. Omitted means "serialize at whatever size the PTY currently has",
   *  which is only correct for a caller that has no grid of its own (a CLI
   *  dumping the screen). */
  attach(
    id: TerminalId,
    signal: AbortSignal | undefined,
    resizeTo?: EndpointGrid,
  ): Promise<TerminalAttachment>;

  readonly fs: TerminalEndpointFs;
  readonly git: TerminalEndpointGit;
}
