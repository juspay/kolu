/**
 * THE ENVIRONMENT A TERMINAL'S SHELL ENDS UP WITH — read by running that
 * terminal's own spawn once more, as `<shell> … -i -c <print the env>`.
 *
 * A launch in a kolu terminal runs AFTER the person's shell has read their
 * dotfiles (kolu-pty's wrapper rcfile replays them), so a variable only an rc
 * file exports — an API key, a gateway URL — is there for the launch. A
 * question about that launch ("which models would this harness offer if
 * started here?") asked from padi's own process environment misses it, and on
 * a host whose key lives in `~/.bashrc` it can never be answered. So it is
 * asked in this environment instead.
 *
 * ONE RULE FOR WHAT A TERMINAL GETS. The spawn input is the caller's —
 * `composeSpawnInput`, the function that composes every terminal's — and its
 * wrapper files are written by kaval's own materialiser. Nothing here decides
 * what a shell reads; it only runs the spawn non-interactively and reads what
 * the shell's environment is when it gets to the command.
 *
 * The environment travels on FILE DESCRIPTOR 3, printed by this process's own
 * node, so whatever an rc file prints on stdout (a banner, a fortune) cannot
 * be mistaken for it. A shell that cannot be asked — it exits non-zero, hangs,
 * or never reaches the command — is a failure in its own words, never a quiet
 * return to the bare environment.
 *
 * ASKING IS NOT SPAWNING, in three ways this module owns:
 *
 *  - only a shell kolu WRAPS can be asked (`kolu-pty`'s `isShellKoluWraps`):
 *    `-i -c` is this module's own appendix, and a shell that takes neither
 *    flag would answer a flag-parsing error for every harness. Refused by
 *    name, before anything is spawned;
 *  - the shell runs in its OWN SESSION (`detached`, i.e. `setsid`), so what an
 *    rc file started dies with it and no `/dev/tty` prompt can hang it or eat
 *    the keystrokes of whoever started padi from a terminal. A capture that
 *    does not answer in time, or whose caller withdrew the question, is ended
 *    by the SIGTERM→SIGKILL ladder on the whole group — the same ladder
 *    `@kolu/acp-harness`'s `child.ts` runs for a child it holds a handle to;
 *  - what is ANSWERED is what the person's shell contributed. kolu's own
 *    per-spawn plumbing ({@link withoutSpawnPlumbing}) is dropped: this
 *    capture is not a terminal, and nothing started from its environment may
 *    be told it lives in one.
 *
 * WHAT THE PERSON'S SHELL PRINTED IS THE PERSON'S. It is carried only in the
 * failure's own words (shown in the form that asked), capped on the way in
 * and on the way out, and no captured byte is ever embedded in the message by
 * any other path — a dotfile with `set -x` prints secrets there.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { shellJoin } from "@kolu/shell-quote";
import { Schema } from "effect";
import { type PtyHostSpawnInput, removeInitFiles, writeInitFiles } from "kaval";
import { isShellKoluWraps } from "kolu-pty";

/** A shell that reads its dotfiles may fetch, compile or wait on a slow mount
 *  the first time; a terminal opening there would wait as long. */
export const SHELL_ENV_TIMEOUT_MS = 60_000;

/** How long the shell's group gets after SIGTERM before SIGKILL. A shell
 *  started with `-i` ignores SIGTERM, so this leg usually expires. */
const GRACE_MS = 2_000;

/** ... and how long SIGKILL itself gets before the call answers anyway: a
 *  process the kernel was asked to destroy and has not is a hang, and the
 *  caller is owed an answer either way. */
const KILL_MS = 1_000;

/** The most of the shell's stderr kept, as a rolling tail — only the last
 *  lines are ever used, and an rc file with `set -x` prints megabytes. */
const STDERR_CAP = 8 * 1024;

/** ... and the most of it that reaches the failure's words. */
const SAID_CAP = 1_000;

/** The most fd 3 may print. A terminal's environment is kilobytes; more than
 *  this is a shell printing something else, and reading it is a refusal in
 *  its own right rather than a buffer that grows until padi dies. */
const PRINTED_CAP = 512 * 1024;

/** What `-c` runs: this process's node, writing its environment to fd 3. */
const PRINT_ENV = `require("node:fs").writeSync(3, JSON.stringify(process.env))`;

/** The id an asking spawn's wrapper files are named by — never a terminal's
 *  (`<prefix>-<uuid>` cannot collide with a terminal id kolu mints). */
