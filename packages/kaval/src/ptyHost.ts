/**
 * `PtyHost` — the multi-client PTY-owner primitive.
 *
 * Owns, per PTY: a `node-pty` child, a libghostty-vt wasm screen mirror
 * (for cheap late-join snapshots — formatted VT vs replaying raw
 * scrollback), and the VT-derived event taps the rest of kolu reads off a
 * terminal:
 *
 *   - **cwd**         — OSC 7 `file://` reports
 *   - **title**       — OSC 0/2 title changes
 *   - **command-run** — OSC 633 ; E ; `<cmd>` (VS Code's "exact command
 *                       line" mark, emitted by kolu's preexec hook)
 *   - **exit**        — child exit code
 *   - **foregroundPid** — `tcgetpgrp(3)` of the pty, sampled on demand
 *
 * Each tap fans out through a bounded {@link FanOut} so any number of
 * consumers can attach. The host knows nothing about git, PRs, agent
 * detection, the file tree, or any wire protocol — those live above it.
 * It also knows nothing about shell-env preparation: callers hand it a
 * ready `shell` / `args` / `env` (kolu builds those via `kolu-pty`).
 *
 * Transport-agnostic and dependency-light (node-pty + libghostty-vt + a logger),
 * so the same primitive drops into an in-process backend today and a
 * standalone agent later.
 */

import { randomUUID } from "node:crypto";
import { createEngine, type Engine } from "@kolu/ghostty-kit";
import { shellJoin } from "@kolu/shell-quote";
import { shouldForwardHeadlessReply } from "@kolu/terminal-protocol";
import type { Logger } from "@kolu/surface-daemon";
import { Effect, type Scope, Stream } from "effect";
import * as pty from "node-pty";
import { FanOut, type SubscriberOverflow } from "./fanOut.ts";
import { type PtyGrid, PtyNotFound } from "./ptyHostSurface.ts";

/** Default terminal grid dimensions (matches xterm/VT100 standard). */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/** The per-live-terminal headless-mirror depth, in lines — the SINGLE source of
 *  truth for "how deep a mirror kaval keeps per terminal". It lives in kaval
 *  because the mirror lives in kaval: this is the number every spawn path lands
 *  on when it doesn't override scrollback (the in-process host, kaval-tui's
 *  `composeCreateInput`), AND the value the server's `composeSpawnInput` imports
 *  and sends explicitly — so all three paths provably agree.
 *
 *  Deliberately smaller than the CLIENT's visible scrollback (kolu-common's
 *  `DEFAULT_SCROLLBACK`, a distinct axis the user sees in their own tab): kaval
 *  keeps one mirror per live terminal and live terminals accumulate without
 *  bound, so a large shared depth × unbounded terminals exhausted the heap and
 *  SIGABRT'd the daemon. The mirror only needs enough to feed live readers and
 *  repaint a cold-attaching client; a warm client keeps its own buffer and PDF
 *  export reads the client buffer, so shrinking it regresses neither. See
 *  `docs/atlas/src/content/atlas/kaval-heap-oom.mdx`. */
export const DEFAULT_MIRROR_SCROLLBACK = 10_000;
/** How many scrollback lines the ATTACH snapshot serializes — the recent
 *  screenful a cold/cross-host attach paints instantly, instead of the whole
 *  {@link DEFAULT_MIRROR_SCROLLBACK}-deep mirror. Older lines are streamed in
 *  on demand by {@link PtyHost.getHistory} as the client scrolls up (the
 *  scrollback-backfill feature), so this bound sets the up-front paint cost, not
 *  the reachable history: the full mirror is still readable, one older chunk at
 *  a time. Deliberately far below the mirror depth — the whole point is to stop
 *  shipping 10k lines on every host switch (the W9 full-replay cost). The client
 *  seeds its backfill cursor from what it actually received, so the exact value
 *  is a perf knob, not a correctness one. */
export const SNAPSHOT_SCROLLBACK = 1_000;
/** How many exited-PTY exit codes to retain after teardown, so a late
 *  `exit(id)` succeeds with the real code rather than a fabricated
 *  one. Bounded so the map can't grow without limit. */
const MAX_EXIT_TOMBSTONES = 1024;

/** The terminal-identity string the headless PTY reports in its XTVERSION
 *  (CSI > q) reply. The DCS reply is built from this — see the XTVERSION
 *  handler in {@link createPtyHost} — so the byte layout lives in one place.
 *  Exported so tests assert against the same source rather than a copy. */
export const HEADLESS_TERM_ID = "libghostty-vt(kolu)";

/** Opaque PTY identifier. */
export type PtyId = string;

/** Extract plain text from a line-addressable buffer within a line range.
 *
 *  `tailLines` is a convenience for "the last N rendered lines": it pins
 *  `startLine` to `buffer.length - tailLines` (clamped at 0), the only place
 *  the live buffer length is known. This positional leaf is the single
 *  translation target for {@link ScreenExtent}; callers above pick exactly one
 *  bound, so `startLine` and `tailLines` never arrive together. */
