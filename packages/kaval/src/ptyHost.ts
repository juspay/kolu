import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { shellJoin } from "@kolu/shell-quote";
import { shouldForwardHeadlessReply } from "@kolu/terminal-protocol";
import type { Logger } from "@kolu/surface-daemon";
import {
  createMirrorAnchor,
  type MirrorAnchor,
  snapToWrapHead,
} from "@kolu/xterm-kit";
import { Effect, type Scope, Stream } from "effect";
import { readGrid, type SnapshotGrid } from "terminal-snapshot";
import * as pty from "node-pty";
import { FanOut, type SubscriberDropped } from "./fanOut.ts";
import { createRepaintWindow, type RepaintWindow } from "./repaintWindow.ts";
import {
  boundScreenCells,
  type PtyGrid,
  PtyNotFound,
} from "./ptyHostSurface.ts";

declare module "node-pty" {
  interface IPty {
    readonly foregroundPid?: number;
  }
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/** The per-live-terminal headless-mirror depth, in lines — the SINGLE source of
 *  truth for "how deep a mirror kaval keeps per terminal". It is the number
 *  every spawn path lands on when it doesn't override scrollback, AND the value
 *  the server's `composeSpawnInput` imports and sends explicitly. */
export const DEFAULT_MIRROR_SCROLLBACK = 10_000;
/** How many scrollback lines the ATTACH snapshot serializes — the recent
 *  screenful a cold/cross-host attach paints instantly, instead of the whole
 *  {@link DEFAULT_MIRROR_SCROLLBACK}-deep mirror. Older lines are streamed in
 *  on demand by {@link PtyHost.getHistory} as the client scrolls up, so this
 *  bound sets the up-front paint cost, not the reachable history. The client
 *  seeds its backfill cursor from what it actually received, so the exact value
 *  is a perf knob, not a correctness one. */
export const SNAPSHOT_SCROLLBACK = 1_000;
const MAX_EXIT_TOMBSTONES = 1024;

const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

export const HEADLESS_TERM_ID = "xterm-headless(kolu)";

/** Opaque PTY identifier. */
export type PtyId = string;

export function readBufferRange(
  buffer: {
    length: number;
    getLine(
      i: number,
    ): { translateToString(trimRight: boolean): string } | undefined;
  },
  range: { start: number; end: number },
): string {
  const end = Math.min(buffer.length, range.end);
  const start = Math.max(0, range.start);
  const lines: string[] = [];
  for (let i = start; i < end; i++) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

/** Resolve a {@link ScreenExtent} to the absolute half-open line range
 *  `[start, end)` it names, clamped to what the buffer actually holds. */
export function resolveScreenExtent(
  bufferLength: number,
  rows: number,
  extent: ScreenExtent = { kind: "full" },
): { start: number; end: number } {
  switch (extent.kind) {
    case "full":
      return { start: 0, end: bufferLength };
    case "range": {
      const end = Math.min(bufferLength, extent.endLine ?? bufferLength);
      return { start: Math.max(0, extent.startLine ?? 0), end };
    }
    case "tail":
      return {
        start: Math.max(0, bufferLength - Math.max(0, extent.lines)),
        end: bufferLength,
      };
    case "viewport":
      return {
        start: Math.max(0, bufferLength - Math.max(0, rows)),
        end: bufferLength,
      };
  }
}

/** Which slice of the rendered buffer a screen-text read returns — the single
 *  bound axis as a closed set of mutually-exclusive variants, so an illegal
 *  combination is unrepresentable rather than resolved by a silent precedence.
 *  `viewport` is "the visible screen", resolved host-side to a tail of the live
 *  grid's own `rows` (a caller can't know it). Absent extent ⇒ the full
 *  buffer. */
export type ScreenExtent =
  | { kind: "full" }
  | { kind: "range"; startLine?: number; endLine?: number }
  | { kind: "tail"; lines: number }
  | { kind: "viewport" };

/**
 * Per-PTY control + introspection surface vended by {@link PtyHost.handle}.
 * Deliberately omits `dispose()` — termination flows through
 * {@link PtyHost.kill}.
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
  /** True when `shell` is not a shell but the ROOT COMMAND itself — a PTY with
   *  the command as `argv[0]` and no shell wrapping it. The host seeds the
   *  retained command from the argv (such a PTY never emits the OSC 633;E mark
   *  that is otherwise `lastCommand`'s only writer) and reports the fact on the
   *  inventory row. Absent/false = shell-rooted. */
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

/** One item on a PTY's data feed: bytes the mirror parsed, or the mirror
 *  CHANGING SIZE — two kinds in ONE ordered channel, because the order between
 *  them is the fact being published: a separate channel would let a resize race
 *  the bytes around it. `resized` is a CONTROL item: it carries no bytes, is
 *  never withheld by the resize window, and costs nothing against the byte
 *  budget (see {@link dataItemChars}). */
export type PtyDataItem =
  | { kind: "bytes"; data: string }
  | { kind: "resized"; grid: PtyGrid };

/** The byte cost of one data item — the fan-out's budget unit. A `resized` is
 *  free: a consumer that is behind needs the new size MORE than it needs to be
 *  dropped for having been told it. */
export function dataItemChars(item: PtyDataItem): number {
  return item.kind === "bytes" ? item.data.length : 0;
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
   *  the client received. 0 for a brand-new/empty PTY. */
  topLine: number;
  /** Reflow generation the snapshot (and its `topLine`) was serialized under —
   *  the client stamps it on every `getHistory` so a subsequent width reflow
   *  makes the stale absolute cursor a no-splice `stale` reply rather than a
   *  duplicated/skipped band. */
  reflowEpoch: number;
  /** The grid this snapshot was SERIALIZED at, carried WITH the bytes it
   *  describes so it cannot drift from them. It is how an OBSERVE-ONLY attach
   *  (one that passes no `resizeTo`) learns what size it got. */
  grid: PtyGrid;
  /** Live output after the snapshot — bytes AND the mirror's own resizes, in
   *  the one order they happened ({@link PtyDataItem}). Ends when the
   *  attachment's scope closes (unsubscribing IS interrupting the consuming
   *  fiber) or the PTY exits, and FAILS with {@link SubscriberDropped} when
   *  this attachment lagged past the bound — so the serving layer tells a
   *  slow-consumer drop apart from a graceful end by the channel it arrives on,
   *  not by a flag. */
  deltas: Stream.Stream<PtyDataItem, SubscriberDropped>;
}

/** One older-history chunk from {@link PtyHost.getHistory}: a serialized slice
 *  of the mirror's scrollback the client replays and prepends into its own
 *  buffer as the user scrolls up.
 *
 *  The cursor is an ABSOLUTE mirror-line index — the count of lines ever evicted
 *  off the top of the mirror plus a line's current local buffer index, so it
 *  keeps naming the same line as newer output pushes older lines out:
 *  a `getHistory(before)` returns the `max` lines immediately ABOVE `before`.
 *  Absolute addressing is what makes the seam race-free: new output always
 *  appends at the mirror BOTTOM, never shifting the index of a line the client
 *  already holds, so a served chunk can neither duplicate nor skip a row. */
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
       *  backfill until a fresh snapshot re-seeds. Only reachable when the
       *  caller sends an epoch; an epoch-less caller is fail-open and never sees
       *  this. */
      kind: "stale";
    };

/** One foreground sample: the node-pty `process` name and the pty's
 *  foreground process-group pid (`tcgetpgrp(3)`). Both are read *at the tty*,
 *  so only the PTY's owner can produce them — across a socket they cannot be a
 *  sync getter, so {@link PtyHost.subscribeForeground} pushes them as a tap. */
export interface ForegroundSample {
  process: string;
  foregroundPid: number | undefined;
}

/** A change to the set of live PTYs the host owns — the host-global membership
 *  feed. Unlike the per-PTY taps, which a consumer can only subscribe to once
 *  it already KNOWS the id, this announces ids as they appear and vanish, so a
 *  consumer learns about PTYs OTHER clients spawned without polling
 *  {@link PtyHost.list}. The primitive emits only these deltas; the serving
 *  layer prepends a `list` snapshot (snapshot-then-deltas). */
export type PtyInventoryEvent =
  | { kind: "created"; entry: PtyListEntry }
  | { kind: "exited"; id: PtyId };

/** A MEANINGFUL-OUTPUT edge — this PTY just produced real output, NOT a
 *  resize-driven repaint. Host-global (a consumer subscribes once and hears
 *  every PTY), momentary (no snapshot): a consumer stamps ARRIVAL time on its
 *  OWN clock and derives its own idle windows, so a missed edge across a
 *  reconnect only DELAYS a downstream finish. */
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
  /** True when the PTY's root process IS the spawned command, not a shell. The
   *  workspace sensors read this to decide whether `foreground === root` means
   *  an idle shell prompt (a shell root) or a busy agent (a command root).
   *  Absent/false on the wire = a shell-rooted PTY. */
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
   *  Defaults to the {@link FanOut} default (10,000). */
  dataMaxQueue?: number;
}

