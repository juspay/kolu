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
import type { Logger } from "./logger.ts";
import * as pty from "node-pty";
import { Channel } from "./channel.ts";

/** Default terminal grid dimensions (matches xterm/VT100 standard). */
const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
/** Default headless scrollback when a spawn doesn't override it. */
const DEFAULT_SCROLLBACK = 10_000;
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
   *  signal abort, or PTY exit. */
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
}

/** The multi-client PTY-owner primitive. */
export interface PtyHost {
  /** Spawn a PTY; returns its id + pid immediately. */
  spawn(opts: PtySpawnOpts): PtySpawnResult;
  /** Subscribe-before-serialize: returns a race-free snapshot + delta
   *  stream for a late-joining client. */
  attach(id: PtyId, signal?: AbortSignal): PtyAttachment;
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
  /** Whether this host still owns a PTY with `id` (an existence check, not a
   *  data read — distinct from `getCwd(id) !== undefined`, which happens to
   *  coincide today only because cwd is always set at spawn). */
  has(id: PtyId): boolean;
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
  const defaultScrollback = opts.defaultScrollback ?? DEFAULT_SCROLLBACK;
  const generateId = opts.generateId ?? (() => randomUUID());
  const entries = new Map<PtyId, Entry>();
  // Bounded tombstone of exit codes for PTYs that have exited and been torn
  // down — lets exitPromise() honour its "already-exited" contract with the
  // real code instead of a fabricated 0.
  const exitCodes = new Map<PtyId, number>();

  function requireEntry(id: PtyId): Entry {
    const entry = entries.get(id);
    if (!entry) throw new Error(`pty-host: no PTY with id ${id}`);
    return entry;
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
      cwd: spawnOpts.cwd,
      title: "",
      lastActivity: Date.now(),
      exitCode: undefined,
      exitWaiters: [],
      disposables: [],
      data: new Channel<string>(),
      cwdChannel: new Channel<string>(),
      titleChannel: new Channel<string>(),
      commandRunChannel: new Channel<string>(),
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
        headless.write(data, () => entry.data.publish(data));
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

    return { id, pid: proc.pid };
  }

  function attach(id: PtyId, signal?: AbortSignal): PtyAttachment {
    const entry = requireEntry(id);
    // Subscribe BEFORE serializing, both synchronously: no headless parse
    // (and thus no post-parse publish) can interleave between the two, so
    // every chunk lands in exactly one of snapshot / deltas.
    const deltas = entry.data.subscribe(signal);
    const snapshot = entry.serialize.serialize();
    return { snapshot, deltas };
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
    return entries.get(id)?.serialize.serialize() ?? "";
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
    list: () =>
      [...entries.values()].map((entry) => ({
        id: entry.id,
        pid: entry.proc.pid,
        cwd: entry.cwd,
        lastActivity: entry.lastActivity,
        title: entry.title,
        foregroundProcess: entry.proc.process,
      })),
    has: (id) => entries.has(id),
    getForegroundPid,
    getProcess: (id) => entries.get(id)?.proc.process,
    getCwd: (id) => entries.get(id)?.cwd,
    getTitle: (id) => entries.get(id)?.title,
    getScreenState,
    getScreenText: getScreenTextFor,
    handle,
    dispose: () => {
      for (const entry of [...entries.values()]) entry.proc.kill();
    },
  };
}
