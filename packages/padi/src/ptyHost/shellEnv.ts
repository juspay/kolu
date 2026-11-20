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

const KILL_MS = 1_000;

const STDERR_CAP = 8 * 1024;

const SAID_CAP = 1_000;

const PRINTED_CAP = 512 * 1024;

const PRINT_ENV = `require("node:fs").writeSync(3, JSON.stringify(process.env))`;

/** The id an asking spawn's wrapper files are named by — never a terminal's
 *  (`<prefix>-<uuid>` cannot collide with a terminal id kolu mints). */
export const shellEnvSpawnId = (): string => `shell-env-${randomUUID()}`;

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

const decodeShellEnv = Schema.decodeUnknownSync(
  Schema.Record(Schema.String, Schema.String),
);

/** THE SHELL COULD NOT BE ASKED — the one failure this module answers, in
 *  words naming the shell. Its own class, so a caller turns exactly this into
 *  its refusal and lets a defect stay a defect. */
export class ShellEnvUnreadable extends Error {
  override readonly name = "ShellEnvUnreadable";
}

function isThisSpawnsPlumbing(
  stamped: string,
  captured: string | undefined,
  spawnId: string,
): boolean {
  return stamped.includes(spawnId) && captured === stamped;
}

function withoutSpawnPlumbing(
  asked: {
    readonly id: string;
    readonly env: Readonly<Record<string, string>>;
  },
  captured: Record<string, string>,
): Record<string, string> {
  const person = { ...captured };
  for (const [key, stamped] of Object.entries(asked.env))
    if (isThisSpawnsPlumbing(stamped, person[key], asked.id))
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
  const finish = (act: () => void): void => {
    if (settled) return;
    settled = true;
    for (const timer of timers) clearTimeout(timer);
    bounds.signal.removeEventListener("abort", withdrawn);
    signalGroup("SIGKILL");
    removeInitFiles(rcDir, written);
    act();
  };
  const stopGroup = (): void => {
    signalGroup("SIGTERM");
    later(GRACE_MS, () => signalGroup("SIGKILL"));
  };
  function withdrawn(): void {
    finish(() =>
      reject(failed("the question was withdrawn before it was answered")),
    );
  }

  const stderr: Buffer[] = [];
  let stderrBytes = 0;
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
    stderrBytes += chunk.length;
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
