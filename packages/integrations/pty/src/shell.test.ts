/**
 * Unit tests for shell.ts OSC injection functions.
 *
 * Tests the shell functions by executing them in a real bash/zsh subprocess
 * and asserting on the escape sequences they emit.
 */

import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  cleanEnv,
  composeSpawnEnv,
  koluIdentityEnv,
  OSC2_PRECMD_BASH,
  OSC2_PRECMD_ZSH,
  OSC2_PREEXEC_BASH_GUARD,
  OSC2_PREEXEC_FN,
  OSC7_FN,
  prepareShellInit,
  SPAWN_ENV_ALLOWLIST,
  SPAWN_ENV_PRESENTATION,
} from "./shell.ts";

const shellSubprocessHome = mkdtempSync(
  join(tmpdir(), "kolu-shell-test-home-"),
);

afterAll(() => {
  bashRunner.close();
  zshRunner.close();
  rmSync(shellSubprocessHome, { recursive: true, force: true });
});

function shellSubprocessEnv(): NodeJS.ProcessEnv {
  return {
    HOME: shellSubprocessHome,
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TERM: "xterm-256color",
    TMPDIR: process.env.TMPDIR ?? tmpdir(),
  };
}

const shQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

class ShellRunner {
  private readonly child;
  private stdout = "";
  private stderr = "";
  private nextId = 0;
  private spawnError: NodeJS.ErrnoException | undefined;
  private pending:
    | {
        marker: string;
        resolve: (out: string) => void;
        reject: (err: Error) => void;
      }
    | undefined;
  private readonly queue: Array<{
    cwd: string;
    script: string;
    resolve: (out: string) => void;
    reject: (err: Error) => void;
  }> = [];

