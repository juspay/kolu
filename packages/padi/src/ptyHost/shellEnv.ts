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
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { shellJoin } from "@kolu/shell-quote";
import { type PtyHostSpawnInput, removeInitFiles, writeInitFiles } from "kaval";

/** A shell that reads its dotfiles may fetch, compile or wait on a slow mount
 *  the first time; a terminal opening there would wait as long. */
export const SHELL_ENV_TIMEOUT_MS = 60_000;

/** What `-c` runs: this process's node, writing its environment to fd 3. */
const PRINT_ENV = `require("node:fs").writeSync(3, JSON.stringify(process.env))`;

/** The id an asking spawn's wrapper files are named by — never a terminal's
 *  (`<prefix>-<uuid>` cannot collide with a terminal id kolu mints). */
export const shellEnvSpawnId = (): string => `shell-env-${randomUUID()}`;

/** The last lines of what the shell said on stderr: the words a failure is
 *  told in. An interactive shell with no terminal always says it has no job
 *  control, so that is not news. */
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
    .join("\n");
}

/** THE SHELL COULD NOT BE ASKED — the one failure this module answers, in
 *  words naming the shell. Its own class, so a caller turns exactly this into
 *  its refusal and lets a defect stay a defect. */
export class ShellEnvUnreadable extends Error {
  override readonly name = "ShellEnvUnreadable";
}

/** The environment `input`'s shell has once it has read its rc files, with
 *  `input`'s wrapper files written under `rcDir` for the run and removed after
 *  it. Rejects, naming the shell, when the shell cannot be asked. */
export function readShellEnv(
  input: PtyHostSpawnInput,
  rcDir: string,
): Promise<Record<string, string>> {
  const [shell, ...args] = input.argv;
  if (shell === undefined)
    throw new Error("readShellEnv: a terminal spawn with no shell to ask");
  const failed = (how: string) =>
    new ShellEnvUnreadable(
      `kolu could not read the environment a terminal here gets from ${shell}: ${how}`,
    );
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
      timeout: SHELL_ENV_TIMEOUT_MS,
    },
  );
  const stderr: Buffer[] = [];
  const printed: Buffer[] = [];
  child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
  const fd3 = child.stdio[3];
  if (fd3 === null || fd3 === undefined || !("on" in fd3)) {
    child.kill();
    removeInitFiles(rcDir, written);
    throw new Error("readShellEnv: the spawn has no fd 3 to read");
  }
  fd3.on("data", (chunk: Buffer) => printed.push(chunk));
  child.on("error", (err) => {
    removeInitFiles(rcDir, written);
    reject(failed(`it could not be started: ${err.message}`));
  });
  child.on("close", (code, signal) => {
    removeInitFiles(rcDir, written);
    const said = lastWords(Buffer.concat(stderr).toString("utf8"));
    const tail = said === "" ? "" : `:\n${said}`;
    if (signal !== null) {
      reject(
        failed(
          `it was stopped by ${signal}${signal === "SIGTERM" ? ` after ${SHELL_ENV_TIMEOUT_MS / 1000}s` : ""} before it ran the command${tail}`,
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
    resolve(JSON.parse(text) as Record<string, string>);
  });
  return promise;
}
