/**
 * `PtyHost` — the multi-client PTY-owner primitive.
 *
 * Owns, per PTY: a `node-pty` child, an `@xterm/headless` screen mirror
 * (for cheap late-join snapshots — ~4KB of serialized VT vs replaying raw
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
 * Each tap fans out through a bounded {@link Channel} so any number of
 * consumers can attach. The host knows nothing about git, PRs, agent
 * detection, the file tree, or any wire protocol — those live above it.
 * It also knows nothing about shell-env preparation: callers hand it a
 * ready `shell` / `args` / `env` (kolu builds those via `kolu-pty`).
 *
 * Transport-agnostic and dependency-light (node-pty + @xterm + a logger),
 * so the same primitive drops into an in-process backend today and a
 * standalone agent later.
 */

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { shouldForwardHeadlessReply } from "@kolu/terminal-protocol";
import type { Logger } from "@kolu/surface-daemon";
import * as pty from "node-pty";
import { Channel } from "./channel.ts";

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
/** How many exited-PTY exit codes to retain after teardown, so a late
 *  `exitPromise(id)` resolves with the real code rather than a fabricated
 *  one. Bounded so the map can't grow without limit. */
const MAX_EXIT_TOMBSTONES = 1024;

// @xterm packages ship CJS only — use createRequire for clean ESM interop.
const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

/** The terminal-identity string the headless PTY reports in its XTVERSION
 *  (CSI > q) reply. The DCS reply is built from this — see the XTVERSION
 *  handler in {@link createPtyHost} — so the byte layout lives in one place.
 *  Exported so tests assert against the same source rather than a copy. */
export const HEADLESS_TERM_ID = "xterm-headless(kolu)";

/** Opaque PTY identifier. */
export type PtyId = string;

/** Extract plain text from an xterm buffer within a line range.
 *
 *  `tailLines` is a convenience for "the last N rendered lines": it pins
 *  `startLine` to `buffer.length - tailLines` (clamped at 0), the only place
 *  the live buffer length is known. Screen-scrape detectors that inspect only
 *  the screen bottom pass it so a long scrollback (the configured 50k lines)
 *  isn't allocated, joined, and shipped every poll just to be discarded —
 *  `tailLines` overrides an explicit `startLine`. */
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

/**
 * Per-PTY control + introspection surface vended by {@link PtyHost.handle}.
 *
 * A thin facade over the host's id-keyed methods, so a consumer that holds
 * "one terminal" (the registry entry, the provider DAG) can read/write
 * without threading the id and host through every call. Deliberately omits
 * `dispose()` — termination flows through {@link PtyHost.kill}.
 */
export interface PtyHandle {
  /** OS process ID of the spawned shell. */
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
  /** Plain text content of the terminal buffer (scrollback + viewport).
   *  `tailLines` reads only the last N rendered lines (see {@link getScreenText});
   *  pass it instead of fetching the whole buffer when only the tail matters. */
  getScreenText(
    startLine?: number,
    endLine?: number,
    tailLines?: number,
  ): string;
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
   *  for a brand-new PTY. */
  snapshot: string;
  /** Live output deltas after the snapshot. Ends on iterator return,
   *  signal abort, PTY exit, or a slow-subscriber drop (which also fires
   *  `attach`'s `onOverflow`, so the serving layer can tell that end apart). */
  deltas: AsyncIterable<string>;
}

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
}

/** Construction options for {@link createPtyHost}. */
export interface PtyHostOptions {
  log: Logger;
  /** Default headless scrollback for spawns that don't set their own. */
  defaultScrollback?: number;
  /** Id generator (defaults to `randomUUID`). */
  generateId?: () => PtyId;
  /** Per-attach-subscriber buffered-chunk cap for the data (attach) channel
   *  before a slow consumer is dropped (and an `overflow` frame emitted).
   *  Defaults to the {@link Channel} default (10,000). Lowered in tests to drive
   *  the slow-subscriber drop deterministically. */
  dataMaxQueue?: number;
}