  constructor(
    private readonly command: string,
    args: string[],
  ) {
    this.child = spawn(command, args, {
      env: shellSubprocessEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => {
      this.stdout += chunk;
      this.drain();
    });
    this.child.stderr.on("data", (chunk: string) => {
      this.stderr += chunk;
    });
    this.child.on("exit", (code, signal) => {
      const err = new Error(
        `${this.command} exited unexpectedly: code=${code} signal=${signal}`,
      );
      this.rejectAll(err);
    });
    this.child.on("error", (err: NodeJS.ErrnoException) => {
      this.spawnError = err;
      this.rejectAll(err);
    });
  }

  run(script: string, cwd = "/tmp"): Promise<string> {
    if (this.spawnError) return Promise.reject(this.spawnError);
    return new Promise((resolve, reject) => {
      this.queue.push({ cwd, script, resolve, reject });
      this.pump();
    });
  }

  close(): void {
    if (this.spawnError) return;
    this.child.stdin.end("exit\n");
  }

  private pump(): void {
    if (this.pending || this.queue.length === 0) return;
    const job = this.queue.shift();
    if (!job) return;
    const marker = `__KOLU_SHELL_DONE_${process.pid}_${this.nextId++}__`;
    this.pending = {
      marker,
      resolve: job.resolve,
      reject: job.reject,
    };
    this.child.stdin.write(
      `(\ncd ${shQuote(job.cwd)} || exit\n${job.script}\n)\n` +
        `__kolu_status=$?\nprintf '${marker}:%s\\n' "$__kolu_status"\n`,
    );
  }

  private drain(): void {
    const job = this.pending;
    if (!job) return;
    const markerStart = this.stdout.indexOf(`${job.marker}:`);
    if (markerStart === -1) return;
    const statusStart = markerStart + job.marker.length + 1;
    const statusEnd = this.stdout.indexOf("\n", statusStart);
    if (statusEnd === -1) return;

    const out = this.stdout.slice(0, markerStart);
    const status = Number(this.stdout.slice(statusStart, statusEnd));
    const stderr = this.stderr;
    this.stdout = this.stdout.slice(statusEnd + 1);
    this.stderr = "";
    this.pending = undefined;

    if (status === 0) {
      job.resolve(out);
    } else {
      job.reject(
        new Error(`${this.command} script exited ${status}\n${stderr}`),
      );
    }
    this.pump();
    this.drain();
  }

  private rejectAll(err: Error): void {
    this.pending?.reject(err);
    for (const job of this.queue) job.reject(err);
    this.queue.length = 0;
    this.pending = undefined;
  }
}

const bashRunner = new ShellRunner("bash", ["--noprofile", "--norc"]);
const zshRunner = new ShellRunner("zsh", ["-f"]);

/** Run a script in a clean bash subshell and return stdout. */
function runBash(script: string, cwd = "/tmp"): Promise<string> {
  return bashRunner.run(script, cwd);
}

/** Run a script in a clean zsh subshell and return stdout. Skips if zsh unavailable. */
async function runZsh(script: string, cwd = "/tmp"): Promise<string | null> {
  try {
    return await zshRunner.run(script, cwd);
  } catch (err) {
    // zsh not installed — skip
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

describe("koluIdentityEnv", () => {
  it("returns Kolu's identity vars: TERM_PROGRAM, TERM_PROGRAM_VERSION, VTE_VERSION, COLORTERM", () => {
    const env = koluIdentityEnv("9.9.9");
    expect(env).toEqual({
      TERM_PROGRAM: "kolu",
      TERM_PROGRAM_VERSION: "9.9.9",
      VTE_VERSION: "7603",
      COLORTERM: "truecolor",
    });
  });

  it("asserts COLORTERM=truecolor so PTY tools emit 24-bit color escapes", () => {
    // kolu's xterm.js WebGL renderer displays 24-bit color, so the
    // assertion is honest. Unconditional (not passthrough) because a
    // GUI/launchd launch carries no parent COLORTERM to forward, yet the
    // renderer is just as capable — see koluIdentityEnv's doc comment.
    expect(koluIdentityEnv("9.9.9").COLORTERM).toBe("truecolor");
  });

  it("VTE_VERSION stomps a parent value when layered via Object.assign", () => {
    // Pins the intentional behavior change from `??=` in cleanEnv to
    // unconditional assignment via koluIdentityEnv: kolu isn't a VTE
    // terminal, so inheriting a stale parent VTE_VERSION would be a
    // bigger lie than the hardcoded shim. Guards against a future
    // refactor that quietly reintroduces inheritance.
    const layered: Record<string, string> = { VTE_VERSION: "9999" };
    Object.assign(layered, koluIdentityEnv("9.9.9"));
    expect(layered.VTE_VERSION).toBe("7603");
  });
});

describe("SPAWN_ENV_ALLOWLIST — the one shared allowlist, pinned exactly as data", () => {
  // The coordinator's rider: assert the EXACT contents as data so a future broad
  // key that reopens the #1872 identity-leak class fails a TEST, not review
  // vigilance. Every kolu spawn composer funnels through this one list.
  it("is exactly the narrow non-identity base (functional + presentation)", () => {
    expect([...SPAWN_ENV_ALLOWLIST]).toEqual([
      "HOME",
      "USER",
      "LOGNAME",
      "PATH",
      "SHELL",
      "DISPLAY",
      "TERM",
      "COLORTERM",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
    ]);
  });

  it("presentation subset is exactly the terminal/locale vars", () => {
    expect([...SPAWN_ENV_PRESENTATION]).toEqual([
      "TERM",
      "COLORTERM",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
    ]);
    // The presentation set is a subset of the full allowlist (no drift).
    for (const k of SPAWN_ENV_PRESENTATION) {
      expect(SPAWN_ENV_ALLOWLIST).toContain(k);
    }
  });

  it("no identity var can ride the allowlist — CLAUDE_CODE_* / secrets are not in it", () => {
    for (const forbidden of [
      "CLAUDE_CODE_CHILD_SESSION",
      "CLAUDECODE",
      "CLAUDE_CODE_SESSION_ID",
      "AWS_SECRET_ACCESS_KEY",
      "KOLU_KAVAL_BIN",
      "KAVAL_BUILD_ID",
    ]) {
      expect(SPAWN_ENV_ALLOWLIST).not.toContain(forbidden);
    }
  });
});

describe("composeSpawnEnv — mines a source env for ONLY the allowlist keys", () => {
  it("keeps allowlisted vars, drops everything else", () => {
    const env = composeSpawnEnv({
      HOME: "/home/u",
      PATH: "/usr/bin",
      TERM: "xterm-256color",
      // dropped — outside the allowlist:
      CLAUDE_CODE_CHILD_SESSION: "1",
      AWS_SECRET_ACCESS_KEY: "shhh",
      NOT_CANONICAL: "x",
      GONE: undefined,
    });
    expect(env).toEqual({
      HOME: "/home/u",
      PATH: "/usr/bin",
      TERM: "xterm-256color",
    });
    expect("CLAUDE_CODE_CHILD_SESSION" in env).toBe(false);
    expect("AWS_SECRET_ACCESS_KEY" in env).toBe(false);
  });
});

describe("cleanEnv — composes from the allowlist; identity/leaked/arbitrary env never reaches a hosted shell", () => {
  // #1872 + the pre-existing regression: a production kolu bakes its internal env
  // (KOLU_KAVAL_BIN et al., the kaval identity vars KAVAL_BUILD_ID/COMMIT_HASH) into
  // its own process via the nix wrapper, AND an orchestrator that launched the daemon
  // can leave its identity vars (CLAUDE_CODE_CHILD_SESSION) in that env. cleanEnv()'s
  // OLD production passthrough forwarded ALL of it into every PTY it spawned — a nested
  // `just dev` inherited a STALE KOLU_KAVAL_BIN, and a spawned agent lost its transcript.
  // cleanEnv now composes from SPAWN_ENV_ALLOWLIST, so anything outside that narrow set
  // is dropped by construction. Default module state (no configureNixShellEnv call) is
  // the production path — the exact one that leaked.
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  it("drops KOLU_* / the kaval identity vars / a leaked CLAUDE_CODE_* — keeps the allowlisted base", () => {
    process.env.KOLU_KAVAL_BIN = "/nix/store/stale-kaval/bin/kaval";
    process.env.KOLU_STATE_DIR = "/home/x/.config/kolu";
    process.env.KAVAL_BUILD_ID = "outer-production-build";
    process.env.KAVAL_COMMIT_HASH = "deadbeef";
    // the #1872 leak: an orchestrator's identity var in the daemon's env.
    process.env.CLAUDE_CODE_CHILD_SESSION = "1";
    // an arbitrary user/leaked var — now DROPPED (was forwarded by the old passthrough).
    process.env.PTY_TEST_USER_VAR = "drop-me";
    // an allowlisted var — kept.
    process.env.HOME = "/home/x";

    const env = cleanEnv();

    // The whole identity/leaked/internal class is gone — nothing ancestral rides in.
    expect(env.KOLU_KAVAL_BIN).toBeUndefined();
    expect(env.KOLU_STATE_DIR).toBeUndefined();
    expect(env.KAVAL_BUILD_ID).toBeUndefined();
    expect(env.KAVAL_COMMIT_HASH).toBeUndefined();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined(); // the #1872 fix
    expect(env.PTY_TEST_USER_VAR).toBeUndefined();
    expect(Object.keys(env).some((k) => k.startsWith("KOLU_"))).toBe(false);

    // the allowlisted base is kept.
    expect(env.HOME).toBe("/home/x");
    expect(env.PATH).toBe(process.env.PATH);

    // every surviving key is on the allowlist (or the SHELL fallback) — no leak.
    for (const k of Object.keys(env)) {
      expect(SPAWN_ENV_ALLOWLIST as readonly string[]).toContain(k);
    }
  });
});

describe("OSC7_FN", () => {
  const hostnameStub = "hostname() { printf test-host; }\n";

  it("emits OSC 7 with file:// URL containing hostname and cwd", async () => {
    const out = await runBash(`${OSC7_FN}; ${hostnameStub}__kolu_osc7`, "/tmp");
    // Format: ESC ] 7 ; file://<hostname><pwd> ESC \
    // On macOS /tmp resolves to /private/tmp, so the path may end in
    // /tmp but contain /private as a prefix — accept any path ending
    // in /tmp.
    expect(out).toMatch(/^\x1b\]7;file:\/\/test-host.*\/tmp\x1b\\$/);
  });

  it("reflects current PWD not the initial cwd", async () => {
    const out = await runBash(
      `${OSC7_FN}; ${hostnameStub}cd /; __kolu_osc7; cd /tmp; __kolu_osc7`,
      "/tmp",
    );
    // First emission ends with /, second ends with /tmp
    const matches = [...out.matchAll(/file:\/\/[^/]+([^\x1b]*)/g)];
    expect(matches).toHaveLength(2);
    expect(matches[0]?.[1]).toBe("/");
    expect(matches[1]?.[1]).toBe("/tmp");
  });
});

describe("OSC2_PREEXEC_FN", () => {
  // __kolu_preexec emits TWO sequences per invocation:
  //   1. OSC 2 title change (for terminal title + event-driven reconcile)
  //   2. OSC 633 ; E ; <command>  (VS Code semantic command mark, for
  //      recent-agents MRU + per-terminal agent-command stash)
  // Order is NOT load-bearing — onCommandRun in terminals.ts publishes
  // its own reconcile trigger after stashing. See shell.ts docstring.

  it("emits OSC 2 with the passed command string", async () => {
    const out = await runBash(
      `${OSC2_PREEXEC_FN}; __kolu_preexec "vim foo.ts"`,
    );
    expect(out).toContain("\x1b]2;vim foo.ts\x1b\\");
  });

  it("emits OSC 633;E with the passed command string", async () => {
    const out = await runBash(
      `${OSC2_PREEXEC_FN}; __kolu_preexec "vim foo.ts"`,
    );
    expect(out).toContain("\x1b]633;E;vim foo.ts\x1b\\");
  });

  it("handles commands with special characters", async () => {
    const out = await runBash(
      `${OSC2_PREEXEC_FN}; __kolu_preexec 'grep "needle" file.txt'`,
    );
    expect(out).toContain('\x1b]2;grep "needle" file.txt\x1b\\');
    expect(out).toContain('\x1b]633;E;grep "needle" file.txt\x1b\\');
  });

  it("emits empty payload for empty command", async () => {
    const out = await runBash(`${OSC2_PREEXEC_FN}; __kolu_preexec ""`);
    expect(out).toContain("\x1b]2;\x1b\\");
    expect(out).toContain("\x1b]633;E;\x1b\\");
  });
});

describe("OSC2_PRECMD_BASH", () => {
  it("emits OSC 2 with the current directory from dirs", async () => {
    const out = await runBash(
      `${OSC2_PRECMD_BASH}; __kolu_title_precmd`,
      "/tmp",
    );
    // Format: ESC ] 2 ; <path> ESC \
    expect(out).toMatch(/^\x1b\]2;[^\x1b]*\x1b\\$/);
    expect(out).toContain("tmp");
  });
});

describe("OSC2_PREEXEC_BASH_GUARD", () => {
  /** Common prelude that sets up preexec fn + guard. */
  const prelude = `${OSC2_PREEXEC_FN}\n${OSC2_PREEXEC_BASH_GUARD}\n`;

  it("arm sets the ready flag", async () => {
    const out = await runBash(
      `${prelude}__kolu_preexec_arm; printf 'ready=%s\\n' "$__kolu_preexec_ready" >&2`,
    );
    // stdout is empty (no OSC), stderr has ready=1 — but runBash only returns stdout.
    // Re-run capturing both streams:
    const combined = await execFileSyncBoth(
      `${prelude}__kolu_preexec_arm; echo "ready=$__kolu_preexec_ready"`,
    );
    expect(combined).toContain("ready=1");
    expect(out).toBe("");
  });

  it("dispatch is no-op when ready flag is empty (no DEBUG trap installed)", async () => {
    // Without arm(), dispatch should return immediately with no output
    const out = await runBash(`${prelude}__kolu_preexec_dispatch; echo "done"`);
    // "done" is printed to stdout; the OSC 2 line should NOT appear
    expect(out).not.toContain("\x1b]2;");
    expect(out).toContain("done");
  });

  it("DEBUG trap emits for user command when armed via PS0", async () => {
    // Real integration: install DEBUG trap + arm manually (PS0 simulated),
    // then run a no-op command. The trap fires with BASH_COMMAND set by bash itself.
    const out = await runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        `__kolu_preexec_arm\n` +
        `true\n`,
    );
    // The DEBUG trap fires for __kolu_preexec_arm itself BEFORE arm runs (flag is ""),
    // then for `true` after arm set flag=1 — so we should see ONE OSC 2 emission
    // with the command "true".
    const matches = [...out.matchAll(/\x1b\]2;([^\x1b]*)\x1b\\/g)];
    // At least one emission, and at least one should be "true"
    expect(matches.length).toBeGreaterThan(0);
    const titles = matches.map((m) => m[1]);
    expect(titles).toContain("true");
  });

