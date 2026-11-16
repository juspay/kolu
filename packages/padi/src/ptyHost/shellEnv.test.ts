/**
 * ASKING A PERSON'S SHELL WHAT A TERMINAL HERE WOULD GET — the capture, held
 * to the four things it must survive: an rc file that writes its own junk on
 * fd 3, one that blocks and ignores SIGTERM, a caller that withdraws the
 * question, and a shell kolu cannot ask at all. Every one of them answers in
 * words, leaves no process of that shell's group alive, and carries nothing
 * of what the person's shell printed beyond its cap.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Effect, Fiber } from "effect";
import type { PtyHostSpawnInput, PtyHostSystemInfo } from "kaval";
import { CONTAINING_TERMINAL_ENV } from "kolu-pty";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composeSpawnInput, setSpawnServerVersion } from "./index.ts";
import { readShellEnv, ShellEnvUnreadable } from "./shellEnv.ts";

setSpawnServerVersion("9.9.9-test");

const BASH = execFileSync("sh", ["-c", "command -v bash"], {
  encoding: "utf8",
}).trim();

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A person's home whose `~/.bashrc` runs `lines` — behind the guard a NixOS
 *  or home-manager bashrc starts with, so only an interactive shell sees it. */
function homeRunning(lines: readonly string[]): string {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "shell-env-home-")));
  writeFileSync(
    join(home, ".bashrc"),
    ["[[ $- == *i* ]] || return", ...lines].join("\n"),
  );
  return home;
}

/** The spawn a new terminal in `home` gets, as padi composes it. */
function terminalSpawn(
  shell: string,
  home: string,
): { readonly input: PtyHostSpawnInput; readonly rcDir: string } {
  vi.stubEnv("SHELL", shell);
  vi.stubEnv("HOME", home);
  const rcDir = realpathSync(mkdtempSync(join(tmpdir(), "shell-env-rc-")));
  const info = {
    shell,
    home,
    platform: "linux",
    rcDir,
  } as PtyHostSystemInfo;
  return {
    rcDir,
    input: composeSpawnInput({ id: "shell-env-test", cwd: home }, info, {
      kavalSocket: join(rcDir, "kaval.sock"),
      toolsPath: [],
      serverVersion: "9.9.9-test",
    }),
  };
}

/** Whether signalling `target` says there is nobody there — a pid, or (when
 *  negative) a whole process group. */
function absent(target: number): boolean {
  try {
    process.kill(target, 0);
    return false;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "ESRCH";
  }
}

/** NOTHING OF THE SHELL IS LEFT: neither the shell itself nor the session it
 *  leads, which is what the capture promises for a question it has answered.
 *  Real time against real processes — the reap is the kernel's, and no fake
 *  clock performs it. */
async function gone(pid: number): Promise<boolean> {
  for (let left = 60; left > 0; left--) {
    if (absent(pid) && absent(-pid)) return true;
    await sleep(100);
  }
  return false;
}

/** The pid the rc file wrote, once it has. */
async function pidFrom(file: string): Promise<number> {
  for (let left = 100; left > 0; left--) {
    if (existsSync(file)) {
      const said = readFileSync(file, "utf8").trim();
      if (said !== "") return Number(said);
    }
    await sleep(50);
  }
  throw new Error(`the rc file never wrote its pid to ${file}`);
}

const never = new AbortController().signal;

describe("a shell kolu cannot ask", () => {
  it("is a failure naming the shell it was handed, with nothing spawned", async () => {
    const home = homeRunning([]);
    const ran = join(home, "ran");
    const fish = join(home, "fish");
    writeFileSync(fish, `#!/bin/sh\ntouch ${ran}\n`, { mode: 0o755 });
    const { input, rcDir } = terminalSpawn(fish, home);
    const failed = await readShellEnv(input, rcDir, {
      timeoutMs: 10_000,
      signal: never,
    }).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(ShellEnvUnreadable);
    expect((failed as ShellEnvUnreadable).message).toContain(fish);
    // Said BEFORE anything ran: a shell that takes neither `-i` nor `-c`
    // would otherwise answer a flag-parsing error for every harness.
    expect(existsSync(ran)).toBe(false);
  });
});

