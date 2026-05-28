/**
 * Long-lived multi-client PTY-owner primitive.
 *
 * One PtyHost owns N node-pty children, mirrors each into an
 * `@xterm/headless` instance so reattach can be cheap (serialized
 * screen-state ~4 KiB vs raw scrollback replay), and fans out PTY
 * data + OSC metadata events to N subscribers.
 *
 * Wire details (forwarding to xterm/headless and node-pty) are
 * intentionally identical to the kolu-pty shape this primitive
 * generalizes — OSC 7 → cwd, OSC 0/2 → title, OSC 633;E → commandRun
 * — so the agent that consumes it can serve the same kolu metadata
 * stream the in-process node-pty path served before R-4.
 */

import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import type { Logger } from "kolu-shared";
import * as pty from "node-pty";
import { Channel } from "./channel.ts";

// @xterm packages ship CJS only — createRequire is the clean ESM bridge.
const require = createRequire(import.meta.url);
const { Terminal } =
  require("@xterm/headless") as typeof import("@xterm/headless");
const { SerializeAddon } =
  require("@xterm/addon-serialize") as typeof import("@xterm/addon-serialize");

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;
const DEFAULT_SCROLLBACK = 10_000;

export type PtyId = string;

export interface PtySpawnOpts {
  /** Optional pre-chosen id. If absent, the host generates one. */
  id?: PtyId;
  /** Program to spawn (e.g. `/bin/bash`, `/bin/zsh`). */
  shell: string;
  /** Args to the program (rcfile redirects, --rcfile flags, etc.). */
  args?: string[];
  /** Environment for the spawned child. The caller layers Kolu identity
   *  + shell-init env on top of cleanEnv() before passing in. */
  env: Record<string, string>;
  /** Starting working directory. */
  cwd: string;
  cols?: number;
  rows?: number;
  /** Per-PTY scrollback override; defaults to `defaultScrollback`. */
  scrollback?: number;
  /** Optional shell-init cleanup (e.g. remove temp ZDOTDIR). Called on
   *  PTY disposal — fire-and-forget, errors logged at warn level. */
  onDispose?: () => void;
}

export interface PtySpawnResult {
  id: PtyId;
  pid: number;
}

export interface PtyAttachment {
  /** Serialized screen state at attach time — VT escape sequences ready
   *  to feed back into an xterm.js client. Empty string if the PTY is
   *  brand-new (no output yet). */
  snapshot: string;
  /** Live data deltas after the snapshot. Stops when the iterator is
   *  returned, the signal aborts, or the PTY exits. */
  deltas: AsyncIterable<string>;
}

export interface PtyListEntry {
  id: PtyId;
  pid: number;
  cwd: string;
  /** epoch ms of last data observed (proxy for idle-TTL eviction). */
  lastActivity: number;
}

export interface PtyHost {
  /** Spawn a new PTY. Returns immediately once node-pty has the child. */
  spawn(opts: PtySpawnOpts): PtySpawnResult;

  /** Attach to an existing PTY. First yield is the screen snapshot
   *  string; subsequent yields are live data chunks. Returns a Promise
   *  because the snapshot may need to be serialized lazily. */
  attach(id: PtyId, signal?: AbortSignal): Promise<PtyAttachment>;

  /** Per-PTY cwd update stream. Yields the new cwd on every OSC 7. */
  subscribeCwd(id: PtyId, signal?: AbortSignal): AsyncIterable<string>;

  /** Per-PTY title update stream. */
  subscribeTitle(id: PtyId, signal?: AbortSignal): AsyncIterable<string>;

  /** Per-PTY preexec command stream (OSC 633;E payloads). */
  subscribeCommandRun(id: PtyId, signal?: AbortSignal): AsyncIterable<string>;

  /** Promise that resolves with the exit code when the PTY child exits.
   *  Already-exited PTYs resolve immediately with the cached code. */
  exitPromise(id: PtyId): Promise<number>;

  /** Write to the PTY (keystrokes or pasted text). */
  write(id: PtyId, data: string): void;

  /** Resize the PTY grid + the mirror @xterm/headless instance. */
  resize(id: PtyId, cols: number, rows: number): void;

  /** Kill the PTY and tear down its subscribers. */
  kill(id: PtyId, signal?: NodeJS.Signals): void;

  /** Snapshot of all live PTYs. */
  list(): PtyListEntry[];

  /** Current foreground-pid (for kolu's agent detection). */
  getForegroundPid(id: PtyId): number | undefined;

  /** Current cwd (for seeding `terminalMetadata`'s `cwd` field). */
  getCwd(id: PtyId): string | undefined;

  /** Dispose every PTY and close every channel. */
  dispose(): void;
}

export interface PtyHostOptions {
  log: Logger;
  defaultScrollback?: number;
  /** Id generator — override for deterministic tests. */
  generateId?: () => PtyId;
}

/** Extract plain text from an @xterm/headless buffer within a line
 *  range. Re-exported for callers that want to grep PTY output without
 *  reaching for SerializeAddon. */