  it("DEBUG trap does NOT emit when not armed (PROMPT_COMMAND simulation)", async () => {
    // Simulate the state after a user command: ready flag was set, dispatch
    // was called, flag got cleared. Now a PROMPT_COMMAND hook runs — no arm,
    // flag stays "". Verify no OSC 2 is emitted.
    const out = await runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        // No arm — simulates PROMPT_COMMAND context
        `__zoxide_hook() { :; }\n` +
        `__zoxide_hook\n`,
    );
    // The command "__zoxide_hook" would fire DEBUG with BASH_COMMAND="__zoxide_hook"
    // but flag is empty so dispatch returns early.
    expect(out).not.toContain("__zoxide_hook");
  });

  it("readline widget (fzf Ctrl+R) does not consume the ready flag", async () => {
    // Regression: when fzf's Ctrl+R binding fires, BASH_COMMAND is set to
    // `__fzf_history__` — a readline widget, not a user command. Before
    // the `__*` guard, dispatch would clear the ready flag for it, causing
    // the user's NEXT real command to see flag="" and get silently dropped
    // (the "had to run it twice" bug).
    const out = await runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        `__fzf_history__() { :; }\n` +
        // Arm flag (as PROMPT_COMMAND would after the prompt draws)
        `__kolu_preexec_arm\n` +
        // Simulate Ctrl+R: widget runs, should NOT consume the flag
        `__fzf_history__\n` +
        // Now the user's real command — flag must still be armed
        `true\n`,
    );
    const titles = [...out.matchAll(/\x1b\]2;([^\x1b]*)\x1b\\/g)].map(
      (m) => m[1],
    );
    // The widget should be skipped, the real command should fire.
    expect(titles).not.toContain("__fzf_history__");
    expect(titles).toContain("true");
  });

  it("full flow: user command emitted, PROMPT_COMMAND hook skipped", async () => {
    // Most realistic test: install trap, simulate user command (arm + run),
    // then simulate PROMPT_COMMAND hook (no arm + run another command).
    const out = await runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        `__zoxide_hook() { :; }\n` +
        // Simulate user command via PS0 arm
        `__kolu_preexec_arm\n` +
        `true\n` +
        // After the user command, flag is cleared. Now PROMPT_COMMAND hooks run.
        `__zoxide_hook\n`,
    );
    const titles = [...out.matchAll(/\x1b\]2;([^\x1b]*)\x1b\\/g)].map(
      (m) => m[1],
    );
    // "true" should appear (user command), "__zoxide_hook" should NOT
    expect(titles).toContain("true");
    expect(titles).not.toContain("__zoxide_hook");
  });

  // REGRESSION: PS0 command substitution runs in a subshell, so
  // `PS0='$(__kolu_preexec_arm)'` would set the flag in a subshell that
  // immediately exits — the parent shell's flag stays empty and dispatch
  // never emits. We now arm via PROMPT_COMMAND (end) instead.
  it("regression: arming via PS0 subshell does NOT work (wrong approach)", async () => {
    const out = await runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        // BAD: PS0 runs arm in a subshell, flag never reaches parent
        `PS0='$(__kolu_preexec_arm)'\n` +
        // Force PS0 evaluation by... actually, PS0 only fires in interactive
        // mode after readline reads a line. Non-interactive bash doesn't
        // evaluate PS0 at all. So we simulate the broken behavior by
        // running arm inside `$(...)` directly.
        `$(__kolu_preexec_arm)\n` +
        `true\n`,
    );
    // The subshell arm doesn't leak to parent → dispatch for `true` sees
    // flag="" → no emission.
    expect(out).not.toContain("\x1b]2;true");
  });

  it("correct approach: arming at end of PROMPT_COMMAND reaches parent", async () => {
    // Simulate the real PROMPT_COMMAND cycle: arm runs as the last step of
    // PROMPT_COMMAND, which executes in the parent shell (no subshell).
    const out = await runBash(
      `${prelude}` +
        `trap '__kolu_preexec_dispatch' DEBUG\n` +
        // PROMPT_COMMAND = "...;__kolu_preexec_arm" (simplified to just arm)
        // In real bash this runs before each prompt; here we call it directly.
        `__kolu_preexec_arm\n` +
        // Now the user's command runs — DEBUG fires with flag=1 → emit
        `true\n` +
        // Next cycle: arm again, then another command
        `__kolu_preexec_arm\n` +
        `:\n`,
    );
    const titles = [...out.matchAll(/\x1b\]2;([^\x1b]*)\x1b\\/g)].map(
      (m) => m[1],
    );
    // Both user commands should have emitted their OSC 2
    expect(titles).toContain("true");
    expect(titles).toContain(":");
  });
});