export type { PtyGrid };

/** The optional half of an {@link PtyHost.attach} — a bag rather than a trailing
 *  positional, so the write it carries is named at every call site. */
export interface PtyAttachOpts {
  /** RESIZES the PTY to this grid before serializing — a real `resize()`:
   *  SIGWINCH to the child, a reflow of the SHARED mirror, snapshot-memo
   *  invalidation, an activity mute, and (on a width change) a reflow-epoch bump
   *  that stales EVERY OTHER attached client's backfill cursor. Attaching is
   *  therefore a WRITE to shared state whenever this is present and differs from
   *  the PTY's current grid; the policy is last-attach-wins. Omit it only when
   *  the caller has no grid of its own, which reads the PTY at its current
   *  size. */
  resizeTo?: PtyGrid;
}

/** {@link PtyHost.subscribeCommandRun}'s two halves, taken in ONE synchronous
 *  step so a mark published between them can neither be lost nor delivered
 *  twice. */
export interface CommandRunSubscription {
  /** The command retained at subscribe time, or `undefined` before the first
   *  mark. A consumer replays it as its snapshot frame. SENSOR DATA, never a
   *  command kolu replays: the only readers take its head basename. */
  readonly retained: string | undefined;
  /** Live OSC 633;E marks published AFTER the reading. */
  readonly marks: Stream.Stream<string, SubscriberDropped>;
}

