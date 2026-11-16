/**
 * The child meter — one record per child process this Node process starts,
 * kept for the last minute, so a daemon can say which commands it ran, how
 * long each one blocked the start call, and how long each ran.
 *
 * ## Why at Node's spawn seam, not at the call sites
 *
 * Children are started in three ways in this tree: `node:child_process`
 * directly, `simple-git`, and `osfacts-client`. A wrapper at the call site
 * reaches only the first. Every ASYNC child in Node, whoever starts it, passes
 * through `ChildProcess.prototype.spawn(options)`, which receives
 * `options.file` / `options.args` and returns `0` or a negative errno. Wrapping
 * that one method covers every library and every future call site with no edit.
 *
 * It is an undocumented method, so {@link installChildMeter} THROWS when it is
 * not a function, and `child-meter.test.ts` starts a real child and asserts the
 * meter saw it: a Node release that moves the seam fails the build, not a user.
 *
 * `execFileSync` / `spawnSync` do not pass through it. A synchronous child is
 * metered at its call site with {@link meterSyncChild}.
 *
 * ## Scopes
 *
 * "Which call is this child part of" and "why did this child run" are ambient
 * by nature: nobody can thread a parameter through simple-git's task queue. A
 * caller runs its work inside {@link runInChildScope}; the spawn seam reads the
 * scope in force (one `AsyncLocalStorage`) and records the scope's `cause` and
 * adds to its tally.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { ChildProcess } from "node:child_process";
import path from "node:path";
import {
  type Measured,
  measured,
  summarizeTimings,
  type TimingSummary,
  unmeasured,
} from "./measured.ts";

/** How far back the meter answers for. Records of children that STARTED
 *  earlier are dropped on every write and every read, except children still
 *  running, which are counted whatever their age. */
export const CHILD_WINDOW_MS = 60_000;

/** A running total a scope collects from every child started inside it. */
export interface ChildTally {
  /** Children started inside the scope. */
  children: number;
  /** Summed start-to-exit time of those that have exited. */
  runMs: number;
}

export function createChildTally(): ChildTally {
  return { children: 0, runMs: 0 };
}

interface ChildScope {
  readonly cause: string | undefined;
  readonly tally: ChildTally | undefined;
}

const scopeStorage = new AsyncLocalStorage<ChildScope>();

/** Run `fn` with a cause and/or a tally in force for every child it starts —
 *  synchronously or on any continuation of it. A nested scope inherits what
 *  it does not set. */
export function runInChildScope<T>(
  scope: { readonly cause?: string; readonly tally?: ChildTally },
  fn: () => T,
): T {
  const outer = scopeStorage.getStore();
  return scopeStorage.run(
    {
      cause: scope.cause ?? outer?.cause,
      tally: scope.tally ?? outer?.tally,
    },
    fn,
  );
}

/** Subcommand words that make a kind, per program. The count is FIXED per
 *  program, so a branch name or a path can never become a kind. */
const SUBCOMMAND_WORDS: Readonly<Record<string, number>> = {
  git: 1,
  gh: 2,
  osfacts: 1,
};

/** Global options that take the NEXT argument as their value, per program. */
const VALUE_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  git: ["-c", "-C"],
};

/** The kind of a child, from its argv (argv[0] is the program): the program's
 *  basename, plus a fixed number of subcommand words for the programs in
 *  {@link SUBCOMMAND_WORDS}, skipping global options. `git -c k=v -C dir diff`
 *  is `git diff`, `/nix/store/…/bin/gh pr view b --json x` is `gh pr view`. */
export function childKind(argv: readonly string[]): string {
  const program = path.basename(argv[0] ?? "");
  const want = SUBCOMMAND_WORDS[program];
  if (want === undefined) return program;
  const valueOptions = VALUE_OPTIONS[program] ?? [];
  const words: string[] = [];
  for (let i = 1; i < argv.length && words.length < want; i++) {
    const arg = argv[i] ?? "";
    if (arg.startsWith("-")) {
      if (valueOptions.includes(arg)) i++;
      continue;
    }
    words.push(arg);
  }
  return [program, ...words].join(" ");
}

interface ChildRecord {
  readonly kind: string;
  /** `performance.now()` at the start call. */
  readonly startedAt: number;
  readonly startCallMs: number;
  readonly failedToStart: boolean;
  readonly cause: string | undefined;
  /** Start-to-exit, once exited. */
  runMs: number | undefined;
}

let installed = false;
/** Records of children started inside the window, in start order. */
const recent: ChildRecord[] = [];
/** Children started BEFORE the window that have not exited yet. */
const longRunning = new Set<ChildRecord>();

function prune(now: number): void {
  const cutoff = now - CHILD_WINDOW_MS;
  while (recent.length > 0 && (recent[0]?.startedAt ?? now) < cutoff) {
    const old = recent.shift() as ChildRecord;
    if (old.runMs === undefined && !old.failedToStart) longRunning.add(old);
  }
}

function record(
  kind: string,
  startedAt: number,
  startCallMs: number,
  failedToStart: boolean,
): ChildRecord {
  const scope = scopeStorage.getStore();
  const rec: ChildRecord = {
    kind,
    startedAt,
    startCallMs,
    failedToStart,
    cause: scope?.cause,
    runMs: undefined,
  };
  if (scope?.tally) scope.tally.children++;
  prune(startedAt + startCallMs);
  recent.push(rec);
  return rec;
}

function exited(rec: ChildRecord, tally: ChildTally | undefined): void {
  rec.runMs = performance.now() - rec.startedAt;
  longRunning.delete(rec);
  if (tally) tally.runMs += rec.runMs;
}