/** Like runBash but returns combined stdout+stderr. */
async function execFileSyncBoth(script: string): Promise<string> {
  try {
    return await runBash(`${script} 2>&1`);
  } catch {
    return "";
  }
}

/** The sole init file of a plan, asserted present (the bash/zsh wrappers always
 *  produce exactly one). Keeps the golden assertions free of index-access
 *  undefined-narrowing noise. */
function onlyInitFile(init: ReturnType<typeof prepareShellInit>): {
  name: string;
  content: string;
} {
  expect(init.initFiles).toHaveLength(1);
  const [file] = init.initFiles;
  if (!file) throw new Error("expected exactly one init file");
  return file;
}

/** Materialise a pure plan's init files under rcDir, the way the pty-host does
 *  on spawn — so a behavioral test can source the wrapper the host would run. */
function materialise(
  rcDir: string,
  init: ReturnType<typeof prepareShellInit>,
): void {
  for (const f of init.initFiles) {
    const p = join(rcDir, f.name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, f.content);
  }
}

describe("prepareShellInit — fully-specified plan (B0)", () => {
  // The golden parity guard: after the inversion `prepareShellInit` is PURE —
  // it plans the wrapper (argv + env + initFiles) but writes nothing; the
  // pty-host materialises the files on the disk it owns. These lock the exact
  // shape the host now relies on (paths into the host's rcDir, the bash/zsh
  // wrapper mechanism) so a refactor can't silently drift the spawn.

  it("bash: --rcfile points into rcDir, content is replay-then-hooks, nothing written", () => {
    const rcDir = mkdtempSync(join(tmpdir(), "kolu-rc-"));
    const id = "T-bash";
    const init = prepareShellInit({
      shell: "/bin/bash",
      home: "/home/x",
      terminalId: id,
      rcDir,
    });
    expect(init.args).toEqual(["--rcfile", join(rcDir, `bashrc-${id}`)]);
    expect(init.env).toEqual({});
    const file = onlyInitFile(init);
    expect(file.name).toBe(`bashrc-${id}`);
    // PURE: the planner touched no disk.
    expect(existsSync(join(rcDir, `bashrc-${id}`))).toBe(false);
    const content = file.content;
    // replay (user dotfiles) precedes hooks (OSC injection) — load-bearing.
    expect(content).toContain("/etc/profile"); // replay
    expect(content).toContain("/home/x/.bashrc"); // replay, against the given home
    expect(content).toContain(OSC7_FN); // hook
    expect(content.indexOf("/home/x/.bashrc")).toBeLessThan(
      content.indexOf(OSC7_FN),
    );
    rmSync(rcDir, { recursive: true, force: true });
  });

  it("zsh: ZDOTDIR points into rcDir, init file is <dir>/.zshrc, nothing written", () => {
    const rcDir = mkdtempSync(join(tmpdir(), "kolu-rc-"));
    const id = "T-zsh";
    const init = prepareShellInit({
      shell: "/bin/zsh",
      home: "/home/x",
      terminalId: id,
      rcDir,
    });
    expect(init.args).toEqual([]);
    expect(init.env.ZDOTDIR).toBe(join(rcDir, `zdotdir-${id}`));
    expect(onlyInitFile(init).name).toBe(join(`zdotdir-${id}`, ".zshrc"));
    expect(existsSync(join(rcDir, `zdotdir-${id}`))).toBe(false);
    rmSync(rcDir, { recursive: true, force: true });
  });

  it("returns an empty plan for an unknown shell or a missing home", () => {
    const empty = { args: [], env: {}, initFiles: [] };
    expect(
      prepareShellInit({
        shell: "/usr/bin/fish",
        home: "/home/x",
        terminalId: "x",
        rcDir: "/r",
      }),
    ).toEqual(empty);
    expect(
      prepareShellInit({
        shell: "/bin/bash",
        home: undefined,
        terminalId: "x",
        rcDir: "/r",
      }),
    ).toEqual(empty);
  });
});