/** {@link PtyHost.subscribeForeground}'s two halves, taken in ONE synchronous
 *  step. */
export interface ForegroundSubscription {
  /** The foreground reading at subscribe time — a fresh `tcgetpgrp` sample, not
   *  a cached one, so a freshly-wired consumer warms its cache immediately. */
  readonly current: ForegroundSample;
  /** Live samples published AFTER the reading. */
  readonly samples: Stream.Stream<ForegroundSample, SubscriberDropped>;
}

/** {@link PtyHost.subscribeInventory}'s two halves, taken in ONE synchronous
 *  step — which is what makes a spawn racing the subscribe arrive as a delta
 *  instead of falling into a gap. */
export interface InventorySubscription {
  /** Every PTY live at subscribe time. */
  readonly entries: PtyListEntry[];
  /** Membership deltas published AFTER the reading. A `created` also present in
   *  `entries` is impossible; a consumer's adoption is idempotent regardless. */
  readonly deltas: Stream.Stream<PtyInventoryEvent, SubscriberDropped>;
}

/** The multi-client PTY-owner primitive. */
export interface PtyHost {
  /** Spawn a PTY; returns its id + pid immediately. */
  spawn(opts: PtySpawnOpts): PtySpawnResult;
  /** **Resizes the PTY to `opts.resizeTo` first** (a real `resize()` — see
   *  {@link PtyAttachOpts.resizeTo}, which mutates state every other attached
   *  client can see), then subscribe-before-serialize: a race-free snapshot +
   *  delta stream for a late-joining client, the two taken in ONE synchronous
   *  step.
   *
   *  Scoped: the delta subscription is released when the caller's `Scope` closes
   *  — for a served member, when the consuming fiber is interrupted. An attach
   *  issued on an ALREADY interrupted fiber never runs at all. */
  attach(
    id: PtyId,
    opts?: PtyAttachOpts,
  ): Effect.Effect<PtyAttachment, never, Scope.Scope>;
  /** Per-PTY cwd update stream (OSC 7). */
  subscribeCwd(id: PtyId): Stream.Stream<string, SubscriberDropped>;
  /** Per-PTY title update stream (OSC 0/2). */
  subscribeTitle(id: PtyId): Stream.Stream<string, SubscriberDropped>;
  /** Per-PTY preexec command marks (OSC 633 ; E payloads), with the RETAINED
   *  command read in the same synchronous step (see
   *  {@link CommandRunSubscription}) so a late subscriber learns the command
   *  that was already marked without a mark in between going missing or
   *  double. */
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
   *  waiting fiber deregisters the waiter.
   *
   *  FAILS with {@link PtyNotFound} for an id this host has no entry and no
   *  tombstone for — never spawned, or exited far enough back to be evicted past
   *  {@link MAX_EXIT_TOMBSTONES}. */
  exit(id: PtyId): Effect.Effect<number, PtyNotFound>;
  /** Write input (keystrokes, pasted text). No-op if the PTY is gone. */
  write(id: PtyId, data: string): void;
  /** Resize the PTY grid + the headless mirror. Returns TRUE when the entry
   *  existed and the grid now holds — whether that took a real resize or was an
   *  exact same-dimensions no-op — and FALSE when there is no such PTY (already
   *  exited or never spawned). */
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
  subscribeActivity(): Stream.Stream<PtyActivityEdge, SubscriberDropped>;
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
  /** Attributed cells for the screen slice a picture is drawn from — the same
   *  slice {@link getScreenText} returns, as characters plus the colours and
   *  bold/italic/inverse the VT stream asked for. `undefined` if the PTY is
   *  gone: a gone terminal has no screen, it does not have a blank one. Omit
   *  `extent` for the viewport, which is what a screenshot means.
   *
   *  Deliberately stops at "what the escape sequences said" and does not
   *  resolve a colour to a pixel: a palette index becomes a theme colour only
   *  once someone knows WHICH theme, and this mirror doesn't. */
  getScreenCells(id: PtyId, extent?: ScreenExtent): SnapshotGrid | undefined;
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
  headless: InstanceType<typeof Terminal>;
  serialize: InstanceType<typeof SerializeAddon>;
  snapshotCache: string | undefined;
  boundedSnapshotCache: { snapshot: string; topLine: number } | undefined;
  anchor: MirrorAnchor;
  cwd: string;
  title: string;
  lastActivity: number;
  lastBoundedSnapshotChars: number;
  repaint: RepaintWindow;
  lastActivityEdgeAt: number;
  exitCode: number | undefined;
  exitWaiters: Set<(code: number) => void>;
  disposables: { dispose(): void }[];
  data: FanOut<PtyDataItem>;
  cwdFanOut: FanOut<string>;
  titleFanOut: FanOut<string>;
  commandRunFanOut: FanOut<string>;
  lastCommand: string | undefined;
  commandRooted: boolean;
  foregroundFanOut: FanOut<ForegroundSample>;
  lastForegroundKey: string | undefined;
  lastForegroundSampleAt: number;
  foregroundTimers: ReturnType<typeof setTimeout>[];
  onDispose: (() => void) | undefined;
}

