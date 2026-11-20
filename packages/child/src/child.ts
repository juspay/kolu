import {
  spawn,
  type ChildProcess,
  type StdioOptions,
} from "node:child_process";
import type { Readable, Writable } from "node:stream";

const GRACE_MS = 2_000;

const KILL_MS = 1_000;

/**
 * The child did not do what the wait asked, in the time it was given — and
 * what it SAID while not doing it.
 *
 * A boolean `false` after a deadline is how a hang becomes "expected false to
 * be true" in the runner's summary. Throwing here puts the sentence and the
 * child's own words in the failure, which is the whole of the wait discipline
 * the flake campaign (#347/#359/#361/#364) re-earned three times.
 */
export class Hung extends Error {
  readonly said: string;
  readonly out: string;
  readonly err: string;
  constructor(
    why: string,
    collected: {
      readonly said: string;
      readonly out: string;
      readonly err: string;
    },
  ) {
    const body = collected.said === "" ? "nothing said" : collected.said;
    super(`${why}:\n${body}`);
    this.name = "Hung";
    this.said = collected.said;
    this.out = collected.out;
    this.err = collected.err;
  }
}

export interface Close {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface Start {
  /** Give a command its own POSIX process group and stop its descendants too. */
  readonly processGroup?: boolean;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Default `["ignore", "pipe", "pipe"]`. */
  readonly stdio?: StdioOptions;
  /**
   * Drain these into the box so a pipe nobody reads cannot block the child.
   * Default: stderr when it is a pipe, not stdout — stdout is often a
   * protocol (ACP, JSON-RPC) and stealing it is worse than not logging it.
   * A one-shot ({@link run}) and a test that reads the serving line opt in.
   */
  readonly drain?: { readonly stdout?: boolean; readonly stderr?: boolean };
  /**
   * Cap on each drained stream. Overflow keeps the tail and raises
   * {@link Child.overrun}; {@link run} answers `ok: false` with that tail
   * quoted. Unset is unbounded. A silent truncate is how a parser of the
   * output would drop the head of a `git status` and still say `ok`.
   */
  readonly maxBuffer?: number;
}

export interface Child {
  readonly pid: number | undefined;
  readonly exitCode: number | null;
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  /** Every stdio slot by number, for a caller that asked for pipes past fd 2
   *  (Chromium's `--remote-debugging-pipe` speaks on fds 3 and 4). */
  readonly stdio: ReadonlyArray<Readable | Writable | null | undefined>;
  /**
   * Settles ONLY if the exec failed. A child that started never settles this,
   * so a caller may race it against its own conversation without the loser
   * ever deciding anything.
   */
  readonly unstartable: Promise<string>;
  /** The same fact, as a value: the reason once it has arrived, `undefined`
   *  until then and forever if the child started. */
  readonly failed: () => string | undefined;
  /** stdout and stderr that were drained, for the life of the process. */
  readonly said: () => string;
  readonly out: () => string;
  readonly err: () => string;
  /** True once a drained stream passed {@link Start.maxBuffer}. The box
   *  still holds the tail; {@link run} refuses rather than handing a parser
   *  a truncated `ok`. */
  readonly overrun: () => boolean;
  /** `close` — the process is gone AND its stdio has drained. Attached at spawn. */
  readonly closed: Promise<Close>;
  /**
   * The close, or {@link Hung} after `ms` with what the child said. The
   * listener is the one attached at spawn — attaching after the action is
   * the hazard this exists to not have.
   */
  readonly wait: (ms: number, why: string) => Promise<Close>;
  /**
   * SIGTERM (or `signal`), then SIGKILL if it is still there after the grace.
   * ESRCH is success: the child is already gone.
   */
  readonly stop: (opts?: {
    readonly graceMs?: number;
    readonly signal?: NodeJS.Signals;
  }) => Promise<Close>;
  /** One signal, no wait. Tests that then {@link Child.wait} use this. */
  readonly kill: (signal?: NodeJS.Signals) => void;
}

const reasonOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const isEsrch = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause as { readonly code: unknown }).code === "ESRCH";

const gone = (child: ChildProcess): boolean =>
  child.exitCode !== null || child.signalCode !== null;

const slotIsPipe = (stdio: StdioOptions | undefined, slot: 1 | 2): boolean => {
  if (stdio === undefined) return true;
  if (typeof stdio === "string") return stdio === "pipe";
  if (!Array.isArray(stdio)) return false;
  const item = stdio[slot];
  return item === "pipe" || item === undefined || item === null;
};