export function getScreenText(
  buffer: {
    length: number;
    getLine(
      i: number,
    ): { translateToString(trimRight: boolean): string } | undefined;
  },
  startLine?: number,
  endLine?: number,
  tailLines?: number,
): string {
  const end = Math.min(buffer.length, endLine ?? buffer.length);
  const tailStart =
    tailLines === undefined ? startLine : end - Math.max(0, tailLines);
  const start = Math.max(0, tailStart ?? 0);
  const lines: string[] = [];
  for (let i = start; i < end; i++) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

const XTVERSION_RE = /\x1b\[>(\d*)q/g;
const DA1_RE = /\x1b\[\??0?c/g;
const DSR_STATUS_RE = /\x1b\[5n/g;
const DSR_CURSOR_RE = /\x1b\[6n/g;

export function answerDeviceQueries(
  data: string,
  write: (s: string) => void,
): void {
  XTVERSION_RE.lastIndex = 0;
  for (const m of data.matchAll(XTVERSION_RE)) {
    const ps = m[1] === "" ? 0 : Number(m[1]);
    if (Number.isFinite(ps) && ps > 0) continue;
    write(`\x1bP>|${HEADLESS_TERM_ID}\x1b\\`);
  }
  DA1_RE.lastIndex = 0;
  if (DA1_RE.test(data)) write("\x1b[?1;2c");
  if (data.includes("\x1b[>c")) write("\x1b[>0;276;0c");
  DSR_STATUS_RE.lastIndex = 0;
  if (DSR_STATUS_RE.test(data)) write("\x1b[0n");
  DSR_CURSOR_RE.lastIndex = 0;
  if (DSR_CURSOR_RE.test(data)) write("\x1b[1;1R");
  if (data.includes("\x1b[?2004$p")) write("\x1b[?2004;1$y");
  if (data.includes("\x1bP$qm\x1b\\")) write("\x1bP1$r0m\x1b\\");
}

/** Which slice of the rendered buffer a screen-text read returns — the single
 *  bound axis as a closed set of mutually-exclusive variants, so an illegal
 *  combination (a tail AND a range, a viewport AND a tail) is unrepresentable
 *  rather than resolved by a silent precedence. `viewport` is "the visible
 *  screen", resolved host-side to a tail of the live grid's own `rows` (a
 *  caller can't know it). Absent extent ⇒ the full buffer. */
export type ScreenExtent =
  | { kind: "full" }
  | { kind: "range"; startLine?: number; endLine?: number }
  | { kind: "tail"; lines: number }
  | { kind: "viewport" };

/**
 * Per-PTY control + introspection surface vended by {@link PtyHost.handle}.
 *
 * A thin facade over the host's id-keyed methods, so a consumer that holds
 * "one terminal" (the registry entry, the provider DAG) can read/write
 * without threading the id and host through every call. Deliberately omits
 * `dispose()` — termination flows through {@link PtyHost.kill}.
 */
export interface PtyHandle {
  /** OS process ID of the PTY's root process — the shell for a shell-rooted PTY,
   *  the command itself for a command-rooted one (`commandRooted`). */
  readonly pid: number;
  /** Current working directory (from OSC 7), seeded to the spawn cwd. */
  readonly cwd: string;
  /** Current foreground process name (from node-pty). */
  readonly process: string;
  /** Pid of the pty's current foreground process group leader
   *  (`tcgetpgrp(3)`), or `undefined` if not yet set. */
  readonly foregroundPid: number | undefined;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  /** Serialized screen state (VT escape sequences) for late-joining
   *  clients. Empty string before any output. */
  getScreenState(): string;
  /** Plain text content of the terminal buffer. `extent` bounds the read to one
   *  slice (range / tail / viewport); omit it for the full buffer (scrollback +
   *  viewport). See {@link ScreenExtent}. */
  getScreenText(extent?: ScreenExtent): string;
}

/** What a caller hands the host to spawn a PTY. Env/shell prep is the
 *  caller's job — the host just spawns what it's given. */
export interface PtySpawnOpts {
  /** Pre-chosen id; a UUID is generated when absent. */
  id?: PtyId;
  /** Program to spawn (e.g. the user's login shell). */
  shell: string;
  /** Arguments to the program (e.g. `--rcfile <wrapper>`). */
  args?: string[];
  /** True when `shell` is not a shell but the ROOT COMMAND itself — a
   *  `kaval-tui create -- <cmd>` PTY with the command as `argv[0]` and no shell
   *  wrapping it. The host seeds {@link PtyHost.getLastCommand} from the argv (a
   *  shell-less PTY never emits the OSC 633;E mark that is otherwise
   *  `lastCommand`'s only writer), and reports the fact on the inventory row so
   *  the workspace sensors read foreground==root as BUSY, not as an idle shell
   *  prompt. Absent/false = shell-rooted, today's behavior. */
  commandRooted?: boolean;
  /** Environment for the child — fully prepared by the caller. */
  env: Record<string, string>;
  /** Starting working directory. */
  cwd: string;
  /** Grid width (default 80). */
  cols?: number;
  /** Grid height (default 24). */
  rows?: number;
  /** Headless scrollback override for this PTY. */
  scrollback?: number;
  /** Fired once when the PTY is torn down — e.g. to clean up the
   *  per-terminal rc files the caller wrote before spawning. */
  onDispose?: () => void;
}

/** What {@link PtyHost.spawn} returns: the (possibly generated) id and the
 *  OS process id of the spawned child. */
export interface PtySpawnResult {
  id: PtyId;
  pid: number;
}

/** Result of {@link PtyHost.attach}: the screen state at attach time plus
 *  the live output stream from exactly that point forward. */
export interface PtyAttachment {
  /** Serialized screen state (VT escapes) at the instant of attach; empty
   *  for a brand-new PTY. Bounded to the recent screenful
   *  ({@link SNAPSHOT_SCROLLBACK}), not the whole mirror — older lines stream in
   *  via {@link PtyHost.getHistory} as the client scrolls up. */
  snapshot: string;
  /** Absolute mirror-line index of the snapshot's TOP row — the client's seed
   *  cursor for backfill (`getHistory`'s first `before`). Rides WITH the
   *  snapshot, from the same serialize, so the seed can't drift from the bytes
   *  the client received (an anchor fetched separately would race live output).
   *  0 for a brand-new/empty PTY. */
  topLine: number;
  /** Reflow generation the snapshot (and its `topLine`) was serialized under —
   *  the client stamps it on every `getHistory` so a subsequent width reflow
   *  (this or another attach's resize) makes the stale absolute cursor a
   *  no-splice `stale` reply rather than a duplicated/skipped band (F3). */
  reflowEpoch: number;
  /** Live output deltas after the snapshot. Ends when the attachment's scope
   *  closes (unsubscribing IS interrupting the consuming fiber) or the PTY
   *  exits, and FAILS with {@link SubscriberOverflow} when this attachment
   *  lagged past the bound — so the serving layer tells a slow-consumer drop
   *  apart from a graceful end by the channel it arrives on, not by a flag. */
  deltas: Stream.Stream<string, SubscriberOverflow>;
}

/** One older-history chunk from {@link PtyHost.getHistory}: a serialized slice
 *  of the mirror's scrollback the client replays and prepends into its own
 *  buffer as the user scrolls up.
 *
 *  The cursor is an ABSOLUTE mirror-line index — the count of lines ever evicted
 *  off the top of the mirror plus a line's current local buffer index, so it
 *  keeps naming the same line as newer output pushes older lines out:
 *  a `getHistory(before)` returns the `max` lines immediately ABOVE `before`.
 *  Absolute addressing is what makes the seam where backfilled history meets the
 *  client's existing content race-free: new output always appends at the mirror
 *  BOTTOM, never shifting the index of a line the client already holds, so a
 *  served chunk can neither duplicate nor skip a row regardless of how many live
 *  deltas are in flight during the fetch. (A `have`-from-bottom cursor cannot:
 *  it compares the server's produced-line count against the client's received
 *  count, which differ by exactly the in-flight lag.) */
export type PtyHistoryChunk =
  | {
      /** A served slice of older scrollback. */
      kind: "chunk";
      /** VT-serialized bytes for the chunk's rows, replayable through a terminal
       *  of the same width to reproduce the lines. Empty when nothing older
       *  remains (the top of the mirror). */
      chunk: string;
      /** Absolute mirror-line index of the chunk's TOP row — the caller's new
       *  cursor, passed as the next `before`. May sit a wrapped line's
       *  continuation-rows lower than a naive `before - max` because the top edge
       *  is snapped back to the wrapped line's head, so a chunk boundary never
       *  splits a logical line. */
      topLine: number;
      /** True once the chunk reaches the oldest line the mirror still holds — the
       *  caller stops backfilling. */
      exhausted: boolean;
    }
  | {
      /** The caller's stamped `epoch` no longer matches the mirror's current
       *  reflow generation — a width reflow renumbered absolute rows since the
       *  caller's cursor was seeded, so NOTHING is served and the caller HALTS
       *  backfill until a fresh snapshot re-seeds (F3). Only reachable when the
       *  caller sends an epoch; an epoch-less caller (older client / self-seeding
       *  pager) is fail-open and never sees this. A discriminated arm — not a
       *  `stale: true` flag on a chunk — so an illegal "stale reply that also
       *  carries real bytes" can't be constructed (matches `TerminalAttachFrame`). */
      kind: "stale";
    };

/** One foreground sample: the node-pty `process` name and the pty's
 *  foreground process-group pid (`tcgetpgrp(3)`). Both are read *at the tty*,
 *  so only the PTY's owner can produce them — in-process a consumer reads
 *  them synchronously off {@link PtyHandle}, but across a socket they can't
 *  be a sync getter, so {@link PtyHost.subscribeForeground} pushes them as a
 *  tap (the provider DAG that interprets them for agent detection runs on
 *  the other side of that socket). */
export interface ForegroundSample {
  process: string;
  foregroundPid: number | undefined;
}

/** A change to the set of live PTYs the host owns — the host-global membership
 *  feed. Unlike the per-PTY taps (cwd/title/command-run/foreground/exit), which
 *  a consumer can only subscribe to once it already KNOWS the id, this announces
 *  ids as they appear and vanish — so a consumer learns about PTYs OTHER clients
 *  spawned (a `kaval-tui create` against the same daemon) without polling
 *  {@link PtyHost.list}. The primitive emits only these deltas; the serving layer
 *  prepends a `list` snapshot (snapshot-then-deltas). */
export type PtyInventoryEvent =
  | { kind: "created"; entry: PtyListEntry }
  | { kind: "exited"; id: PtyId };

/** A MEANINGFUL-OUTPUT edge — this PTY just produced real output, NOT a
 *  resize-driven repaint. Host-global (a consumer subscribes once and hears every
 *  PTY), momentary (no snapshot): a consumer stamps ARRIVAL time on its OWN clock
 *  and derives its own idle windows, so a missed edge across a reconnect only
 *  DELAYS a downstream finish (default-excluded). kaval is the one place that can
 *  exclude the repaint, because it is the one place that knows it just resized. */
export type PtyActivityEdge = { id: PtyId };

/** One row of {@link PtyHost.list}: a live PTY's id, pid, cwd, last activity,
 *  and the metadata taps' current values (so a one-shot `list` carries the full
 *  picture without per-row tap subscriptions). */
export interface PtyListEntry {
  id: PtyId;
  pid: number;
  cwd: string;
  /** Epoch ms of the last data observed — a proxy for idle detection. */
  lastActivity: number;
  /** Current OSC 0/2 title (empty string if none set yet). */
  title: string;
  /** The PTY's current foreground process name (the running command). */
  foregroundProcess: string;
  /** True when the PTY's root process IS the spawned command, not a shell —
   *  a `kaval-tui create -- <cmd>` PTY. The workspace sensors read this to
   *  decide whether `foreground === root` means an idle shell prompt (a shell
   *  root) or a busy agent (a command root). Absent/false on the wire = a
   *  shell-rooted PTY, today's reading. */
  commandRooted: boolean;
}

/** Construction options for {@link createPtyHost}. */
export interface PtyHostOptions {
  log: Logger;
  /** Default headless scrollback for spawns that don't set their own. */
  defaultScrollback?: number;
  /** Id generator (defaults to `randomUUID`). */
  generateId?: () => PtyId;
  /** Per-attach-subscriber buffered-chunk cap for the data (attach) fan-out
   *  before a slow consumer is dropped (and an `overflow` frame emitted).
   *  Defaults to the {@link FanOut} default (10,000). Lowered in tests to drive
   *  the slow-subscriber drop deterministically. */
  dataMaxQueue?: number;
}

/** A PTY grid — cols × rows. Inferred from the surface's one grid schema (the
 *  file's convention for every other wire shape), so the type and the validation
 *  rule are one statement rather than two independently-editable ones. */
export type { PtyGrid };

/** The optional half of an {@link PtyHost.attach} — a bag rather than a trailing
 *  positional, so the write it carries is named at every call site. */
export interface PtyAttachOpts {
  /** RESIZES the PTY to this grid before serializing — a real `resize()`:
   *  SIGWINCH to the child, a reflow of the SHARED mirror, snapshot-memo
   *  invalidation, an activity mute, and (on a width change) a reflow-epoch bump
   *  that stales EVERY OTHER attached client's backfill cursor. Attaching is
   *  therefore a WRITE to shared state whenever this is present and differs from
   *  the PTY's current grid; the policy is last-attach-wins, so a second viewer
   *  at a different size moves the first one's layout.
   *
   *  The fusion is deliberate — a snapshot is bytes laid out for a specific
   *  cols×rows, so resize-and-serialize must be one act — and this name is what
   *  makes the write visible at the call site. Omit it only when the caller has
   *  no grid of its own (a CLI dumping the screen), which reads the PTY at its
   *  current size. */
  resizeTo?: PtyGrid;
}

/** The command a PTY has already run, retained so a late subscriber still learns
 *  it, with the QUOTING DIALECT it was written in (`true` = the command-rooted
 *  `shellJoin` seed, reparse with `shellSplit`; `false` = a raw OSC 633;E line,
 *  reparse with `string-argv`). */
export interface RetainedCommand {
  readonly command: string;
  readonly shellJoin: boolean;
}

/** {@link PtyHost.subscribeCommandRun}'s two halves, taken in ONE synchronous
 *  step so a mark published between them can neither be lost nor delivered
 *  twice. */
export interface CommandRunSubscription {
  /** The command retained at subscribe time, or `undefined` before the first
   *  mark. A consumer replays it as its snapshot frame. */
  readonly retained: RetainedCommand | undefined;
  /** Live OSC 633;E marks published AFTER the reading. */
  readonly marks: Stream.Stream<string, SubscriberOverflow>;
}

/** {@link PtyHost.subscribeForeground}'s two halves, taken in ONE synchronous
 *  step. */
export interface ForegroundSubscription {
  /** The foreground reading at subscribe time — a fresh `tcgetpgrp` sample, not
   *  a cached one, so a freshly-wired consumer warms its cache immediately. */
  readonly current: ForegroundSample;
  /** Live samples published AFTER the reading. */
  readonly samples: Stream.Stream<ForegroundSample, SubscriberOverflow>;
}

/** {@link PtyHost.subscribeInventory}'s two halves, taken in ONE synchronous
 *  step — which is what makes a spawn racing the subscribe arrive as a delta
 *  instead of falling into a gap. */
export interface InventorySubscription {
  /** Every PTY live at subscribe time. */
  readonly entries: PtyListEntry[];
  /** Membership deltas published AFTER the reading. A `created` also present in
   *  `entries` is impossible; a consumer's adoption is idempotent regardless. */
  readonly deltas: Stream.Stream<PtyInventoryEvent, SubscriberOverflow>;
}

/** The multi-client PTY-owner primitive. */
export interface PtyHost {
  /** Spawn a PTY; returns its id + pid immediately. */
  spawn(opts: PtySpawnOpts): PtySpawnResult;
  /** **Resizes the PTY to `opts.resizeTo` first** (a real `resize()` — see
   *  {@link PtyAttachOpts.resizeTo}, which mutates state every other attached
   *  client can see), then subscribe-before-serialize: a race-free snapshot +
   *  delta stream for a late-joining client, the two taken in ONE synchronous
   *  step (see {@link FanOut.subscribeWith}).
   *
   *  Scoped: the delta subscription is released when the caller's `Scope` closes
   *  — for a served member, when the consuming fiber is interrupted. There is no
   *  `AbortSignal` to pass and none to forget; an attach issued on an ALREADY
   *  interrupted fiber never runs at all, which is what used to need an explicit
   *  already-aborted fast path (no serialize, and no resize of the shared PTY,
   *  for a subscriber that has gone). */
  attach(
    id: PtyId,
    opts?: PtyAttachOpts,
  ): Effect.Effect<PtyAttachment, never, Scope.Scope>;
  /** Per-PTY cwd update stream (OSC 7). */
  subscribeCwd(id: PtyId): Stream.Stream<string, SubscriberOverflow>;
  /** Per-PTY title update stream (OSC 0/2). */
  subscribeTitle(id: PtyId): Stream.Stream<string, SubscriberOverflow>;
  /** Per-PTY preexec command marks (OSC 633 ; E payloads), with the RETAINED
   *  command read in the same synchronous step (see
   *  {@link CommandRunSubscription}) so a late subscriber learns the command
   *  that was already marked without a mark in between going missing or double. */
  subscribeCommandRun(
    id: PtyId,
  ): Effect.Effect<CommandRunSubscription, never, Scope.Scope>;
  /** Per-PTY foreground samples — `{process, foregroundPid}` pushed whenever it
   *  changes (sampled on title / command-run + a post-command burst, deduped),
   *  with the CURRENT sample read in the same synchronous step (see
   *  {@link ForegroundSubscription}). The socket equivalent of reading
   *  `PtyHandle.process` / `.foregroundPid` synchronously. */
  subscribeForeground(
    id: PtyId,
  ): Effect.Effect<ForegroundSubscription, never, Scope.Scope>;
  /** Succeeds with the exit code when the child exits; immediately for an
   *  already-exited PTY (the tombstone keeps the real code). Interrupting the
   *  waiting fiber deregisters the waiter, so a long-lived host doesn't retain
   *  one per abandoned subscription (e.g. one per kolu-server restart).
   *
   *  FAILS with {@link PtyNotFound} for an id this host has no entry and no
   *  tombstone for — never spawned, or exited far enough back to be evicted past
   *  {@link MAX_EXIT_TOMBSTONES}. "I don't know this PTY's exit code" is not an
   *  exit code, so it is not spelled as one. */
  exit(id: PtyId): Effect.Effect<number, PtyNotFound>;
  /** Write input (keystrokes, pasted text). No-op if the PTY is gone. */
  write(id: PtyId, data: string): void;
  /** Resize the PTY grid + the headless mirror. Returns TRUE when the entry
   *  existed and the grid now holds — whether that took a real resize or was an
   *  exact same-dimensions no-op — and FALSE when there is no such PTY (already
   *  exited or never spawned), which is the one way a caller's grid claim can
   *  fail to land here. */
  resize(id: PtyId, cols: number, rows: number): boolean;
  /** Kill the PTY. Teardown (fan-outs, mirror, onDispose) runs from the
   *  child's exit, so {@link exit} still resolves. No-op if gone. */
  kill(id: PtyId, signal?: NodeJS.Signals): void;
  /** Snapshot of every live PTY. */
  list(): PtyListEntry[];
  /** Membership deltas — a `created` / `exited` for EVERY PTY this host owns,
   *  including ones spawned by other clients — with the current {@link list}
   *  read in the SAME synchronous step (see {@link InventorySubscription}), so a
   *  spawn racing the subscribe arrives as a delta rather than falling in the
   *  gap between a snapshot and a subscription. */
  subscribeInventory(): Effect.Effect<
    InventorySubscription,
    never,
    Scope.Scope
  >;
  /** Host-global meaningful-output edges — every PTY's resize-excluded output
   *  bursts. A consumer subscribes ONCE and hears the whole host. */
  subscribeActivity(): Stream.Stream<PtyActivityEdge, SubscriberOverflow>;
  /** Whether this host still owns a PTY with `id` (an existence check, not a
   *  data read — distinct from `getCwd(id) !== undefined`, which happens to
   *  coincide today only because cwd is always set at spawn). */
  has(id: PtyId): boolean;
  /** Count of live PTYs — O(1) off the entry map, no list materialization.
   *  (Diagnostics samples this as the leak's independent variable.) */
  size(): number;
  /** Foreground process group leader pid, or `undefined`. */
  getForegroundPid(id: PtyId): number | undefined;
  /** Current foreground process name, or `undefined` if gone. */
  getProcess(id: PtyId): string | undefined;
  /** Last command line seen on an OSC 633;E mark, or `undefined` if none yet /
   *  gone. The synchronous read the `commandRun` source replays snapshot-first,
   *  mirroring {@link getProcess} for the `foreground` source. */
  getLastCommand(id: PtyId): string | undefined;
  /** Quoting dialect of the current {@link getLastCommand}: `true` = the
   *  command-rooted `shellJoin` seed (reparse with `shellSplit`), `false` = a raw
   *  OSC 633;E line (reparse with `string-argv`). `false` when there is no command
   *  yet. The `commandRun` snapshot carries it so a reparse is never guessed. */
  getLastCommandShellJoin(id: PtyId): boolean;
  /** Current cwd, or `undefined` if gone. */
  getCwd(id: PtyId): string | undefined;
  /** Last OSC 0/2 title (empty string if none yet), or `undefined` if
   *  gone. */
  getTitle(id: PtyId): string | undefined;
  /** Serialized screen state; empty string if gone. */
  getScreenState(id: PtyId): string;
  /** Plain text of the buffer; empty string if gone. `extent` bounds the read
   *  to one slice (range / tail / viewport); omit it for the full buffer. See
   *  {@link ScreenExtent}. */
  getScreenText(id: PtyId, extent?: ScreenExtent): string;
  /** Serialize the older-history chunk of up to `max` rows sitting immediately
   *  ABOVE absolute mirror line `before` — the backfill read the client pages as
   *  it scrolls up. An omitted `before` starts from the top of the current screen
   *  region (the self-seeding entry point a plain pager uses). See
   *  {@link PtyHistoryChunk}. Returns an empty, exhausted chunk for a gone PTY or
   *  when nothing older remains. */
  getHistory(
    id: PtyId,
    before: number | undefined,
    max: number,
    epoch?: number,
  ): PtyHistoryChunk;
  /** A per-PTY {@link PtyHandle} facade. Throws if the PTY doesn't exist. */
  handle(id: PtyId): PtyHandle;
  /** Kill every PTY this host owns. */
  dispose(): void;
}

interface Entry {
  id: PtyId;
  proc: pty.IPty;
  engine: Engine;
  scrollback: number;
  /** Memoized attach snapshot for the current publish-epoch — so a burst of
   *  attaches to one PTY between two mirror mutations (a reconnect storm against
   *  an idle terminal) shares a single serialize instead of one per attach.
   *  Read and invalidated ONLY through `snapshotOf` / `invalidateSnapshot`,
   *  which own the epoch invariant (see their definitions). */
  snapshotCache: string | undefined;
  /** Memoized BOUNDED attach snapshot (recent screenful + its seed cursor) for
   *  the current publish-epoch — the cheap paint a cold/cross-host attach gets
   *  instead of the full-mirror `snapshotCache`. Shares the same epoch invariant:
   *  read/invalidated only through `boundedSnapshotOf` / `invalidateSnapshot`. */
  boundedSnapshotCache: { snapshot: string; topLine: number } | undefined;
  /** Absolute-line coordinates over this mirror — the eviction origin (the stable
   *  coordinate `getHistory` pages by: an absolute index is `anchor.baseLine() +
   *  localBufferIndex`) and the reflow generation that stales a cursor a WIDTH
   *  resize or RIS reset renumbered (so a client whose mirror a foreign reflow
   *  moved HALTS backfill rather than splicing a duplicated/skipped band, F3).
   *  Driven from the write path (engine.reanchorIfReset detects a RIS drop)
   *  and the resize path (bumpReflow on a cols change). */
  anchor: {
    baseLine(): number;
    reflowEpoch(): number;
    bumpReflow(): void;
    reanchorIfReset(): void;
    dispose(): void;
  };
  cwd: string;
  title: string;
  lastActivity: number;
  /** Wall-clock until which output is a RESIZE repaint, not work — set by
   *  `resize()`, read by the meaningful-output edge to exclude the SIGWINCH burst. */
  resizeMuteUntil: number;
  /** Wall-clock of the last meaningful-output edge published, to throttle it (see
   *  `ACTIVITY_EDGE_THROTTLE_MS`). */
  lastActivityEdgeAt: number;
  exitCode: number | undefined;
  /** Fibers parked in {@link PtyHost.exit}. A `Set` so an interrupted waiter
   *  deregisters in O(1) — a long-lived host accumulates and sheds these one per
   *  kolu-server restart. */
  exitWaiters: Set<(code: number) => void>;
  disposables: { dispose(): void }[];
  data: FanOut<string>;
  cwdFanOut: FanOut<string>;
  titleFanOut: FanOut<string>;
  commandRunFanOut: FanOut<string>;
  /** Last command line seen on an OSC 633;E mark (`undefined` until the first),
   *  retained so the `commandRun` source can replay it snapshot-first to a late
   *  subscriber — mirroring how `foreground` replays the current process. */
  lastCommand: string | undefined;
  /** Quoting dialect of the CURRENT `lastCommand`: `true` when it is the
   *  command-rooted SEED (`shellJoin(argv)` — reparse with `shellSplit`), `false`
   *  when it is a raw OSC 633;E line (reparse with `string-argv`). A later 633
   *  mark overwrites both the value and this flag, so the retained command's
   *  dialect is always known — the `commandRun` snapshot carries it so a
   *  reconnect/late subscriber reparses correctly regardless of which wrote last. */
  lastCommandShellJoin: boolean;
  /** True when this PTY's root process IS the spawned command (no shell) — the
   *  seed source for `lastCommand` at spawn, and the fact reported on the
   *  inventory row so the sensors read `foreground === root` as busy. */
  commandRooted: boolean;
  foregroundFanOut: FanOut<ForegroundSample>;
  /** Dedup key (`process\0foregroundPid`) of the last sample published, so
   *  a steady foreground doesn't spam the channel across burst samples. */
  lastForegroundKey: string | undefined;
  /** Wall-clock of the last on-output foreground sample, to throttle it (see
   *  `FOREGROUND_SAMPLE_THROTTLE_MS`). The OSC samplers are instant and
   *  unthrottled; this only bounds the output-driven fallback. */
  lastForegroundSampleAt: number;
  /** Pending burst timers (post-command settle samples); cleared on
   *  teardown so a killed PTY schedules nothing. */
  foregroundTimers: ReturnType<typeof setTimeout>[];
  onDispose: (() => void) | undefined;
}

/** Post-command-run foreground re-sample schedule (ms). A command-run mark
 *  (OSC 633;E) fires *before* the spawned process has forked + claimed the
 *  tty, so a single sample at mark time misses it; these delays re-sample
 *  across the ~1s window in which a launched program typically becomes the
 *  foreground. This is pty-host's own settle heuristic — it owns "when does
 *  the tty's foreground change after a command". Each fresh sample is pushed
 *  on the foreground tap (dedup makes redundant ones free), so any consumer
 *  reacting to that tap sees the settled foreground without coupling to this
 *  schedule. */
const FOREGROUND_SAMPLE_DELAYS_MS = [0, 75, 300, 700, 1200] as const;

/** Min interval (ms) between OUTPUT-driven foreground samples per PTY. The OSC
 *  samplers (title / 633;E) only fire for a shell carrying kolu's rc-hooks; a
 *  bare `kaval-tui create` shell emits none, so without this its `foregroundPid`
 *  is never captured and agent detection (which keys on it) never sees the agent.
 *  A working agent streams output, so sampling on data — throttled — captures its
 *  foreground within the window while bounding the `tcgetpgrp` rate under a flood
 *  of output. Dedup (`lastForegroundKey`) makes a steady foreground free. */
const FOREGROUND_SAMPLE_THROTTLE_MS = 250;

/** After kaval resizes a PTY, the shell REPAINTS (SIGWINCH) — a genuine byte burst
 *  that is NOT work. Output within this window of a resize is excluded from the
 *  meaningful-output edge. This is the client's old `RESIZE_ACTIVITY_SUPPRESS_MS`
 *  hack, moved to the one process that actually causes the repaint (so every
 *  consumer inherits the exclusion, and the client copy is deleted). */
const RESIZE_ACTIVITY_MUTE_MS = 600;

/** Coalesce the meaningful-output edge to at most one per PTY per window — a
 *  streaming agent produces thousands of chunks/sec, but the edge only needs to
 *  say "still producing", so the wire carries ~5 tiny frames/sec instead. */
// MUST stay well below the consumer's idle window (TERMINAL_IDLE_AFTER_MS, 1000ms):
// the fold re-arms its idle timer on each edge, so a throttle >= that window would
// let a busy terminal expire between edges and flicker its live dot.
const ACTIVITY_EDGE_THROTTLE_MS = 200;

/** Whether an output chunk at `now` should publish a meaningful-output edge:
 *  NOT inside a resize-mute window (the SIGWINCH repaint is not work) AND not
 *  throttle-coalesced with the last edge. Pure so the resize-exclusion + throttle
 *  are unit-testable without a real PTY or a wall clock. */
export function shouldEmitActivityEdge(
  now: number,
  resizeMuteUntil: number,
  lastEdgeAt: number,
): boolean {
  return (
    now >= resizeMuteUntil && now - lastEdgeAt >= ACTIVITY_EDGE_THROTTLE_MS
  );
}

/** Read node-pty's foreground-pid accessor, collapsing the transient 0
 *  (before the child finishes `setsid`) to `undefined`. */
function readForegroundPid(proc: pty.IPty): number | undefined {
  // node-pty's IPty type doesn't expose this; the UnixTerminal class does
  // (juspay fork). Sampled here rather than cached so it always reflects
  // tcgetpgrp at call time.
  const pid = (proc as unknown as { foregroundPid?: number }).foregroundPid;
  return pid && pid > 0 ? pid : undefined;
}

export function createPtyHost(opts: PtyHostOptions): PtyHost {
  const { log } = opts;
  const defaultScrollback = opts.defaultScrollback ?? DEFAULT_MIRROR_SCROLLBACK;
  const dataMaxQueue = opts.dataMaxQueue;
  const generateId = opts.generateId ?? (() => randomUUID());
  const entries = new Map<PtyId, Entry>();
  // Bounded tombstone of exit codes for PTYs that have exited and been torn
  // down — lets exit() honour its "already-exited" contract with the
  // real code instead of a fabricated 0.
  const exitCodes = new Map<PtyId, number>();
  // Host-global membership feed — one fan-out for the whole host (not per-PTY,
  // like the taps), broadcasting a `created`/`exited` from the two `entries`
  // mutation sites (spawn / teardown). Eager-subscribe, so a spawn racing a
  // subscriber is captured; never closed except on dispose (host shutdown).
  const inventoryFanOut = new FanOut<PtyInventoryEvent>();
  // Host-global meaningful-output edges — every PTY's resize-excluded output bursts.
  const activityFanOut = new FanOut<PtyActivityEdge>();

  /** The entry, or the host's DECLARED "no such PTY" — never an anonymous
   *  `Error`.
   *
   *  The serving layer checks liveness once (`requirePtySync`, which raises this
   *  same class) and this function checks it again one Effect step later, so a
   *  PTY that exits in the gap surfaces HERE. A consumer recognises a healthy
   *  exit structurally, by `_tag` (padi's re-open loop is the one that matters:
   *  tag ⇒ "the PTY is gone, end cleanly"; anything else ⇒ "the chain broke,
   *  raise a failure"). An untagged `Error` therefore turned a normal exit into a
   *  spurious loud failure — the producer is the honest place to fix that, not a
   *  classify-at-the-catch downstream. */
  function requireEntry(id: PtyId): Entry {
    const entry = entries.get(id);
    if (!entry) throw new PtyNotFound({ id });
    return entry;
  }

  /** Project an {@link Entry} to its {@link PtyListEntry} row — the one mapping
   *  `list()` and the inventory `created` delta share, so a live PTY reads the
   *  same whether a consumer learns of it by snapshot or by delta. */
  function listEntryOf(entry: Entry): PtyListEntry {
    return {
      id: entry.id,
      pid: entry.proc.pid,
      cwd: entry.cwd,
      lastActivity: entry.lastActivity,
      title: entry.title,
      foregroundProcess: entry.proc.process,
      commandRooted: entry.commandRooted,
    };
  }

  /** Read `{process, foregroundPid}` at the tty. Cheap: a property read + a
   *  `tcgetpgrp` syscall — so a subscriber's snapshot takes a FRESH reading
   *  rather than replaying whatever the dedup below last let through. */
  function readForeground(entry: Entry): ForegroundSample {
    return {
      process: entry.proc.process,
      foregroundPid: readForegroundPid(entry.proc),
    };
  }

  /** Sample `{process, foregroundPid}` and publish it on the entry's foreground
   *  tap iff it changed since the last publish (dedup by a compound key). */
  function sampleForeground(entry: Entry): void {
    const sample = readForeground(entry);
    const key = `${sample.process}\u0000${sample.foregroundPid ?? ""}`;
    if (key === entry.lastForegroundKey) return;
    entry.lastForegroundKey = key;
    entry.foregroundFanOut.publishUnsafe(sample);
  }

  /** Re-sample foreground across the post-command settle window — the agent
   *  process forks *after* the OSC 633;E mark, so one sample at mark time
   *  misses it. Timers are tracked on the entry so teardown can clear pending
   *  ones; each timer removes itself after firing so the array stays bounded. */
  function scheduleForegroundBurst(entry: Entry): void {
    for (const delay of FOREGROUND_SAMPLE_DELAYS_MS) {
      let id: ReturnType<typeof setTimeout>;
      id = setTimeout(() => {
        const idx = entry.foregroundTimers.indexOf(id);
        if (idx !== -1) entry.foregroundTimers.splice(idx, 1);
        sampleForeground(entry);
      }, delay);
      entry.foregroundTimers.push(id);
    }
  }

  function teardown(entry: Entry): void {
    for (const d of entry.disposables) d.dispose();
    entry.disposables = [];
    for (const t of entry.foregroundTimers) clearTimeout(t);
    entry.foregroundTimers = [];
    entry.data.closeUnsafe();
    entry.cwdFanOut.closeUnsafe();
    entry.titleFanOut.closeUnsafe();
    entry.commandRunFanOut.closeUnsafe();
    entry.foregroundFanOut.closeUnsafe();
    entry.engine.free();
    if (entry.onDispose) {
      try {
        entry.onDispose();
      } catch (err) {
        log.error({ id: entry.id, err }, "pty-host: onDispose threw");
      }
    }
    exitCodes.set(entry.id, entry.exitCode ?? 0);
    if (exitCodes.size > MAX_EXIT_TOMBSTONES) {
      const oldest = exitCodes.keys().next().value;
      if (oldest !== undefined) exitCodes.delete(oldest);
    }
    entries.delete(entry.id);
    // Announce the membership change AFTER the delete, so a consumer reacting to
    // `exited` that re-checks `has`/`list` sees the PTY already gone.
    inventoryFanOut.publishUnsafe({ kind: "exited", id: entry.id });
  }

  function spawn(spawnOpts: PtySpawnOpts): PtySpawnResult {
    const id = spawnOpts.id ?? generateId();
    // An id names one live PTY. In particular, a kill and a same-id wake may
    // overlap while the old child is still delivering onExit; overwriting its
    // map slot would let the old teardown delete the replacement. Reject before
    // node-pty or the headless mirror has any side effects.
    if (entries.has(id)) {
      throw new Error(`pty-host: PTY ${id} already exists`);
    }
    const cols = spawnOpts.cols ?? DEFAULT_COLS;
    const rows = spawnOpts.rows ?? DEFAULT_ROWS;
    const scrollback = spawnOpts.scrollback ?? defaultScrollback;

    log.debug({ id, shell: spawnOpts.shell, cwd: spawnOpts.cwd }, "spawning");
    const proc = pty.spawn(spawnOpts.shell, spawnOpts.args ?? [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: spawnOpts.cwd,
      env: spawnOpts.env,
    });
    log.debug({ id, pid: proc.pid }, "spawned");

    // Sanity-check the node-pty fork's foregroundPid accessor — if upstream
    // changes drop it, fail loud here instead of silently breaking agent
    // detection. The accessor returns 0 momentarily before the child
    // finishes setsid, so any number (including 0) means the property
    // exists.
    if (
      typeof (proc as unknown as { foregroundPid?: unknown }).foregroundPid !==
      "number"
    ) {
      throw new Error(
        "node-pty.foregroundPid accessor missing — fork patch may have regressed",
      );
    }

    const engine = createEngine({
      cols,
      rows,
      scrollback,
      onWritePty: (bytes) => {
        const response = new TextDecoder().decode(bytes);
        if (!shouldForwardHeadlessReply(response)) return;
        proc.write(response);
      },
      onTitle: (title) => {
        const e = entries.get(id);
        if (!e) return;
        e.title = title;
        log.debug({ id, title }, "title changed (OSC 0/2)");
        e.titleFanOut.publishUnsafe(title);
        sampleForeground(e);
      },
      onPwd: (pwd) => {
        const e = entries.get(id);
        if (!e) return;
        try {
          const url = new URL(pwd);
          if (url.protocol !== "file:") return;
          e.cwd = decodeURIComponent(url.pathname);
          log.debug({ id, cwd: e.cwd }, "cwd changed (OSC 7)");
          e.cwdFanOut.publishUnsafe(e.cwd);
        } catch {
          // Ignore malformed OSC 7 data.
        }
      },
      onCommandRun: (command) => {
        const e = entries.get(id);
        if (!e) return;
        log.debug({ id, command }, "command run (OSC 633;E)");
        e.lastCommand = command;
        e.lastCommandShellJoin = false;
        e.commandRunFanOut.publishUnsafe(command);
        scheduleForegroundBurst(e);
      },
    });

    const entry: Entry = {
      id,
      proc,
      engine,
      scrollback,
      resizeMuteUntil: 0,
      lastActivityEdgeAt: 0,
      snapshotCache: undefined,
      boundedSnapshotCache: undefined,
      anchor: {
        baseLine: () => engine.baseLine(),
        reflowEpoch: () => engine.reflowEpoch(),
        bumpReflow: () => engine.bumpReflow(),
        reanchorIfReset: () => engine.reanchorIfReset(),
        dispose: () => {},
      },
      cwd: spawnOpts.cwd,
      title: "",
      lastActivity: Date.now(),
      exitCode: undefined,
      exitWaiters: new Set(),
      disposables: [],
      data: new FanOut<string>({ maxQueue: dataMaxQueue }),
      cwdFanOut: new FanOut<string>(),
      titleFanOut: new FanOut<string>(),
      commandRunFanOut: new FanOut<string>(),
      lastCommand: undefined,
      lastCommandShellJoin: false,
      commandRooted: spawnOpts.commandRooted ?? false,
      foregroundFanOut: new FanOut<ForegroundSample>(),
      lastForegroundKey: undefined,
      lastForegroundSampleAt: 0,
      foregroundTimers: [],
      onDispose: spawnOpts.onDispose,
    };
    entries.set(id, entry);

    // Lock 1 (#1872) — seed `lastCommand` from the spawn argv for a command-rooted
    // PTY. Such a PTY has the agent as `argv[0]` and no shell, so it never emits
    // the OSC 633;E mark that is `lastCommand`'s only other writer — the daemon HAS
    // the command line and must not discard it. Written on the SAME `lastCommand`
    // field + channel the 633;E handler uses (so the sync getter and the stream
    // never disagree), and it is only a SEED — a later live 633;E mark (if a shell
    // ever runs inside) is the temporal last-writer and overwrites it. `shellJoin`
    // (the repo's POSIX-quote source of truth, the same helper kaval-tui/padi-tui
    // rebuild a command line with), NOT a bare `join(" ")`, so a stable flag whose
    // value carries spaces (`--settings '{"x": 1}'`) survives `parseAgentCommand`'s
    // tokenizer instead of word-splitting. (We deliberately do NOT seed the title:
    // the title tap is live-only — no snapshot-first replay — so a seeded title is
    // erased by the foreground sensor's first sample; the tile carries the agent's
    // foreground process name instead, and the Dock reads state from the command.)
    if (entry.commandRooted) {
      const command = shellJoin([spawnOpts.shell, ...(spawnOpts.args ?? [])]);
      entry.lastCommand = command;
      entry.lastCommandShellJoin = true;
      entry.commandRunFanOut.publishUnsafe(command);
    }

    entry.disposables.push({ dispose: () => entry.anchor.dispose() });

    // PTY data → libghostty-vt mirror → fan-out. Write is synchronous, so
    // "published" means "parsed into the mirror" — attach()'s
    // subscribe()+serialize() pair still partitions the byte stream at a
    // single point with no gap and no overlap.
    entry.disposables.push(
      proc.onData((data: string) => {
        const now = Date.now();
        entry.lastActivity = now;
        if (
          shouldEmitActivityEdge(
            now,
            entry.resizeMuteUntil,
            entry.lastActivityEdgeAt,
          )
        ) {
          entry.lastActivityEdgeAt = now;
          activityFanOut.publishUnsafe({ id });
        }
        if (
          now - entry.lastForegroundSampleAt >=
          FOREGROUND_SAMPLE_THROTTLE_MS
        ) {
          entry.lastForegroundSampleAt = now;
          sampleForeground(entry);
        }
        answerDeviceQueries(data, (s) => proc.write(s));
        entry.engine.write(data);
        const title = entry.engine.getTitle();
        if (title !== "" && title !== entry.title) {
          entry.title = title;
          log.debug({ id, title }, "title changed (OSC 0/2)");
          entry.titleFanOut.publishUnsafe(title);
          sampleForeground(entry);
        }
        const pwd = entry.engine.getPwd();
        if (pwd !== "") {
          try {
            const url = new URL(pwd);
            if (url.protocol === "file:") {
              const next = decodeURIComponent(url.pathname);
              if (next !== entry.cwd) {
                entry.cwd = next;
                log.debug({ id, cwd: entry.cwd }, "cwd changed (OSC 7)");
                entry.cwdFanOut.publishUnsafe(entry.cwd);
              }
            }
          } catch {
            // Ignore malformed OSC 7 data.
          }
        }
        invalidateSnapshot(entry);
        entry.anchor.reanchorIfReset();
        entry.data.publishUnsafe(data);
      }),
    );

    entry.disposables.push(
      proc.onExit(({ exitCode }) => {
        log.debug({ id, exitCode }, "exited");
        entry.exitCode = exitCode;
        const waiters = [...entry.exitWaiters];
        entry.exitWaiters.clear();
        for (const resolve of waiters) resolve(exitCode);
        teardown(entry);
      }),
    );

    // The PTY is fully wired and in `entries` — announce it on the membership
    // feed so a consumer that reacts to `created` and immediately attaches /
    // lists finds a live, fully-tapped entry. Published last, so the snapshot a
    // racing inventory subscriber takes is consistent with this delta.
    inventoryFanOut.publishUnsafe({
      kind: "created",
      entry: listEntryOf(entry),
    });

    return { id, pid: proc.pid };
  }

  // The serialized mirror snapshot for the current publish-epoch is a single
  // domain concept with one production site and one invalidation seam, so its
  // memo can't desync across the consumers that read it or the mutators that
  // dirty it. `snapshotOf` is the only place the mirror is serialized;
  // `invalidateSnapshot` is the only place the memo is dropped, called from
  // EVERY mutator of the serialized state (the data-publish path and resize()).
  function snapshotOf(entry: Entry): string {
    entry.snapshotCache ??= entry.engine.formatVt();
    return entry.snapshotCache;
  }
  function visualLines(entry: Entry): string[] {
    const all = entry.engine.formatPlain().split("\n");
    const keep = entry.scrollback + entry.engine.rows;
    return all.length <= keep ? all : all.slice(all.length - keep);
  }

  function droppedCount(entry: Entry): number {
    const all = entry.engine.formatPlain().split("\n").length;
    const keep = entry.scrollback + entry.engine.rows;
    return Math.max(0, all - keep);
  }

  function snapshotStartLocal(entry: Entry): number {
    const len = Math.max(1, visualLines(entry).length);
    return Math.max(0, len - SNAPSHOT_SCROLLBACK - entry.engine.rows);
  }
  function boundedSnapshotOf(entry: Entry): {
    snapshot: string;
    topLine: number;
  } {
    entry.boundedSnapshotCache ??= (() => {
      const start = snapshotStartLocal(entry);
      return {
        topLine: entry.anchor.baseLine() + droppedCount(entry) + start,
        snapshot: entry.engine.formatRecentVt(SNAPSHOT_SCROLLBACK),
      };
    })();
    return entry.boundedSnapshotCache;
  }
  function invalidateSnapshot(entry: Entry): void {
    entry.snapshotCache = undefined;
    entry.boundedSnapshotCache = undefined;
  }

  function attach(
    id: PtyId,
    opts?: PtyAttachOpts,
  ): Effect.Effect<PtyAttachment, never, Scope.Scope> {
    const { resizeTo } = opts ?? {};
    // An attach on a fiber that is ALREADY interrupted — the re-issued half of a
    // reconnect storm, whose client has gone — does NOTHING, because an
    // interrupted fiber never runs this effect at all. That includes the resize:
    // `resizeTo` mutates the SHARED PTY (it SIGWINCHes the child, reflows the
    // mirror every other client reads, and on a width change bumps the reflow
    // epoch that stales their backfill cursors), and a subscriber that will never
    // read a byte must not inflict that on everyone else. Under the AbortSignal
    // face this needed an explicit already-aborted fast path in front of the
    // write; under interruption it is structural.
    return Effect.suspend(() => {
      const entry = requireEntry(id);
      // Size the PTY to the consumer's grid BEFORE serializing, so the snapshot is
      // bytes laid out for the grid that will paint them. This is the whole point
      // of carrying the grid on the attach: the resize and the serialize become
      // ONE act, and "a snapshot for a size the consumer isn't" stops being a
      // reachable state. Doing it through `resize()` — not a private path — keeps
      // the single mutator: same-dimensions stays a no-op (so a second viewer at
      // the same size costs nothing and staleness the reflow epoch guards is not
      // spuriously bumped), and a genuine change reflows the mirror, invalidates
      // the snapshot memo, and SIGWINCHes the process exactly as a user resize
      // does — which is what makes the process repaint into the new grid. This is
      // the WRITE the `resizeTo` name advertises: it is visible to every other
      // client attached to this PTY, not private to this attachment.
      if (resizeTo) resize(id, resizeTo.cols, resizeTo.rows);
      // Subscribe and serialize in ONE synchronous step (`subscribeWith` — the
      // two halves are not separately spellable): no headless parse, and thus no
      // post-parse publish, can interleave between them, so every chunk lands in
      // exactly one of snapshot / deltas.
      //
      // The serialize coalesces within the publish-epoch: the first attach
      // serializes and memoizes via boundedSnapshotOf(); the rest of a burst reuse
      // the identical immutable string. Race-free — the memo is set through
      // boundedSnapshotOf() and cleared through invalidateSnapshot() in every
      // mirror mutator, all synchronous, and publish only fires from a later task;
      // so a present cache means the mirror is unchanged since it was taken, and
      // every reusing attacher's deltas begin at the next publish, exactly where
      // the shared snapshot ends. No gap, no overlap. `topLine` rides with the
      // snapshot from the same serialize, so the backfill seed can never drift
      // from the bytes the client received.
      return Effect.map(
        entry.data.subscribeWith(() => ({
          ...boundedSnapshotOf(entry),
          reflowEpoch: entry.anchor.reflowEpoch(),
        })),
        ({ stream, reading }): PtyAttachment => ({
          snapshot: reading.snapshot,
          topLine: reading.topLine,
          reflowEpoch: reading.reflowEpoch,
          deltas: stream,
        }),
      );
    });
  }

  function exit(id: PtyId): Effect.Effect<number, PtyNotFound> {
    return Effect.suspend(() => {
      const entry = entries.get(id);
      if (entry) {
        if (entry.exitCode !== undefined) return Effect.succeed(entry.exitCode);
        return Effect.callback<number>((resume) => {
          const waiter = (code: number): void => resume(Effect.succeed(code));
          entry.exitWaiters.add(waiter);
          // Interrupting the waiting fiber deregisters the waiter — a long-lived
          // host must not retain one per abandoned subscription.
          return Effect.sync(() => {
            entry.exitWaiters.delete(waiter);
          });
        });
      }
      const cached = exitCodes.get(id);
      if (cached !== undefined) return Effect.succeed(cached);
      // Unknown id — never spawned, or exited long enough ago to be evicted from
      // the tombstone. The host does not KNOW this PTY's exit code, and the one
      // answer it must never give is `0`: a fabricated SUCCESS that a consumer
      // reports to the user as "the command finished fine". So it fails with the
      // host's declared "no such PTY" and the caller decides — `terminate` reads
      // it as "already gone, nothing to wait for", the `exit` stream member as a
      // defect (see `inProcessPtyHost`).
      return Effect.fail(new PtyNotFound({ id }));
    });
  }

  function getForegroundPid(id: PtyId): number | undefined {
    const entry = entries.get(id);
    return entry ? readForegroundPid(entry.proc) : undefined;
  }

  function getScreenState(id: PtyId): string {
    const entry = entries.get(id);
    // Read through the same memo as attach(): "the current-epoch snapshot" is
    // one serialized value, computed once and shared by both consumers, not a
    // second uncached serialize of the identical mirror.
    return entry ? snapshotOf(entry) : "";
  }

  function getScreenTextFor(id: PtyId, extent?: ScreenExtent): string {
    const entry = entries.get(id);
    if (!entry) return "";
    const bound: ScreenExtent = extent ?? { kind: "full" };
    if (bound.kind === "full") {
      const cap = entry.scrollback + entry.engine.rows;
      return entry.engine.getScreenText({ kind: "tail", lines: cap });
    }
    return entry.engine.getScreenText(bound);
  }

  function getHistory(
    id: PtyId,
    before: number | undefined,
    max: number,
    epoch?: number,
  ): PtyHistoryChunk {
    // `max` is a positive row count — a non-positive request is a caller bug
    // (the wire schema rejects it too), so the primitive fails LOUD rather than
    // silently returning an empty, exhausted page that a caller reads as "no
    // more history".
    if (!Number.isInteger(max) || max <= 0)
      throw new RangeError(
        `getHistory: max must be a positive integer, got ${max}`,
      );
    const entry = entries.get(id);
    if (!entry)
      return {
        kind: "chunk",
        chunk: "",
        topLine: before ?? 0,
        exhausted: true,
      };
    // Reflow guard (F3): a caller that stamped the generation its `before` cursor
    // was seeded under is served NOTHING once a width reflow has since renumbered
    // absolute rows — its cursor names a row the rewrap moved, so paging from it
    // would splice a duplicated/skipped band. `stale` tells it to HALT until a
    // fresh snapshot re-seeds. A caller with no epoch (older client / pager) is
    // fail-open: it pages as before, accepting the historical single-width scope.
    if (epoch !== undefined && epoch !== entry.anchor.reflowEpoch())
      return { kind: "stale" };
    const dropped = droppedCount(entry);
    const length = Math.max(1, visualLines(entry).length);
    const origin = entry.anchor.baseLine() + dropped;
    const cursor = before ?? origin + Math.max(0, length - entry.engine.rows);
    const localEnd = Math.min(cursor - origin - 1, length - 1);
    if (localEnd < 0)
      return { kind: "chunk", chunk: "", topLine: cursor, exhausted: true };
    const start = Math.max(0, localEnd - max + 1);
    const chunk = entry.engine.formatRangeVt(
      dropped + start,
      dropped + localEnd,
    );
    return {
      kind: "chunk",
      chunk,
      topLine: origin + start,
      exhausted: start === 0,
    };
  }

  function write(id: PtyId, data: string): void {
    entries.get(id)?.proc.write(data);
  }

  function resize(id: PtyId, cols: number, rows: number): boolean {
    const entry = entries.get(id);
    // The ONE false: no such PTY. Reported rather than swallowed so the caller
    // can tell "the grid landed" from "there was nothing to land it on".
    if (!entry) return false;
    const prevCols = entry.engine.cols;
    const prevRows = entry.engine.rows;
    // An EXACT same-dims resize renumbers and reflows nothing — a second viewer
    // attaching at the same size, or the mount-time re-publish of the current
    // dims, would otherwise spuriously stale every attached client's cursor
    // (there is no dedupe upstream). Skip it wholesale — but report TRUE: the
    // entry exists and is already at the requested grid, which is exactly the
    // caller's claim satisfied.
    if (cols === prevCols && rows === prevRows) return true;
    // Open the resize-mute window BEFORE the resize: the SIGWINCH repaint this
    // triggers is a genuine byte burst that must NOT count as meaningful output
    // (the reveal/resize "un-finish" regression, killed at the source).
    entry.resizeMuteUntil = Date.now() + RESIZE_ACTIVITY_MUTE_MS;
    entry.proc.resize(cols, rows);
    entry.engine.resize(cols, rows);
    // resize() reflows the mirror (reflowCursorLine rewraps lines on a width
    // change), so the serialized layout changes with NO data publish to clear
    // the memo — invalidate here too, or a same-epoch attach after a resize
    // hands back the stale pre-resize snapshot.
    invalidateSnapshot(entry);
    // Only a WIDTH change rewraps and RENUMBERS absolute rows; bump the
    // generation just for that so a pre-resize `topLine` cursor is served a
    // `stale` getHistory (F3). A HEIGHT-only change moves the viewport but not
    // top-anchored absolute indices (eviction is already counted via `onTrim`),
    // so bumping there would falsely stale cursors the client deliberately keeps
    // (its own onResize pauses on a cols change only). Bumped AFTER the rewrap so
    // a getHistory racing this resize reads the new value.
    if (cols !== prevCols) entry.anchor.bumpReflow();
    return true;
  }

  function handle(id: PtyId): PtyHandle {
    const entry = requireEntry(id);
    const pid = entry.proc.pid;
    const spawnCwd = entry.cwd;
    return {
      pid,
      get cwd() {
        return entries.get(id)?.cwd ?? spawnCwd;
      },
      get process() {
        return entries.get(id)?.proc.process ?? "";
      },
      get foregroundPid() {
        return getForegroundPid(id);
      },
      write: (data) => write(id, data),
      resize: (cols, rows) => resize(id, cols, rows),
      getScreenState: () => getScreenState(id),
      getScreenText: (extent) => getScreenTextFor(id, extent),
    };
  }

  return {
    spawn,
    attach,
    subscribeCwd: (id) =>
      Stream.suspend(() => requireEntry(id).cwdFanOut.stream),
    subscribeTitle: (id) =>
      Stream.suspend(() => requireEntry(id).titleFanOut.stream),
    // The retention is read in the SAME step as the registration, so the mark
    // that a late subscriber replays and the marks it then hears live partition
    // the feed exactly once.
    subscribeCommandRun: (id) =>
      Effect.suspend(() => {
        const entry = requireEntry(id);
        return Effect.map(
          entry.commandRunFanOut.subscribeWith(() =>
            entry.lastCommand === undefined
              ? undefined
              : {
                  command: entry.lastCommand,
                  shellJoin: entry.lastCommandShellJoin,
                },
          ),
          ({ stream, reading }): CommandRunSubscription => ({
            retained: reading,
            marks: stream,
          }),
        );
      }),
    subscribeForeground: (id) =>
      Effect.suspend(() => {
        const entry = requireEntry(id);
        return Effect.map(
          entry.foregroundFanOut.subscribeWith(() => readForeground(entry)),
          ({ stream, reading }): ForegroundSubscription => ({
            current: reading,
            samples: stream,
          }),
        );
      }),
    exit,
    write,
    resize,
    kill: (id, signal) => entries.get(id)?.proc.kill(signal),
    list: () => [...entries.values()].map(listEntryOf),
    subscribeInventory: () =>
      Effect.map(
        inventoryFanOut.subscribeWith(() =>
          [...entries.values()].map(listEntryOf),
        ),
        ({ stream, reading }): InventorySubscription => ({
          entries: reading,
          deltas: stream,
        }),
      ),
    subscribeActivity: () => activityFanOut.stream,
    has: (id) => entries.has(id),
    size: () => entries.size,
    getForegroundPid,
    getProcess: (id) => entries.get(id)?.proc.process,
    getLastCommand: (id) => entries.get(id)?.lastCommand,
    getLastCommandShellJoin: (id) =>
      entries.get(id)?.lastCommandShellJoin ?? false,
    getCwd: (id) => entries.get(id)?.cwd,
    getTitle: (id) => entries.get(id)?.title,
    getScreenState,
    getScreenText: getScreenTextFor,
    getHistory,
    handle,
    dispose: () => {
      // Host shutdown is a REAP, not a hangup: SIGKILL, the same choice (for
      // the same reason) as the `kill` RPC's terminate — node-pty's default
      // SIGHUP is only advisory. A leader that ignores/traps SIGHUP survives
      // it, and so does darwin's `spawn-helper` launcher in its pre-exec
      // window (it acquires the controlling tty only inside its own slave
      // `open()`, so until then no hangup — from this kill or from the master
      // closing — reaches it). Each leader also sits in its OWN session
      // (setsid), where the daemon dying can never take it along. The aged
      // ppid-1 `spawn-helper <cwd> /bin/sh` orphans found on rasam are what
      // the advisory path leaks; a host going away must leave no child to
      // init.
      for (const entry of [...entries.values()]) entry.proc.kill("SIGKILL");
      // Host shutdown — end every inventory subscription gracefully. The async
      // `onExit` → teardown `exited` publishes from the kills above land on a
      // closed channel (a no-op), which is fine: the host is going away.
      inventoryFanOut.closeUnsafe();
      activityFanOut.closeUnsafe();
    },
  };
}