/** The multi-client PTY-owner primitive. */
export interface PtyHost {
  /** Spawn a PTY; returns its id + pid immediately. */
  spawn(opts: PtySpawnOpts): PtySpawnResult;
  /** Subscribe-before-serialize: returns a race-free snapshot + delta
   *  stream for a late-joining client. `onOverflow` fires (once) if THIS
   *  attachment's delta subscriber is dropped for lagging past the bound — the
   *  serving layer turns it into an `overflow` frame so the consumer re-attaches
   *  rather than mistaking the drop for a PTY exit. */
  attach(
    id: PtyId,
    signal?: AbortSignal,
    onOverflow?: () => void,
  ): PtyAttachment;
  /** Per-PTY cwd update stream (OSC 7). */
  subscribeCwd(id: PtyId, signal?: AbortSignal): AsyncIterable<string>;
  /** Per-PTY title update stream (OSC 0/2). */
  subscribeTitle(id: PtyId, signal?: AbortSignal): AsyncIterable<string>;
  /** Per-PTY preexec command stream (OSC 633 ; E payloads). */
  subscribeCommandRun(id: PtyId, signal?: AbortSignal): AsyncIterable<string>;
  /** Per-PTY foreground-sample stream — `{process, foregroundPid}` pushed
   *  whenever it changes (sampled on title / command-run + a post-command
   *  burst, deduped). The socket equivalent of reading `PtyHandle.process` /
   *  `.foregroundPid` synchronously. */
  subscribeForeground(
    id: PtyId,
    signal?: AbortSignal,
  ): AsyncIterable<ForegroundSample>;
  /** Resolves with the exit code when the child exits; resolves immediately
   *  for an already-exited PTY. If `signal` aborts first, the registered
   *  waiter is removed and the promise rejects — so a long-lived host doesn't
   *  retain a waiter per abandoned subscription (e.g. one per kolu-server
   *  restart). */
  exitPromise(id: PtyId, signal?: AbortSignal): Promise<number>;
  /** Write input (keystrokes, pasted text). No-op if the PTY is gone. */
  write(id: PtyId, data: string): void;
  /** Resize the PTY grid + the headless mirror. No-op if gone. */
  resize(id: PtyId, cols: number, rows: number): void;
  /** Kill the PTY. Teardown (channels, mirror, onDispose) runs from the
   *  child's exit, so `exitPromise` still resolves. No-op if gone. */
  kill(id: PtyId, signal?: NodeJS.Signals): void;
  /** Snapshot of every live PTY. */
  list(): PtyListEntry[];
  /** Subscribe to membership deltas — a `created` / `exited` for EVERY PTY this
   *  host owns, including ones spawned by other clients. Eager-subscribe (the
   *  {@link Channel} contract), so a spawn racing the subscribe is captured, not
   *  dropped. Does NOT replay the current set — the serving layer prepends a
   *  {@link list} snapshot (snapshot-then-deltas). */
  subscribeInventory(signal?: AbortSignal): AsyncIterable<PtyInventoryEvent>;
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
  /** Current cwd, or `undefined` if gone. */
  getCwd(id: PtyId): string | undefined;
  /** Last OSC 0/2 title (empty string if none yet), or `undefined` if
   *  gone. */
  getTitle(id: PtyId): string | undefined;
  /** Serialized screen state; empty string if gone. */
  getScreenState(id: PtyId): string;
  /** Plain text of the buffer; empty string if gone. `tailLines` reads only
   *  the last N rendered lines (see {@link getScreenText}). */
  getScreenText(
    id: PtyId,
    startLine?: number,
    endLine?: number,
    tailLines?: number,
  ): string;
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
  /** Memoized attach snapshot for the current publish-epoch — so a burst of
   *  attaches to one PTY between two mirror mutations (a reconnect storm against
   *  an idle terminal) shares a single serialize instead of one per attach.
   *  Read and invalidated ONLY through `snapshotOf` / `invalidateSnapshot`,
   *  which own the epoch invariant (see their definitions). */
  snapshotCache: string | undefined;
  cwd: string;
  title: string;
  lastActivity: number;
  exitCode: number | undefined;
  exitWaiters: ((code: number) => void)[];
  disposables: { dispose(): void }[];
  data: Channel<string>;
  cwdChannel: Channel<string>;
  titleChannel: Channel<string>;
  commandRunChannel: Channel<string>;
  /** Last command line seen on an OSC 633;E mark (`undefined` until the first),
   *  retained so the `commandRun` source can replay it snapshot-first to a late
   *  subscriber — mirroring how `foreground` replays the current process. */
  lastCommand: string | undefined;
  foregroundChannel: Channel<ForegroundSample>;
  /** Dedup key (`process\0foregroundPid`) of the last sample published, so
   *  a steady foreground doesn't spam the channel across burst samples. */
  lastForegroundKey: string | undefined;
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
  // down — lets exitPromise() honour its "already-exited" contract with the
  // real code instead of a fabricated 0.
  const exitCodes = new Map<PtyId, number>();
  // Host-global membership feed — one channel for the whole host (not per-PTY,
  // like the taps), broadcasting a `created`/`exited` from the two `entries`
  // mutation sites (spawn / teardown). Eager-subscribe, so a spawn racing a
  // subscriber is captured; never closed except on dispose (host shutdown).
  const inventoryChannel = new Channel<PtyInventoryEvent>();