const FOREGROUND_SAMPLE_DELAYS_MS = [0, 75, 300, 700, 1200] as const;

const FOREGROUND_SAMPLE_THROTTLE_MS = 250;

const RESIZE_WINDOW_MS = 600;

export const MIN_DATA_BUDGET_CHARS = 128 * 1024;

const ACTIVITY_EDGE_THROTTLE_MS = 200;

export function shouldEmitActivityEdge(
  now: number,
  inResizeWindow: boolean,
  lastEdgeAt: number,
): boolean {
  return !inResizeWindow && now - lastEdgeAt >= ACTIVITY_EDGE_THROTTLE_MS;
}

/** A dynamic loader's basename — glibc's `ld-linux*.so*`, musl's
 *  `ld-musl-*.so*`, or the bare `ld.so`. Such a process is a loader running a
 *  real program given as its first non-option argument, which is what a nixpkgs
 *  `makeCWrapper` package execs. */
const LOADER_BASENAME = /^(?:ld-(?:linux|musl)[^/]*\.so(?:\.[^/]*)?|ld\.so)$/;

/** The loader options that consume a FOLLOWING argument (`ld.so --help` lists
 *  them). Everything else on a loader's command line is either a bare flag
 *  (`--inhibit-cache`, `--list`, `--verify`, …) or the program to run. */