export const start = (
  file: string,
  args: ReadonlyArray<string> = [],
  options: Start = {},
): Child => {
  const stdio = options.stdio ?? ["ignore", "pipe", "pipe"];
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio,
    detached: options.processGroup === true,
  });

  const drainStdout = options.drain?.stdout ?? false;
  const drainStderr = options.drain?.stderr ?? slotIsPipe(stdio, 2);

  let out = "";
  let err = "";
  let overrun = false;
  const take = (which: "out" | "err", chunk: string): void => {
    if (which === "out") out += chunk;
    else err += chunk;
    const max = options.maxBuffer;
    if (max === undefined) return;
    if (out.length > max) {
      overrun = true;
      out = out.slice(-max);
    }
    if (err.length > max) {
      overrun = true;
      err = err.slice(-max);
    }
  };

  if (drainStdout && child.stdout !== null) {
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => take("out", chunk));
  }
  if (drainStderr && child.stderr !== null) {
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => take("err", chunk));
  }

  // BOTH listeners on the line after spawn. `unstartable` is the exec
  // failure; `closed` is the end. Attaching either later is how a caller
  // that asks after the fact waits for an event that will not come again,
  // or lets an unhandled `error` take the process down.
  let execFail: string | undefined;
  const unstartable = new Promise<string>((resolve) => {
    child.once("error", (cause) => {
      execFail = reasonOf(cause);
      resolve(execFail);
    });
  });
  const closed = new Promise<Close>((resolve) => {
    child.on("close", (code, signal) =>
      resolve({ code: code ?? null, signal: signal ?? null }),
    );
  });

  const collected = () => ({ said: `${out}${err}`, out, err });

  const kill = (signal: NodeJS.Signals = "SIGTERM"): void => {
    if (!options.processGroup && gone(child)) return;
    try {
      if (options.processGroup && child.pid !== undefined)
        process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (cause) {
      if (!isEsrch(cause)) throw cause;
    }
  };

  const wait = (ms: number, why: string): Promise<Close> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const finish = (act: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        act();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Hung(why, collected())));
      }, ms);
      void closed.then((close) => finish(() => resolve(close)));
    });

  const stop = async (
    opts: { readonly graceMs?: number; readonly signal?: NodeJS.Signals } = {},
  ): Promise<Close> => {
    if (!options.processGroup && gone(child)) return closed;
    const grace = opts.graceMs ?? GRACE_MS;
    kill(opts.signal ?? "SIGTERM");
    try {
      const result = await wait(
        grace,
        `${file} did not stop after ${opts.signal ?? "SIGTERM"}`,
      );
      // The leader can exit while a descendant keeps running with redirected I/O.
      if (options.processGroup) kill("SIGKILL");
      return result;
    } catch (cause) {
      if (!(cause instanceof Hung)) throw cause;
      kill("SIGKILL");
      return wait(KILL_MS, `${file} did not die after SIGKILL`);
    }
  };

  return {
    get pid() {
      return child.pid;
    },
    get exitCode() {
      return child.exitCode;
    },
    stdin: child.stdin,
    stdio: child.stdio,
    stdout: child.stdout,
    stderr: child.stderr,
    unstartable,
    failed: () => execFail,
    said: () => `${out}${err}`,
    out: () => out,
    err: () => err,
    overrun: () => overrun,
    closed,
    wait,
    stop,
    kill,
  };
};

export interface Said {
  readonly ok: boolean;
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly out: string;
  readonly err: string;
  /** stdout and stderr together, trimmed — what a log line quotes. Empty
   *  when the child said nothing AND it succeeded; the exec-failure or exit
   *  sentence when it failed silently. */
  readonly said: string;
}

export interface Run extends Start {
  /** Hang detector: {@link Hung} with what the child said. A caller that
   *  wants a timeout as an ANSWER (git: every outcome is a value) catches. */
  readonly timeout?: number;
}

/**
 * One-shot: start, drain both pipes, wait for close. Exec failure is an
 * answer (`ok: false`, the system's reason). A hang throws {@link Hung}.
 */
export const run = async (
  file: string,
  args: ReadonlyArray<string> = [],
  options: Run = {},
): Promise<Said> => {
  const child = start(file, args, {
    cwd: options.cwd,
    env: options.env,
    processGroup: options.processGroup,
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"],
    drain: { stdout: true, stderr: true },
    maxBuffer: options.maxBuffer,
  });
  const timeout = options.timeout;
  const finished = Promise.race([
    child.closed.then((close) => ({ kind: "closed" as const, close })),
    child.unstartable.then((why) => ({ kind: "failed" as const, why })),
  ]);
  let outcome: Awaited<typeof finished> | { readonly kind: "hung" };
  if (timeout === undefined) {
    outcome = await finished;
  } else {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      outcome = await Promise.race([
        finished,
        new Promise<{ readonly kind: "hung" }>((resolve) => {
          timer = setTimeout(() => resolve({ kind: "hung" }), timeout);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  const drained = child.said().trim();
  if (outcome.kind === "failed") {
    return {
      ok: false,
      code: child.exitCode,
      signal: null,
      out: child.out(),
      err: child.err(),
      said: drained || outcome.why,
    };
  }
  if (outcome.kind === "hung") {
    await child.stop();
    throw new Hung(`${file} did not finish within ${timeout}ms`, {
      said: child.said(),
      out: child.out(),
      err: child.err(),
    });
  }
  const failed = child.failed();
  if (failed !== undefined) {
    return {
      ok: false,
      code: outcome.close.code,
      signal: outcome.close.signal,
      out: child.out(),
      err: child.err(),
      said: drained || failed,
    };
  }
  if (child.overrun()) {
    const max = options.maxBuffer;
    return {
      ok: false,
      code: outcome.close.code,
      signal: outcome.close.signal,
      out: child.out(),
      err: child.err(),
      said: `${file} said more than ${max} bytes; tail quoted:\n${child.said()}`,
    };
  }
  return {
    ok: outcome.close.code === 0,
    code: outcome.close.code,
    signal: outcome.close.signal,
    out: child.out(),
    err: child.err(),
    said:
      drained ||
      (outcome.close.code === 0
        ? ""
        : `exited ${outcome.close.code ?? "none"}`),
  };
};

/**
 * A spawned process's environment: this one's, plus what the caller asked to
 * add, MINUS what it must not see.
 *
 * A `delete` on a COPY and never on what was handed in: `process.env` is the
 * host's own environment, a child is not entitled to edit it, and a mutation
 * there would outlive the spawn for every later child of this process.
 */
export const childEnvOf = (
  base: NodeJS.ProcessEnv,
  extra: Readonly<Record<string, string>> | undefined,
  unset: ReadonlyArray<string> | undefined,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...base, ...extra };
  for (const name of unset ?? []) delete env[name];
  return env;
};
