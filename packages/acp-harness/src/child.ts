/**
 * A subprocess, as one socket.
 *
 * Node's `spawn` returns before the exec has happened, so a `try` around the
 * call never sees the failure that actually happens — a bad interpreter line, a
 * path that stopped existing between being baked and being started, an
 * architecture this host cannot run. That failure arrives as an `error` EVENT,
 * and two things hang on somebody listening for it: an unhandled one is an
 * uncaught exception that takes padi down, and every other door then reports
 * `Cannot call write after a stream was destroyed` in place of the name of the
 * file that would not run. Both listeners are attached on the line AFTER
 * `spawn`, never later, so a caller may race {@link Child.unstartable} against
 * its own handshake and the sentence a person reads is the one about their
 * machine.
 *
 * The rest of the socket is the same axis: attach the close listener at spawn
 * so a caller that asks after the child is gone is not waiting for an event
 * that will never come again; kill the process GROUP, because an adapter is
 * usually `node some/adapter.js` and the CLI it in turn spawns is the thing
 * holding the credential store open; give SIGTERM a grace period and make
 * SIGKILL the escalation rather than the opening.
 *
 * What is not here, deliberately: whether the child is READY (that is the ACP
 * handshake's answer), how its pipes become a protocol ({@link ./pipes.ts}),
 * and whether a dead one should be restarted (the harness's next verb boots).
 */

import { type StdioOptions, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { messageOf } from "./payloads.ts";

/** How long SIGTERM gets before SIGKILL. Long enough for an adapter that
 *  honours the signal and flushes its credential store, short enough that a
 *  wedged one cannot hold a padi shutdown open. */
const GRACE_MS = 2_000;

/** ... and how long SIGKILL itself is allowed to take. A process the kernel has
 *  been asked to destroy and has not is a hang, not a slow shutdown. */
const KILL_MS = 1_000;

/**
 * The child did not do what the wait asked, in the time it was given.
 *
 * A `false` after a deadline is how a hang becomes "expected false to be true"
 * in a test summary. Throwing puts the sentence in the failure instead.
 */
export class Hung extends Error {
  constructor(why: string) {
    super(why);
    this.name = "Hung";
  }
}

export interface Close {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface Start {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly stdio?: StdioOptions;
}

export interface Child {
  readonly stdin: Writable | null;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  /** Settles ONLY if the exec failed. A child that started never settles this,
   *  so a caller may race it against its own handshake without the loser ever
   *  deciding anything. */
  readonly unstartable: Promise<string>;
  /** The same fact as a value: the reason once it has arrived, `undefined`
   *  until then and forever for a child that started. */
  readonly failed: () => string | undefined;
  /** `close` — the process is gone AND its stdio has drained. Attached at
   *  spawn, so asking after the fact is not a wait for an event that has
   *  already happened. */
  readonly closed: Promise<Close>;
  /** SIGTERM, then SIGKILL after the grace. ESRCH is success: the child is
   *  already gone. */
  readonly stop: (opts?: { readonly graceMs?: number }) => Promise<Close>;
}

const isEsrch = (cause: unknown): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  (cause as { readonly code: unknown }).code === "ESRCH";

export const start = (
  file: string,
  args: ReadonlyArray<string> = [],
  options: Start = {},
): Child => {
  const stdio = options.stdio ?? ["pipe", "pipe", "pipe"];
  // ITS OWN PROCESS GROUP, always. The one child this package starts that is
  // not an ACP adapter is a sign-in command, and that one spawns a browser
  // opener and a CLI of its own; a kill that reached only the leader would
  // leave a login printing at nobody.
  const child = spawn(file, [...args], {
    cwd: options.cwd,
    env: options.env,
    stdio,
    detached: true,
  });

  // BOTH listeners on the line after spawn — see this file's header.
  let execFail: string | undefined;
  const unstartable = new Promise<string>((resolve) => {
    child.once("error", (cause) => {
      execFail = messageOf(cause);
      resolve(execFail);
    });
  });
  const closed = new Promise<Close>((resolve) => {
    child.on("close", (code, signal) =>
      resolve({ code: code ?? null, signal: signal ?? null }),
    );
  });

  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (cause) {
      if (!isEsrch(cause)) throw cause;
    }
  };

  const wait = (ms: number, why: string): Promise<Close> =>
    new Promise((resolve, reject) => {
      let settled = false;
      const finish = (act: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        act();
      };
      const timer = setTimeout(() => {
        finish(() => reject(new Hung(why)));
      }, ms);
      void closed.then((close) => finish(() => resolve(close)));
    });

  const stop = async (
    opts: { readonly graceMs?: number } = {},
  ): Promise<Close> => {
    if (execFail !== undefined) return { code: null, signal: null };
    signalGroup("SIGTERM");
    try {
      const close = await wait(
        opts.graceMs ?? GRACE_MS,
        `${file} did not stop after SIGTERM`,
      );
      // The leader can exit while a descendant keeps running with the same
      // redirected pipes, which on an ACP adapter is the agent CLI itself.
      signalGroup("SIGKILL");
      return close;
    } catch (cause) {
      if (!(cause instanceof Hung)) throw cause;
      signalGroup("SIGKILL");
      return await wait(KILL_MS, `${file} did not die after SIGKILL`);
    }
  };

  return {
    stdin: child.stdin,
    stdout: child.stdout,
    stderr: child.stderr,
    unstartable,
    failed: () => execFail,
    closed,
    stop,
  };
};

/** A spawned process's environment: this one's, plus what the adapter asked
 *  for, MINUS what it must not see.
 *
 *  A `delete` on a COPY and never on what was handed in: `process.env` is
 *  padi's own environment, an adapter is not entitled to edit it, and a
 *  mutation there would outlive the spawn for every later child of this
 *  daemon. */
export const childEnvOf = (
  base: NodeJS.ProcessEnv,
  extra: Readonly<Record<string, string>> | undefined,
  unset: ReadonlyArray<string> | undefined,
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...base, ...extra };
  for (const name of unset ?? []) delete env[name];
  return env;
};