const LOADER_VALUE_OPTIONS = new Set([
  "--argv0",
  "--library-path",
  "--preload",
  "--audit",
  "--glibc-hwcaps-prepend",
  "--glibc-hwcaps-mask",
  "--inhibit-rpath",
]);

function lastSegment(p: string): string {
  const i = p.lastIndexOf("/");
  return i === -1 ? p : p.slice(i + 1);
}

/** Whether `name` (a basename, or a path whose last segment is one) names a
 *  dynamic loader. See {@link LOADER_BASENAME}.
 *
 *  `undefined` is a REAL input: node-pty's `process` returns `undefined` on
 *  darwin whenever its `pty_getproc` cannot name the foreground process group
 *  — `tcgetpgrp(3)` is -1 in the window before the child claims the tty, and
 *  `p_comm` is empty during an `exec` — where linux's `|| this._file` always
 *  yields a string. An absent name is not a loader. */
export function isDynamicLoader(name: string | undefined): boolean {
  return name !== undefined && LOADER_BASENAME.test(lastSegment(name));
}

/** The program a dynamic-loader `argv` will run, or `undefined`.
 *
 *  `undefined` when `argv[0]` is not a loader, or when the loader was invoked
 *  with no program at all (`--list`, `--help`, `--verify`). The first
 *  non-option argument is returned whole. */
export function foregroundNameFromArgv(
  argv: readonly string[],
): string | undefined {
  const argv0 = argv[0];
  if (argv0 === undefined || !isDynamicLoader(argv0)) return undefined;
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (!arg.startsWith("--")) return arg;
    if (LOADER_VALUE_OPTIONS.has(arg)) i++;
  }
  return undefined;
}

/** `/proc/<pid>/cmdline` split into argv (NUL-separated, trailing empty
 *  dropped), or `undefined` when the read fails — the process is already gone,
 *  or `/proc` is hidden. Linux-only: on Darwin node-pty reports `p_comm`, so
 *  the loader case cannot arise and there is nothing to resolve. */
export function readProcCmdline(pid: number): readonly string[] | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
    if (argv[argv.length - 1] === "") argv.pop();
    return argv;
  } catch {
    return undefined;
  }
}

/** The PTY's foreground process name, NORMALIZED for a loader-wrapped command.
 *  node-pty reports the foreground's `argv[0]` basename, which for a
 *  nixpkgs-wrapped binary is the glibc/musl loader rather than the program it
 *  loads; when the reported name IS a loader, resolve the real program from the
 *  foreground process's own `/proc/<pid>/cmdline`, and on any failure keep the
 *  loader name — it is the honest `argv[0]`. Best-effort, never throws. */
function normalizeForegroundName(
  reported: string,
  foregroundPid: number | undefined,
): string {
  if (!isDynamicLoader(reported) || foregroundPid === undefined)
    return reported;
  const argv = readProcCmdline(foregroundPid);
  if (argv === undefined) return reported;
  return foregroundNameFromArgv(argv) ?? reported;
}

function readForegroundPid(proc: pty.IPty): number | undefined {
  const pid = proc.foregroundPid;
  return pid && pid > 0 ? pid : undefined;
}