describe("what an rc file writes on fd 3", () => {
  it("is a failure in words, carrying none of what was written", async () => {
    const { input, rcDir } = terminalSpawn(
      BASH,
      homeRunning(["echo 'sk-live-leaked-by-set-x' >&3"]),
    );
    const failed = await readShellEnv(input, rcDir, {
      timeoutMs: 20_000,
      signal: never,
    }).catch((err: unknown) => err);
    // The daemon is still here — the decode happens where a throw would have
    // been an uncaught exception in a `close` listener.
    expect(failed).toBeInstanceOf(ShellEnvUnreadable);
    const words = (failed as ShellEnvUnreadable).message;
    expect(words).toContain("not an environment");
    expect(words).not.toContain("sk-live-leaked-by-set-x");
  });

  it("past the cap is a failure too, never a buffer that grows", async () => {
    const { input, rcDir } = terminalSpawn(
      BASH,
      // 2 MB on fd 3, which no terminal's environment is.
      homeRunning(["head -c 2000000 /dev/zero | tr '\\0' 'x' >&3"]),
    );
    const failed = await readShellEnv(input, rcDir, {
      timeoutMs: 20_000,
      signal: never,
    }).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(ShellEnvUnreadable);
    expect((failed as ShellEnvUnreadable).message).toContain(
      "printed more than",
    );
  });
});

describe("an rc file that blocks and ignores SIGTERM", () => {
  it("settles in words, and nothing of its group survives", async () => {
    const home = homeRunning([
      "trap '' TERM",
      'echo $$ > "$HOME/pid"',
      "sleep 1000",
    ]);
    const { input, rcDir } = terminalSpawn(BASH, home);
    const asked = readShellEnv(input, rcDir, {
      timeoutMs: 500,
      signal: never,
    }).catch((err: unknown) => err);
    const pid = await pidFrom(join(home, "pid"));
    const failed = await asked;
    expect(failed).toBeInstanceOf(ShellEnvUnreadable);
    expect((failed as ShellEnvUnreadable).message).toContain(
      "did not answer within",
    );
    expect(await gone(pid)).toBe(true);
    // ... and the wrapper files it was asked with are gone with it.
    expect(existsSync(join(rcDir, `bashrc-${input.id}`))).toBe(false);
  }, 30_000);
});

describe("a question withdrawn mid-flight", () => {
  it("kills the shell's group, through the Effect that was interrupted", async () => {
    const home = homeRunning(['echo $$ > "$HOME/pid"', "sleep 1000"]);
    const { input, rcDir } = terminalSpawn(BASH, home);
    // Exactly how `terminalShellEnv` runs it: the signal `Effect.tryPromise`
    // offers is the capture's own.
    const capture = Effect.tryPromise({
      try: (signal) =>
        readShellEnv(input, rcDir, { timeoutMs: 60_000, signal }),
      catch: (err: unknown) => err,
    });
    const fiber = Effect.runFork(capture);
    const pid = await pidFrom(join(home, "pid"));
    await Effect.runPromise(Fiber.interrupt(fiber));
    expect(await gone(pid)).toBe(true);
  }, 30_000);
});

describe("what a failure says of the shell's own output", () => {
  it("is capped, however much the rc file printed", async () => {
    const { input, rcDir } = terminalSpawn(
      BASH,
      homeRunning([
        "head -c 400000 /dev/zero | tr '\\0' 'y' >&2",
        "echo >&2",
        "exit 3",
      ]),
    );
    const failed = await readShellEnv(input, rcDir, {
      timeoutMs: 20_000,
      signal: never,
    }).catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(ShellEnvUnreadable);
    const words = (failed as ShellEnvUnreadable).message;
    expect(words).toContain("exited 3");
    expect(words.length).toBeLessThan(1_500);
  }, 30_000);
});

describe("the environment the answer carries", () => {
  it("is the person's, without kolu's per-spawn plumbing", async () => {
    const home = homeRunning([
      "export LITELLM_API_KEY=sk-from-bashrc",
      'export ZDOTDIR_OF_THEIR_OWN="$HOME/.zdot"',
    ]);
    const composed = terminalSpawn(BASH, home);
    // zsh's wrapper directory, as `prepareShellInit` stamps it for THIS
    // spawn — a directory `removeInitFiles` has deleted by the time anybody
    // reads the answer.
    const input: PtyHostSpawnInput = {
      ...composed.input,
      env: {
        ...composed.input.env,
        ZDOTDIR: join(composed.rcDir, `zdotdir-${composed.input.id}`),
      },
    };
    const env = await readShellEnv(input, composed.rcDir, {
      timeoutMs: 20_000,
      signal: never,
    });
    // What the person's shell contributed is all there ...
    expect(env.LITELLM_API_KEY).toBe("sk-from-bashrc");
    expect(env.ZDOTDIR_OF_THEIR_OWN).toBe(join(home, ".zdot"));
    expect(env.HOME).toBe(home);
    // ... and this spawn's own plumbing is not: a harness that starts zsh, or
    // asks kolu about "its terminal", is told nothing that was never true.
    expect(env.ZDOTDIR).toBeUndefined();
    expect(env[CONTAINING_TERMINAL_ENV]).toBeUndefined();
    expect(input.env[CONTAINING_TERMINAL_ENV]).toBe(input.id);
  }, 30_000);
});