describe("prepareShellInit zsh wrapper", () => {
  // Behavioral regression for #800: spawn zsh against the wrapper rcfile
  // with a fake ~/.zshenv that exports a marker, then verify the marker
  // survives. Stronger than a string-match on the generated rcfile —
  // catches the case where the source line is present but unreachable
  // (broken `if`, wrong path, accidentally inside a function, etc.).
  it("loads user env from ~/.zshenv (regression: missing under macOS launchd)", async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), "kolu-shell-"));
    const rcDir = mkdtempSync(join(tmpdir(), "kolu-rc-"));
    try {
      writeFileSync(
        join(fakeHome, ".zshenv"),
        "export KOLU_TEST_MARKER=loaded\n",
      );
      const init = prepareShellInit({
        shell: "/bin/zsh",
        home: fakeHome,
        terminalId: `test-zshenv-${process.pid}`,
        rcDir,
      });
      // The pty-host writes the planned init files before spawn; do the same.
      materialise(rcDir, init);
      const rcPath = join(init.env.ZDOTDIR as string, ".zshrc");
      const out = await runZsh(
        `source ${shQuote(rcPath)} >/dev/null 2>&1; printf '%s' "$KOLU_TEST_MARKER"`,
      );
      if (out === null) return; // zsh unavailable — skip
      expect(out).toBe("loaded");
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(rcDir, { recursive: true, force: true });
    }
  });
});

describe("OSC2_PRECMD_ZSH", () => {
  it("emits OSC 2 with compact zsh prompt path", async () => {
    const out = await runZsh(`${OSC2_PRECMD_ZSH}; __kolu_title_precmd`, "/tmp");
    if (out === null) return; // zsh unavailable — skip
    // Format: ESC ] 2 ; <compact path> BEL
    expect(out).toMatch(/^\x1b\]2;[^\x1b]*\x07$/);
    expect(out).toContain("tmp");
  });

  it("uses compact notation for deep paths", async () => {
    // Build a deep path at runtime (>= 4 segments) so the ellipsis branch fires
    const out = await runZsh(
      `mkdir -p /tmp/kolu-deep-test/a/b/c && ${OSC2_PRECMD_ZSH}; cd /tmp/kolu-deep-test/a/b/c && __kolu_title_precmd`,
    );
    if (out === null) return;
    // zsh %(4~|…/%3~|%~) — 5 segments (/tmp/kolu-deep-test/a/b/c) → …/a/b/c
    expect(out).toMatch(/^\x1b\]2;.*\x07$/);
    expect(out).toContain("a/b/c");
  });
});