export function getScreenText(
  buffer: {
    length: number;
    getLine(
      i: number,
    ): { translateToString(trimRight: boolean): string } | undefined;
  },
  startLine?: number,
  endLine?: number,
): string {
  const start = Math.max(0, startLine ?? 0);
  const end = Math.min(buffer.length, endLine ?? buffer.length);
  const lines: string[] = [];
  for (let i = start; i < end; i++) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? "");
  }
  return lines.join("\n");
}

/** Discriminated union of all per-PTY events the host emits. Currently
 *  used internally for the disposal cascade; exported in case
 *  downstream code wants a single aggregated event stream. */
export type PtyEvent =
  | { kind: "data"; chunk: string }
  | { kind: "cwd"; value: string }
  | { kind: "title"; value: string }
  | { kind: "commandRun"; value: string }
  | { kind: "exit"; exitCode: number };

interface Entry {
  id: PtyId;
  proc: pty.IPty;
  headless: import("@xterm/headless").Terminal;
  serialize: import("@xterm/addon-serialize").SerializeAddon;
  cwd: string;
  lastActivity: number;
  /** Cached exit code; undefined until `onExit` fires. */
  exitCode: number | undefined;
  /** Resolvers waiting on `exitPromise(id)`. */
  exitWaiters: ((code: number) => void)[];
  /** Disposable handles registered during construction. */
  disposables: { dispose(): void }[];
  dataChannel: Channel<string>;
  cwdChannel: Channel<string>;
  titleChannel: Channel<string>;
  commandRunChannel: Channel<string>;
  onDispose: (() => void) | undefined;
}