/** `ChildProcess.prototype.spawn` as Node calls it: the resolved program and
 *  its full argv (argv[0] included), answering `0` or a negative errno. */
type SpawnSeam = (
  this: ChildProcess,
  options: { file?: string; args?: readonly string[] },
) => number;

/** Wrap Node's spawn seam. Once per process, before anything starts a child;
 *  throws if the seam is missing (a Node release moved it) or the meter is
 *  already installed. */
export function installChildMeter(): void {
  if (installed) throw new Error("child meter: already installed");
  // Node's typings do not declare the seam; it is reached as what it is.
  const proto = ChildProcess.prototype as unknown as { spawn: unknown };
  const original = proto.spawn;
  if (typeof original !== "function") {
    throw new Error(
      "child meter: ChildProcess.prototype.spawn is not a function — this Node release moved the spawn seam",
    );
  }
  const spawnSeam = original as SpawnSeam;
  const meteredSpawn: SpawnSeam = function meteredSpawn(options) {
    const argv = options.args ?? (options.file ? [options.file] : []);
    const kind = childKind(argv);
    const startedAt = performance.now();
    const result = spawnSeam.call(this, options);
    const startCallMs = performance.now() - startedAt;
    const failedToStart = typeof result === "number" && result < 0;
    const rec = record(kind, startedAt, startCallMs, failedToStart);
    if (!failedToStart) {
      const tally = scopeStorage.getStore()?.tally;
      this.once("exit", () => exited(rec, tally));
    }
    return result;
  };
  proto.spawn = meteredSpawn;
  installed = true;
}

/** Run a SYNCHRONOUS child (`execFileSync`, `spawnSync`) and record it as one
 *  child of the kind {@link childKind} derives from `argv` — the same kind the
 *  spawn seam would give it. Its whole run blocks the loop, so the start call
 *  and the run are the same time. A throw is rethrown as-is; one that says the
 *  program does not exist (`ENOENT`) is a child that failed to start, any
 *  other (a non-zero exit, a timeout) a child that ran. */
export function meterSyncChild<T>(argv: readonly string[], fn: () => T): T {
  const kind = childKind(argv);
  const startedAt = performance.now();
  let failedToStart = false;
  try {
    return fn();
  } catch (err) {
    failedToStart = (err as NodeJS.ErrnoException).code === "ENOENT";
    throw err;
  } finally {
    const ms = performance.now() - startedAt;
    if (installed) {
      const rec = record(kind, startedAt, ms, failedToStart);
      if (!failedToStart) exited(rec, scopeStorage.getStore()?.tally);
    }
  }
}

export interface ChildCauseCount {
  readonly cause: string;
  readonly count: number;
}

export interface ChildKindRow {
  readonly kind: string;
  /** Children of this kind started in the window. */
  readonly started: number;
  /** Children of this kind running now, whatever their age. */
  readonly running: number;
  readonly failedToStart: number;
  /** Time inside the start call, of children started in the window. */
  readonly startCall: Measured<TimingSummary>;
  /** Start to exit, of children started in the window that have exited. */
  readonly run: Measured<TimingSummary>;
  /** Only for children whose caller stated a cause. */
  readonly causes: readonly ChildCauseCount[];
}

export interface ChildrenReading {
  readonly windowMs: number;
  /** Worst first: by summed start-call time. */
  readonly rows: readonly ChildKindRow[];
}

/** Per-kind rows for children started in the last {@link CHILD_WINDOW_MS}.
 *  Throws when the meter is not installed: "no children" from an unmetered
 *  process would be a lie. */
export function readChildren(): ChildrenReading {
  if (!installed) {
    throw new Error("child meter: not installed in this process");
  }
  prune(performance.now());
  interface Acc {
    started: number;
    running: number;
    failed: number;
    startCalls: number[];
    runs: number[];
    causes: Map<string, number>;
  }
  const byKind = new Map<string, Acc>();
  const acc = (kind: string): Acc => {
    let a = byKind.get(kind);
    if (!a) {
      a = {
        started: 0,
        running: 0,
        failed: 0,
        startCalls: [],
        runs: [],
        causes: new Map(),
      };
      byKind.set(kind, a);
    }
    return a;
  };
  for (const rec of recent) {
    const a = acc(rec.kind);
    a.started++;
    a.startCalls.push(rec.startCallMs);
    if (rec.failedToStart) a.failed++;
    else if (rec.runMs === undefined) a.running++;
    else a.runs.push(rec.runMs);
    if (rec.cause !== undefined) {
      a.causes.set(rec.cause, (a.causes.get(rec.cause) ?? 0) + 1);
    }
  }
  for (const rec of longRunning) acc(rec.kind).running++;
  const rows: (ChildKindRow & { sum: number })[] = [];
  for (const [kind, a] of byKind) {
    const startCall =
      a.startCalls.length > 0
        ? measured(summarizeTimings(a.startCalls))
        : unmeasured<TimingSummary>(
            "none started this minute; older ones still running",
          );
    rows.push({
      kind,
      started: a.started,
      running: a.running,
      failedToStart: a.failed,
      startCall,
      run:
        a.runs.length > 0
          ? measured(summarizeTimings(a.runs))
          : unmeasured(
              a.running > 0
                ? "none has exited yet"
                : "none started successfully in the window",
            ),
      causes: [...a.causes]
        .map(([cause, count]) => ({ cause, count }))
        .sort((x, y) => y.count - x.count),
      sum: startCall.kind === "measured" ? startCall.value.sumMs : 0,
    });
  }
  rows.sort((x, y) => y.sum - x.sum);
  return {
    windowMs: CHILD_WINDOW_MS,
    rows: rows.map(({ sum: _sum, ...row }) => row),
  };
}