export const shellEnvSpawnId = (): string => `shell-env-${randomUUID()}`;

/** The last lines of what the shell said on stderr: the words a failure is
 *  told in, capped. An interactive shell with no terminal always says it has
 *  no job control, so that is not news. */
function lastWords(stderr: string): string {
  return stderr
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(
      (line) =>
        line !== "" &&
        !line.includes("no job control in this shell") &&
        !line.includes("cannot set terminal process group"),
    )
    .slice(-6)
    .join("\n")
    .slice(-SAID_CAP);
}

/** THE CAPTURED ENVIRONMENT, as a shape somebody checked: fd 3 carries what
 *  this module's own node printed, but an rc file's `>&3` writes there too.
 *  Its failure is never shown — a decoder's message quotes the value it
 *  refused, and that value is the person's environment. */
const decodeShellEnv = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.String),
);

/** THE SHELL COULD NOT BE ASKED — the one failure this module answers, in
 *  words naming the shell. Its own class, so a caller turns exactly this into
 *  its refusal and lets a defect stay a defect. */
export class ShellEnvUnreadable extends Error {
  override readonly name = "ShellEnvUnreadable";
}

/** WHAT THE PERSON'S SHELL CONTRIBUTED — `captured` minus what
 *  `composeSpawnInput` stamped for THIS spawn alone: every variable whose
 *  value names this spawn's id (`ZDOTDIR`, pointing at a wrapper directory
 *  already removed; `KAVAL_TERMINAL_ID`, naming a terminal that never
 *  existed), where the shell left it as it was handed. A dotfile that set one
 *  of them itself wrote a different value, and that one is the person's and
 *  stays. NOTHING IS RESTORED in its place: a spawn starts from `cleanEnv()`,
 *  whose allowlist carries neither `ZDOTDIR` nor a `KAVAL_` name, so there is
 *  no earlier value kolu overrode — the variable is simply not the person's.
 *  The rule is read off the spawn rather than a list of names, so a per-spawn
 *  variable added later is dropped without anyone remembering to add it. */
function withoutSpawnPlumbing(
  asked: {
    readonly id: string;
    readonly env: Readonly<Record<string, string>>;
  },
  captured: Record<string, string>,
): Record<string, string> {
  const person = { ...captured };
  for (const [key, stamped] of Object.entries(asked.env))
    if (stamped.includes(asked.id) && person[key] === stamped)
      delete person[key];
  return person;
}

/** The environment `input`'s shell has once it has read its rc files, with
 *  `input`'s wrapper files written under `rcDir` for the run and removed after
 *  it. Rejects, naming the shell, when the shell cannot be asked: a shell kolu
 *  cannot ask at all, one that fails, one that does not answer within
 *  `bounds.timeoutMs`, and one whose caller withdrew the question
 *  (`bounds.signal`) — in every case with nothing of that group left alive. */