export function createPtyHost(opts: PtyHostOptions): PtyHost {
  const { log } = opts;
  const defaultScrollback = opts.defaultScrollback ?? DEFAULT_MIRROR_SCROLLBACK;
  const dataMaxQueue = opts.dataMaxQueue;
  const generateId = opts.generateId ?? (() => randomUUID());
  const entries = new Map<PtyId, Entry>();
  const exitCodes = new Map<PtyId, number>();
  const inventoryFanOut = new FanOut<PtyInventoryEvent>();
  const activityFanOut = new FanOut<PtyActivityEdge>();

  function requireEntry(id: PtyId): Entry {
    const entry = entries.get(id);
    if (!entry) throw new PtyNotFound({ id });
    return entry;
  }

  function listEntryOf(entry: Entry): PtyListEntry {
    return {
      id: entry.id,
      pid: entry.proc.pid,
      cwd: entry.cwd,
      lastActivity: entry.lastActivity,
      title: entry.title,
      foregroundProcess: readForeground(entry).process,
      commandRooted: entry.commandRooted,
    };
  }

  function readForeground(entry: Entry): ForegroundSample {
    const foregroundPid = readForegroundPid(entry.proc);
    return {
      process: normalizeForegroundName(entry.proc.process, foregroundPid),
      foregroundPid,
    };
  }

  function foregroundProcessName(id: PtyId): string | undefined {
    const entry = entries.get(id);
    return entry === undefined ? undefined : readForeground(entry).process;
  }

  function sampleForeground(entry: Entry): void {
    const sample = readForeground(entry);
    const key = `${sample.process}\u0000${sample.foregroundPid ?? ""}`;
    if (key === entry.lastForegroundKey) return;
    entry.lastForegroundKey = key;
    entry.foregroundFanOut.publishUnsafe(sample);
  }

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
    entry.headless.dispose();
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
    entry.repaint.settle();
    inventoryFanOut.publishUnsafe({ kind: "exited", id: entry.id });
  }

  function spawn(spawnOpts: PtySpawnOpts): PtySpawnResult {
    const id = spawnOpts.id ?? generateId();
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

    if (
      typeof (proc as unknown as { foregroundPid?: unknown }).foregroundPid !==
      "number"
    ) {
      throw new Error(
        "node-pty.foregroundPid accessor missing — fork patch may have regressed",
      );
    }

    const headless = new Terminal({
      cols,
      rows,
      scrollback,
      reflowCursorLine: true,
      allowProposedApi: true,
    });
    const serialize = new SerializeAddon();
    headless.loadAddon(serialize);

    const entry: Entry = {
      id,
      proc,
      headless,
      serialize,
      lastBoundedSnapshotChars: 0,
      repaint: createRepaintWindow({
        settleAfterMs: RESIZE_WINDOW_MS,
        budgetChars: () => dataBudgetChars(entries.get(id)),
        publish: (data) => entry.data.publishUnsafe({ kind: "bytes", data }),
        resyncAll: () => entry.data.dropAllUnsafe(),
      }),
      lastActivityEdgeAt: 0,
      snapshotCache: undefined,
      boundedSnapshotCache: undefined,
      anchor: createMirrorAnchor(headless),
      cwd: spawnOpts.cwd,
      title: "",
      lastActivity: Date.now(),
      exitCode: undefined,
      exitWaiters: new Set(),
      disposables: [],
      data: new FanOut<PtyDataItem>({
        maxQueue: dataMaxQueue,
        byteBudget: {
          sizeOf: dataItemChars,
          limit: () => dataBudgetChars(entries.get(id)),
        },
      }),
      cwdFanOut: new FanOut<string>(),
      titleFanOut: new FanOut<string>(),
      commandRunFanOut: new FanOut<string>(),
      lastCommand: undefined,
      commandRooted: spawnOpts.commandRooted ?? false,
      foregroundFanOut: new FanOut<ForegroundSample>(),
      lastForegroundKey: undefined,
      lastForegroundSampleAt: 0,
      foregroundTimers: [],
      onDispose: spawnOpts.onDispose,
    };
    entries.set(id, entry);

    if (entry.commandRooted) {
      const command = shellJoin([spawnOpts.shell, ...(spawnOpts.args ?? [])]);
      entry.lastCommand = command;
      entry.commandRunFanOut.publishUnsafe(command);
    }

    entry.disposables.push({ dispose: () => entry.anchor.dispose() });

    entry.disposables.push(
      headless.parser.registerOscHandler(7, (data: string) => {
        const url = URL.parse(data);
        if (url?.protocol === "file:") {
          entry.cwd = decodeURIComponent(url.pathname);
          log.debug({ id, cwd: entry.cwd }, "cwd changed (OSC 7)");
          entry.cwdFanOut.publishUnsafe(entry.cwd);
        }
        return true;
      }),
    );

    entry.disposables.push(
      headless.onTitleChange((title: string) => {
        entry.title = title;
        log.debug({ id, title }, "title changed (OSC 0/2)");
        entry.titleFanOut.publishUnsafe(title);
        sampleForeground(entry);
      }),
    );

    entry.disposables.push(
      headless.parser.registerOscHandler(633, (data: string) => {
        if (!data.startsWith("E;")) return false;
        const command = data.slice(2);
        log.debug({ id, command }, "command run (OSC 633;E)");
        entry.lastCommand = command;
        entry.commandRunFanOut.publishUnsafe(command);
        scheduleForegroundBurst(entry);
        return true;
      }),
    );

    entry.disposables.push(
      headless.parser.registerCsiHandler(
        { prefix: ">", final: "q" },
        (params) => {
          const ps = params[0];
          if (typeof ps === "number" && ps > 0) return true;
          proc.write(`\x1bP>|${HEADLESS_TERM_ID}\x1b\\`);
          return true;
        },
      ),
    );

    entry.disposables.push(
      headless.onData((response: string) => {
        if (!shouldForwardHeadlessReply(response)) return;
        proc.write(response);
      }),
    );

    entry.disposables.push(
      proc.onData((data: string) => {
        const now = Date.now();
        entry.lastActivity = now;
        if (
          shouldEmitActivityEdge(
            now,
            entry.repaint.isOpen,
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
        headless.write(data, () => {
          invalidateSnapshot(entry);
          entry.anchor.reanchorIfReset();
          entry.repaint.offer(data);
        });
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

    inventoryFanOut.publishUnsafe({
      kind: "created",
      entry: listEntryOf(entry),
    });

    return { id, pid: proc.pid };
  }

  function snapshotOf(entry: Entry): string {
    entry.snapshotCache ??= entry.serialize.serialize();
    return entry.snapshotCache;
  }
  function snapshotStartLocal(entry: Entry): number {
    const normal = entry.headless.buffer.normal;
    return snapToWrapHead(
      normal,
      Math.max(0, normal.length - SNAPSHOT_SCROLLBACK - entry.headless.rows),
    );
  }
  function boundedSnapshotOf(entry: Entry): {
    snapshot: string;
    topLine: number;
  } {
    entry.boundedSnapshotCache ??= (() => {
      const start = snapshotStartLocal(entry);
      const normal = entry.headless.buffer.normal;
      const scrollback = Math.max(
        0,
        normal.length - entry.headless.rows - start,
      );
      const snapshot = entry.serialize.serialize({ scrollback });
      entry.lastBoundedSnapshotChars = snapshot.length;
      return { topLine: entry.anchor.baseLine() + start, snapshot };
    })();
    return entry.boundedSnapshotCache;
  }
  function invalidateSnapshot(entry: Entry): void {
    entry.snapshotCache = undefined;
    entry.boundedSnapshotCache = undefined;
  }

  function dataBudgetChars(entry: Entry | undefined): number {
    return Math.max(
      MIN_DATA_BUDGET_CHARS,
      entry?.lastBoundedSnapshotChars ?? 0,
    );
  }

  function publishResized(entry: Entry, grid: PtyGrid): void {
    entry.data.publishUnsafe({ kind: "resized", grid });
  }

  function attach(
    id: PtyId,
    opts?: PtyAttachOpts,
  ): Effect.Effect<PtyAttachment, never, Scope.Scope> {
    const { resizeTo } = opts ?? {};
    return Effect.suspend(() => {
      const entry = requireEntry(id);
      const windowWasOpen = entry.repaint.isOpen;
      if (resizeTo) resize(id, resizeTo.cols, resizeTo.rows);
      if (!windowWasOpen) return attachNow(id, entry);
      return Effect.flatMap(entry.repaint.awaitSettled(), () =>
        attachNow(id, entry),
      );
    });
  }

  function attachNow(
    id: PtyId,
    parked: Entry,
  ): Effect.Effect<PtyAttachment, never, Scope.Scope> {
    return Effect.suspend(() => {
      const entry = requireEntry(id);
      if (entry !== parked) throw new PtyNotFound({ id });
      return Effect.map(
        entry.data.subscribeWith(() => {
          entry.repaint.claimOverlap();
          return {
            ...boundedSnapshotOf(entry),
            reflowEpoch: entry.anchor.reflowEpoch(),
            grid: { cols: entry.headless.cols, rows: entry.headless.rows },
          };
        }),
        ({ stream, reading }): PtyAttachment => ({
          snapshot: reading.snapshot,
          topLine: reading.topLine,
          reflowEpoch: reading.reflowEpoch,
          grid: reading.grid,
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
          return Effect.sync(() => {
            entry.exitWaiters.delete(waiter);
          });
        });
      }
      const cached = exitCodes.get(id);
      if (cached !== undefined) return Effect.succeed(cached);
      return Effect.fail(new PtyNotFound({ id }));
    });
  }

  function getForegroundPid(id: PtyId): number | undefined {
    const entry = entries.get(id);
    return entry ? readForegroundPid(entry.proc) : undefined;
  }

  function getScreenState(id: PtyId): string {
    const entry = entries.get(id);
    return entry ? snapshotOf(entry) : "";
  }

  function getScreenTextFor(id: PtyId, extent?: ScreenExtent): string {
    const entry = entries.get(id);
    if (!entry) return "";
    const buffer = entry.headless.buffer.active;
    const { start, end } = resolveScreenExtent(
      buffer.length,
      entry.headless.rows,
      extent,
    );
    return readBufferRange(buffer, { start, end });
  }

  function getScreenCellsFor(
    id: PtyId,
    extent: ScreenExtent = { kind: "viewport" },
  ): SnapshotGrid | undefined {
    const entry = entries.get(id);
    if (!entry) return undefined;
    const buffer = entry.headless.buffer.active;
    const { start, end } = resolveScreenExtent(
      buffer.length,
      entry.headless.rows,
      extent,
    );
    const { rows, cols } = boundScreenCells(end - start, entry.headless.cols);
    return readGrid(buffer, cols, end - rows, rows);
  }

  function getHistory(
    id: PtyId,
    before: number | undefined,
    max: number,
    epoch?: number,
  ): PtyHistoryChunk {
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
    if (epoch !== undefined && epoch !== entry.anchor.reflowEpoch())
      return { kind: "stale" };
    const buffer = entry.headless.buffer.normal;
    const cursor =
      before ??
      entry.anchor.baseLine() +
        Math.max(0, buffer.length - entry.headless.rows);
    const localEnd = Math.min(
      cursor - entry.anchor.baseLine() - 1,
      buffer.length - 1,
    );
    if (localEnd < 0)
      return { kind: "chunk", chunk: "", topLine: cursor, exhausted: true };
    const start = snapToWrapHead(buffer, Math.max(0, localEnd - max + 1));
    const chunk = entry.serialize.serialize({
      range: { start, end: localEnd },
      excludeModes: true,
      excludeAltBuffer: true,
    });
    return {
      kind: "chunk",
      chunk,
      topLine: entry.anchor.baseLine() + start,
      exhausted: start === 0,
    };
  }

  function write(id: PtyId, data: string): void {
    entries.get(id)?.proc.write(data);
  }

  function reflowMirrorThenSignalChild(
    entry: Entry,
    cols: number,
    rows: number,
  ): void {
    entry.headless.resize(cols, rows);
    publishResized(entry, {
      cols: entry.headless.cols,
      rows: entry.headless.rows,
    });
    entry.repaint.open();
    entry.proc.resize(cols, rows);
  }

  function resize(id: PtyId, cols: number, rows: number): boolean {
    const entry = entries.get(id);
    if (!entry) return false;
    const prevCols = entry.headless.cols;
    const prevRows = entry.headless.rows;
    if (cols === prevCols && rows === prevRows) return true;
    reflowMirrorThenSignalChild(entry, cols, rows);
    invalidateSnapshot(entry);
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
        return foregroundProcessName(id) ?? "";
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
    subscribeCommandRun: (id) =>
      Effect.suspend(() => {
        const entry = requireEntry(id);
        return Effect.map(
          entry.commandRunFanOut.subscribeWith(() => entry.lastCommand),
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
    getProcess: foregroundProcessName,
    getCwd: (id) => entries.get(id)?.cwd,
    getTitle: (id) => entries.get(id)?.title,
    getScreenState,
    getScreenText: getScreenTextFor,
    getScreenCells: getScreenCellsFor,
    getHistory,
    handle,
    dispose: () => {
      for (const entry of [...entries.values()]) entry.proc.kill("SIGKILL");
      inventoryFanOut.closeUnsafe();
      activityFanOut.closeUnsafe();
    },
  };
}