  function requireEntry(id: PtyId): Entry {
    const entry = entries.get(id);
    if (!entry) throw new Error(`pty-host: no PTY with id ${id}`);
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
    };
  }

  /** Sample `{process, foregroundPid}` and publish to the entry's foreground
   *  channel iff it changed since the last publish (dedup by a compound key).
   *  Cheap: a property read + a `tcgetpgrp` syscall. */
  function sampleForeground(entry: Entry): void {
    const foregroundPid = readForegroundPid(entry.proc);
    const process = entry.proc.process;
    const key = `${process}\u0000${foregroundPid ?? ""}`;
    if (key === entry.lastForegroundKey) return;
    entry.lastForegroundKey = key;
    entry.foregroundChannel.publish({ process, foregroundPid });
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
    entry.data.close();
    entry.cwdChannel.close();
    entry.titleChannel.close();
    entry.commandRunChannel.close();
    entry.foregroundChannel.close();
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
    // Announce the membership change AFTER the delete, so a consumer reacting to
    // `exited` that re-checks `has`/`list` sees the PTY already gone.
    inventoryChannel.publish({ kind: "exited", id: entry.id });
  }

  function spawn(spawnOpts: PtySpawnOpts): PtySpawnResult {
    const id = spawnOpts.id ?? generateId();
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

    // Headless terminal parses PTY output into screen state for
    // serialization. allowProposedApi is required for SerializeAddon to
    // access the buffer.
    const headless = new Terminal({
      cols,
      rows,
      scrollback,
      // Match the client (Terminal.tsx): rewrap the cursor's wrapped line on a
      // narrowing resize instead of truncating it. The serialized snapshot this
      // terminal produces is the scrollback a client restores on attach/
      // reconnect, so a URL left on the cursor line when the PTY resizes must
      // survive here too — otherwise the restored buffer hands back a clipped
      // link even though the live client got it right.
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
      snapshotCache: undefined,
      cwd: spawnOpts.cwd,
      title: "",
      lastActivity: Date.now(),
      exitCode: undefined,
      exitWaiters: [],
      disposables: [],
      data: new Channel<string>({ maxQueue: dataMaxQueue }),
      cwdChannel: new Channel<string>(),
      titleChannel: new Channel<string>(),
      commandRunChannel: new Channel<string>(),
      lastCommand: undefined,
      foregroundChannel: new Channel<ForegroundSample>(),
      lastForegroundKey: undefined,
      foregroundTimers: [],
      onDispose: spawnOpts.onDispose,
    };
    entries.set(id, entry);

    // OSC 7 (CWD reporting) — the rc wrapper kolu injects makes the shell
    // emit these on every prompt.
    entry.disposables.push(
      headless.parser.registerOscHandler(7, (data: string) => {
        try {
          const url = new URL(data);
          if (url.protocol === "file:") {
            entry.cwd = decodeURIComponent(url.pathname);
            log.debug({ id, cwd: entry.cwd }, "cwd changed (OSC 7)");
            entry.cwdChannel.publish(entry.cwd);
          }
        } catch {
          // Ignore malformed OSC 7 data.
        }
        return true;
      }),
    );

    // OSC 0/2 title changes — kolu's preexec hook emits OSC 2 before each
    // command, signalling the foreground process may have changed.
    entry.disposables.push(
      headless.onTitleChange((title: string) => {
        entry.title = title;
        log.debug({ id, title }, "title changed (OSC 0/2)");
        entry.titleChannel.publish(title);
        // OSC 2 signals the foreground process may have changed — sample now.
        sampleForeground(entry);
      }),
    );

    // OSC 633 ; E ; <command> — VS Code's "exact command line" mark. The
    // payload arrives as "E;<command>"; accept only the E sub-code so
    // future VS Code sequences (A/B/C/D) pass through untouched.
    entry.disposables.push(
      headless.parser.registerOscHandler(633, (data: string) => {
        if (!data.startsWith("E;")) return false;
        const command = data.slice(2);
        // DEBUG only: the raw command line is whatever the user typed,
        // including any secrets; consumers normalize before logging at
        // higher levels.
        log.debug({ id, command }, "command run (OSC 633;E)");
        // Retain the command BEFORE publishing so the synchronous
        // `getLastCommand` is already current for anyone the publish wakes.
        entry.lastCommand = command;
        entry.commandRunChannel.publish(command);
        // The agent process forks AFTER this mark — re-sample foreground
        // across the settle window so detection sees the real foreground.
        scheduleForegroundBurst(entry);
        return true;
      }),
    );

    // XTVERSION (CSI > 0 q): identify the terminal. TUIs like Yazi query this
    // synchronously at startup and block until they receive a DCS reply. The
    // headless xterm has no built-in handler, so without this it never answers
    // — and the browser xterm's reply is filtered out as a late duplicate
    // (see @kolu/terminal-protocol responseFilter). Answer here so the PTY is
    // never blocked.
    entry.disposables.push(
      headless.parser.registerCsiHandler(
        { prefix: ">", final: "q" },
        (params) => {
          // XTVERSION is "CSI > Ps q" with Ps absent or 0. Mirror xterm's own
          // sendXtVersion: answer only for Ps <= 0, but always consume the
          // sequence so it never leaks downstream as a no-op CSI.
          const ps = params[0];
          if (typeof ps === "number" && ps > 0) return true;
          proc.write(`\x1bP>|${HEADLESS_TERM_ID}\x1b\\`);
          return true;
        },
      ),
    );

    // Forward device-query responses (DA1/DSR) from the headless terminal
    // back to the PTY. TUIs like Yazi probe terminal capabilities at
    // startup — the headless terminal answers immediately, avoiding a
    // round trip to a (possibly absent) client. The forward/drop policy
    // (CSI/DCS forward; OSC drop — nothing consumes a headless OSC answer,
    // and a cooked tty echoes it as visible garbage) is shared protocol,
    // owned by @kolu/terminal-protocol beside the client-side suppression
    // it reciprocates.
    entry.disposables.push(
      headless.onData((response: string) => {
        if (!shouldForwardHeadlessReply(response)) return;
        proc.write(response);
      }),
    );

    // PTY data → headless mirror → fan-out. Publish in the headless write
    // *callback* (post-parse), not on arrival: `@xterm/headless`'s write is
    // async — the buffer only reflects the data once the callback fires —
    // so "published" means "parsed into the mirror". That makes attach()'s
    // synchronous subscribe()+serialize() pair partition the byte stream at
    // a single point with no gap and no overlap.
    entry.disposables.push(
      proc.onData((data: string) => {
        entry.lastActivity = Date.now();
        headless.write(data, () => {
          // New bytes have parsed into the mirror, so the memoized snapshot is
          // stale: clear it BEFORE publishing, so a cached value always implies
          // "no parse since it was taken" — the invariant `attach()` leans on.
          invalidateSnapshot(entry);
          entry.data.publish(data);
        });
      }),
    );

    entry.disposables.push(
      proc.onExit(({ exitCode }) => {
        log.debug({ id, exitCode }, "exited");
        entry.exitCode = exitCode;
        const waiters = entry.exitWaiters;
        entry.exitWaiters = [];
        for (const resolve of waiters) resolve(exitCode);
        teardown(entry);
      }),
    );

    // The PTY is fully wired and in `entries` — announce it on the membership
    // feed so a consumer that reacts to `created` and immediately attaches /
    // lists finds a live, fully-tapped entry. Published last, so the snapshot a
    // racing inventory subscriber takes is consistent with this delta.
    inventoryChannel.publish({ kind: "created", entry: listEntryOf(entry) });

    return { id, pid: proc.pid };
  }

  // The serialized mirror snapshot for the current publish-epoch is a single
  // domain concept with one production site and one invalidation seam, so its
  // memo can't desync across the consumers that read it or the mutators that
  // dirty it. `snapshotOf` is the only place the mirror is serialized;
  // `invalidateSnapshot` is the only place the memo is dropped, called from
  // EVERY mutator of the serialized state (the data-publish path and resize()).
  function snapshotOf(entry: Entry): string {
    entry.snapshotCache ??= entry.serialize.serialize();
    return entry.snapshotCache;
  }
  function invalidateSnapshot(entry: Entry): void {
    entry.snapshotCache = undefined;
  }

  function attach(
    id: PtyId,
    signal?: AbortSignal,
    onOverflow?: () => void,
  ): PtyAttachment {
    const entry = requireEntry(id);
    // Subscribe BEFORE serializing, both synchronously: no headless parse
    // (and thus no post-parse publish) can interleave between the two, so
    // every chunk lands in exactly one of snapshot / deltas.
    const deltas = entry.data.subscribe(signal, onOverflow);
    // An attach whose signal is ALREADY aborted — the re-issued half of a
    // reconnect storm, whose client has gone — does zero serialize work: the
    // subscribe above already returned an empty stream, so an empty snapshot
    // (a no-op `term.write("")` on the client) completes a no-op attach.
    if (signal?.aborted) return { snapshot: "", deltas };
    // Coalesce within the publish-epoch: the first attach serializes and
    // memoizes via snapshotOf(); the rest of a burst reuse the identical
    // immutable string. Race-free — the memo is set through snapshotOf() and
    // cleared through invalidateSnapshot() in every mirror mutator, all
    // synchronous, and publish only fires from a later task; so a present cache
    // means the mirror is unchanged since it was taken, and every reusing
    // attacher's deltas (subscribed just above) begin at the next publish,
    // exactly where the shared snapshot ends. No gap, no overlap.
    return { snapshot: snapshotOf(entry), deltas };
  }

  function exitPromise(id: PtyId, signal?: AbortSignal): Promise<number> {
    const entry = entries.get(id);
    if (entry) {
      if (entry.exitCode !== undefined) return Promise.resolve(entry.exitCode);
      return new Promise<number>((resolve, reject) => {
        const waiter = (code: number): void => {
          cleanup();
          resolve(code);
        };
        const onAbort = (): void => {
          const i = entry.exitWaiters.indexOf(waiter);
          if (i >= 0) entry.exitWaiters.splice(i, 1);
          cleanup();
          reject(new Error("exitPromise aborted"));
        };
        const cleanup = (): void =>
          signal?.removeEventListener("abort", onAbort);
        if (signal?.aborted) {
          reject(new Error("exitPromise aborted"));
          return;
        }
        entry.exitWaiters.push(waiter);
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    }
    const cached = exitCodes.get(id);
    if (cached !== undefined) return Promise.resolve(cached);
    // Unknown id — never spawned, or exited long enough ago to be evicted
    // from the tombstone. Defensive: the in-process caller registers its
    // waiter while the PTY is live, so this path isn't hit in practice.
    return Promise.resolve(0);
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

  function getScreenTextFor(
    id: PtyId,
    startLine?: number,
    endLine?: number,
    tailLines?: number,
  ): string {
    const entry = entries.get(id);
    if (!entry) return "";
    return getScreenText(
      entry.headless.buffer.active,
      startLine,
      endLine,
      tailLines,
    );
  }

  function write(id: PtyId, data: string): void {
    entries.get(id)?.proc.write(data);
  }

  function resize(id: PtyId, cols: number, rows: number): void {
    const entry = entries.get(id);
    if (!entry) return;
    entry.proc.resize(cols, rows);
    entry.headless.resize(cols, rows);
    // resize() reflows the mirror (reflowCursorLine rewraps lines on a width
    // change), so the serialized layout changes with NO data publish to clear
    // the memo — invalidate here too, or a same-epoch attach after a resize
    // hands back the stale pre-resize snapshot.
    invalidateSnapshot(entry);
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
      getScreenText: (startLine, endLine, tailLines) =>
        getScreenTextFor(id, startLine, endLine, tailLines),
    };
  }

  return {
    spawn,
    attach,
    subscribeCwd: (id, signal) => requireEntry(id).cwdChannel.subscribe(signal),
    subscribeTitle: (id, signal) =>
      requireEntry(id).titleChannel.subscribe(signal),
    subscribeCommandRun: (id, signal) =>
      requireEntry(id).commandRunChannel.subscribe(signal),
    subscribeForeground: (id, signal) =>
      requireEntry(id).foregroundChannel.subscribe(signal),
    exitPromise,
    write,
    resize,
    kill: (id, signal) => entries.get(id)?.proc.kill(signal),
    list: () => [...entries.values()].map(listEntryOf),
    subscribeInventory: (signal) => inventoryChannel.subscribe(signal),
    has: (id) => entries.has(id),
    size: () => entries.size,
    getForegroundPid,
    getProcess: (id) => entries.get(id)?.proc.process,
    getLastCommand: (id) => entries.get(id)?.lastCommand,
    getCwd: (id) => entries.get(id)?.cwd,
    getTitle: (id) => entries.get(id)?.title,
    getScreenState,
    getScreenText: getScreenTextFor,
    handle,
    dispose: () => {
      for (const entry of [...entries.values()]) entry.proc.kill();
      // Host shutdown — end every inventory subscription gracefully. The async
      // `onExit` → teardown `exited` publishes from the kills above land on a
      // closed channel (a no-op), which is fine: the host is going away.
      inventoryChannel.close();
    },
  };
}