export function readShellEnv(
  input: PtyHostSpawnInput,
  rcDir: string,
  bounds: { readonly timeoutMs: number; readonly signal: AbortSignal },
): Promise<Record<string, string>> {
  const [shell, ...args] = input.argv;
  if (shell === undefined)
    throw new Error("readShellEnv: a terminal spawn with no shell to ask");
  const { id } = input;
  if (id === undefined)
    throw new Error("readShellEnv: a terminal spawn with no id of its own");
  const failed = (how: string) =>
    new ShellEnvUnreadable(
      `kolu could not read the environment a terminal here gets from ${shell}: ${how}`,
    );
  // NOTHING IS SPAWNED for a shell kolu cannot ask: `-i -c` below is this
  // module's appendix to the terminal's own argv, and a shell that takes
  // neither would answer a flag-parsing error for every harness instead.
  if (!isShellKoluWraps(shell))
    return Promise.reject(failed("it is not a shell kolu can ask for one"));
  const written = writeInitFiles(rcDir, input.initFiles);
  const { promise, resolve, reject } =
    Promise.withResolvers<Record<string, string>>();
  const child = spawn(
    shell,
    [
      ...args,
      "-i",
      "-c",
      `exec ${shellJoin([process.execPath, "-e", PRINT_ENV])}`,
    ],
    {
      cwd: input.cwd,
      env: input.env,
      stdio: ["ignore", "ignore", "pipe", "pipe"],
      // Its own session: the group is what the ladder below signals, and the
      // shell has no controlling terminal to read a prompt from.
      detached: true,
    },
  );
  /** The whole group, so what an rc file started goes with the shell. ESRCH
   *  is success — it is already gone. */
  const signalGroup = (signal: NodeJS.Signals): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ESRCH") throw cause;
    }
  };
  const timers: NodeJS.Timeout[] = [];
  const later = (ms: number, act: () => void): void => {
    timers.push(setTimeout(act, ms));
  };
  let settled = false;
  /** ANSWER ONCE, and leave nothing behind: every timer cleared, the wrapper
   *  files removed, the group gone (a descendant can outlive the leader). */
  const finish = (act: () => void): void => {
    if (settled) return;
    settled = true;
    for (const timer of timers) clearTimeout(timer);
    bounds.signal.removeEventListener("abort", withdrawn);
    signalGroup("SIGKILL");
    removeInitFiles(rcDir, written);
    act();
  };
  /** SIGTERM the group, SIGKILL it if that did not take. */
  const stopGroup = (): void => {
    signalGroup("SIGTERM");
    later(GRACE_MS, () => signalGroup("SIGKILL"));
  };
  function withdrawn(): void {
    // NOBODY IS WAITING for this answer any more — the harness changed in the
    // form, the tab closed — so the group is not asked politely first:
    // `finish` kills it outright and the call answers at once.
    finish(() =>
      reject(failed("the question was withdrawn before it was answered")),
    );
  }

  const stderr: Buffer[] = [];
  let stderrBytes = 0;
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
    stderrBytes += chunk.length;
    // A rolling tail: the oldest chunk goes, so the LAST words survive.
    while (stderrBytes > STDERR_CAP && stderr.length > 1) {
      const oldest = stderr.shift();
      stderrBytes -= oldest === undefined ? 0 : oldest.length;
    }
  });
  const printed: Buffer[] = [];
  let printedBytes = 0;
  let flooded = false;
  const fd3 = child.stdio[3];
  if (fd3 === null || fd3 === undefined || !("on" in fd3)) {
    signalGroup("SIGKILL");
    removeInitFiles(rcDir, written);
    throw new Error("readShellEnv: the spawn has no fd 3 to read");
  }
  fd3.on("data", (chunk: Buffer) => {
    printedBytes += chunk.length;
    if (printedBytes > PRINTED_CAP) {
      flooded = true;
      stopGroup();
      return;
    }
    printed.push(chunk);
  });
  child.on("error", (err) => {
    finish(() => reject(failed(`it could not be started: ${err.message}`)));
  });

  let timedOut = false;
  const tookTooLong = `it did not answer within ${bounds.timeoutMs / 1000}s`;
  later(bounds.timeoutMs, () => {
    timedOut = true;
    stopGroup();
    // The call answers even if the group never closes: SIGKILL has been
    // asked for by then, and a caller waiting on a kernel is owed the words
    // all the same.
    later(GRACE_MS + KILL_MS, () => finish(() => reject(failed(tookTooLong))));
  });
  if (bounds.signal.aborted) withdrawn();
  else bounds.signal.addEventListener("abort", withdrawn, { once: true });

  child.on("close", (code, signal) => {
    const said = lastWords(Buffer.concat(stderr).toString("utf8"));
    const tail = said === "" ? "" : `:\n${said}`;
    finish(() => {
      if (timedOut) {
        reject(failed(`${tookTooLong}${tail}`));
        return;
      }
      if (flooded) {
        reject(
          failed(
            `it printed more than ${PRINTED_CAP / 1024}K where an environment goes`,
          ),
        );
        return;
      }
      if (signal !== null) {
        reject(
          failed(
            `it was stopped by ${signal} before it ran the command${tail}`,
          ),
        );
        return;
      }
      if (code !== 0) {
        reject(failed(`it exited ${code} before it ran the command${tail}`));
        return;
      }
      const text = Buffer.concat(printed).toString("utf8");
      if (text === "") {
        reject(failed(`it never ran the command${tail}`));
        return;
      }
      // NOTHING OF WHAT WAS PRINTED REACHES THE MESSAGE: an rc file's `>&3`
      // lands here, and so does a secret it echoed. The decoder's own words
      // quote what they refused, so they are dropped with it.
      let captured: Record<string, string>;
      try {
        captured = { ...decodeShellEnv(JSON.parse(text)) };
      } catch {
        reject(
          failed(`it printed something that is not an environment${tail}`),
        );
        return;
      }
      resolve(withoutSpawnPlumbing({ id, env: input.env }, captured));
    });
  });
  return promise;
}