export function createPtyHost(opts: PtyHostOptions): PtyHost {
  const { log } = opts;
  const defaultScrollback = opts.defaultScrollback ?? DEFAULT_SCROLLBACK;
  const generateId = opts.generateId ?? randomUUID;
  const entries = new Map<PtyId, Entry>();

  function getEntry(id: PtyId): Entry {
    const entry = entries.get(id);
    if (!entry) throw new Error(`pty-host: unknown id ${id}`);
    return entry;
  }

  function disposeEntry(entry: Entry, exitCode: number | undefined): void {
    if (exitCode !== undefined) entry.exitCode = exitCode;
    for (const waiter of entry.exitWaiters.splice(0)) {
      waiter(exitCode ?? -1);
    }
    for (const d of entry.disposables) {
      try {
        d.dispose();
      } catch (err) {
        log.warn(
          { err: (err as Error).message, id: entry.id },
          "pty-host: disposable threw",
        );
      }
    }
    entry.disposables.length = 0;
    entry.dataChannel.close();
    entry.cwdChannel.close();
    entry.titleChannel.close();
    entry.commandRunChannel.close();
    try {
      entry.headless.dispose();
    } catch (err) {
      log.warn(
        { err: (err as Error).message, id: entry.id },
        "pty-host: headless dispose threw",
      );
    }
    if (entry.onDispose) {
      try {
        entry.onDispose();
      } catch (err) {
        log.warn(
          { err: (err as Error).message, id: entry.id },
          "pty-host: onDispose threw",
        );
      }
    }
    entries.delete(entry.id);
  }

  function spawn(spawnOpts: PtySpawnOpts): PtySpawnResult {
    const id = spawnOpts.id ?? generateId();
    if (entries.has(id)) {
      throw new Error(`pty-host: id ${id} already in use`);
    }
    const cols = spawnOpts.cols ?? DEFAULT_COLS;
    const rows = spawnOpts.rows ?? DEFAULT_ROWS;
    const scrollback = spawnOpts.scrollback ?? defaultScrollback;

    log.debug(
      { id, shell: spawnOpts.shell, cwd: spawnOpts.cwd },
      "pty-host: spawning",
    );
    const proc = pty.spawn(spawnOpts.shell, spawnOpts.args ?? [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: spawnOpts.cwd,
      env: spawnOpts.env,
    });

    // Sanity-check the node-pty fork's foregroundPid accessor.
    if (
      typeof (proc as unknown as { foregroundPid?: unknown }).foregroundPid !==
      "number"
    ) {
      proc.kill();
      throw new Error(
        "pty-host: node-pty.foregroundPid accessor missing — fork patch regressed",
      );
    }

    const headless = new Terminal({
      cols,
      rows,
      scrollback,
      allowProposedApi: true,
    });
    const serializeAddon = new SerializeAddon();
    headless.loadAddon(serializeAddon);

    const entry: Entry = {
      id,
      proc,
      headless,
      serialize: serializeAddon,
      cwd: spawnOpts.cwd,
      lastActivity: Date.now(),
      exitCode: undefined,
      exitWaiters: [],
      disposables: [],
      dataChannel: new Channel<string>(),
      cwdChannel: new Channel<string>(),
      titleChannel: new Channel<string>(),
      commandRunChannel: new Channel<string>(),
      onDispose: spawnOpts.onDispose,
    };
    entries.set(id, entry);

    // OSC 7 — cwd reporting.
    const oscDisposable = headless.parser.registerOscHandler(
      7,
      (data: string) => {
        try {
          const url = new URL(data);
          if (url.protocol === "file:") {
            entry.cwd = decodeURIComponent(url.pathname);
            entry.cwdChannel.publish(entry.cwd);
          }
        } catch {
          // Ignore malformed OSC 7
        }
        return true;
      },
    );
    entry.disposables.push(oscDisposable);

    // OSC 0/2 — title changes.
    const titleDisposable = headless.onTitleChange((title: string) => {
      entry.titleChannel.publish(title);
    });
    entry.disposables.push(titleDisposable);

    // OSC 633;E — preexec command.
    const commandMarkDisposable = headless.parser.registerOscHandler(
      633,
      (data: string) => {
        if (!data.startsWith("E;")) return false;
        entry.commandRunChannel.publish(data.slice(2));
        return true;
      },
    );
    entry.disposables.push(commandMarkDisposable);

    // Forward DA1/DSR responses from headless back to the PTY (filtering
    // out OSC echoes that programs don't consume).
    const headlessOnData = headless.onData((data: string) => {
      if (data.startsWith("\x1b]")) return;
      proc.write(data);
    });
    entry.disposables.push(headlessOnData);

    // PTY data → headless mirror + fan-out to subscribers.
    const dataDisposable = proc.onData((data: string) => {
      entry.lastActivity = Date.now();
      headless.write(data);
      entry.dataChannel.publish(data);
    });
    entry.disposables.push(dataDisposable);

    // PTY exit — record code, wake waiters, dispose channels (deferred
    // by one tick so any final data flush lands in subscribers first).
    const exitDisposable = proc.onExit(({ exitCode }) => {
      log.debug({ id, exitCode }, "pty-host: child exited");
      // Defer disposal so the last data chunk reaches subscribers.
      setImmediate(() => disposeEntry(entry, exitCode));
    });
    entry.disposables.push(exitDisposable);

    log.info({ id, pid: proc.pid }, "pty-host: spawned");
    return { id, pid: proc.pid };
  }

  async function attach(
    id: PtyId,
    signal?: AbortSignal,
  ): Promise<PtyAttachment> {
    const entry = getEntry(id);
    const snapshot = entry.serialize.serialize();
    const deltas = entry.dataChannel.subscribe(signal);
    return { snapshot, deltas };
  }

  function subscribeCwd(
    id: PtyId,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    return getEntry(id).cwdChannel.subscribe(signal);
  }

  function subscribeTitle(
    id: PtyId,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    return getEntry(id).titleChannel.subscribe(signal);
  }

  function subscribeCommandRun(
    id: PtyId,
    signal?: AbortSignal,
  ): AsyncIterable<string> {
    return getEntry(id).commandRunChannel.subscribe(signal);
  }

  function exitPromise(id: PtyId): Promise<number> {
    const entry = entries.get(id);
    if (!entry) return Promise.resolve(-1);
    if (entry.exitCode !== undefined) return Promise.resolve(entry.exitCode);
    return new Promise<number>((resolve) => {
      entry.exitWaiters.push(resolve);
    });
  }

  function write(id: PtyId, data: string): void {
    const entry = entries.get(id);
    if (!entry || entry.exitCode !== undefined) return;
    entry.proc.write(data);
  }

  function resize(id: PtyId, cols: number, rows: number): void {
    const entry = entries.get(id);
    if (!entry || entry.exitCode !== undefined) return;
    entry.proc.resize(cols, rows);
    entry.headless.resize(cols, rows);
  }

  function kill(id: PtyId, sig?: NodeJS.Signals): void {
    const entry = entries.get(id);
    if (!entry) return;
    try {
      entry.proc.kill(sig);
    } catch (err) {
      log.warn(
        { err: (err as Error).message, id },
        "pty-host: kill threw (already exited?)",
      );
    }
  }

  function list(): PtyListEntry[] {
    return [...entries.values()].map((e) => ({
      id: e.id,
      pid: e.proc.pid,
      cwd: e.cwd,
      lastActivity: e.lastActivity,
    }));
  }

  function getForegroundPid(id: PtyId): number | undefined {
    const entry = entries.get(id);
    if (!entry) return undefined;
    const fg = (entry.proc as unknown as { foregroundPid?: number })
      .foregroundPid;
    return fg && fg > 0 ? fg : undefined;
  }

  function getCwd(id: PtyId): string | undefined {
    return entries.get(id)?.cwd;
  }

  function dispose(): void {
    for (const entry of [...entries.values()]) {
      try {
        entry.proc.kill();
      } catch {
        // Already dead; fall through to manual cleanup.
      }
      disposeEntry(entry, undefined);
    }
  }

  return {
    spawn,
    attach,
    subscribeCwd,
    subscribeTitle,
    subscribeCommandRun,
    exitPromise,
    write,
    resize,
    kill,
    list,
    getForegroundPid,
    getCwd,
    dispose,
  };
}
