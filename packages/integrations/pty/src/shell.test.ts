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
import {
  assertDaemonSpawnAllowed,
  describeDaemon,
} from "@kolu/daemon-test-gate";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  AGENT_TOOLS_BAKE_ENV,
  cleanEnv,
  composeSpawnEnv,
  koluIdentityEnv,
  OSC2_PRECMD_BASH,
  OSC2_PRECMD_ZSH,
  OSC2_PREEXEC_FN,
  OSC7_FN,
  PATH_PREPEND_CASES,
  PATH_REASSERT,
  prepareShellInit,
  prependPathEntries,
  PS0_PREEXEC_BASH,
  readAgentToolsBake,
  SPAWN_ENV_ALLOWLIST,
  SPAWN_ENV_FUNCTIONAL,
  SPAWN_ENV_OPERATIONAL,
  SPAWN_ENV_PRESENTATION,
  TERMINAL_TOOLS_PATH_ENV,
} from "./shell.ts";

const shellSubprocessHome = mkdtempSync(
  join(tmpdir(), "kolu-shell-test-home-"),
);

afterAll(() => {
  // Close only if a gated describe actually constructed them (they are LAZY now —
  // no module-load fork on a bare vitest, F4).
  bashRunner?.close();
  zshRunner?.close();
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

// LAZY runners (F4): the pair used to be constructed at MODULE LOAD, so `new
// ShellRunner(...)` forked a real bash AND zsh even when every describe was skipped
// (a module-load fork runs regardless of `describe.skip`). Construct on first use
// instead, behind the daemon-spawn leash (`assertDaemonSpawnAllowed`), so a gate-off
// bare vitest never forks a shell — and only the gated `describeDaemon` blocks below
// (KOLU_DAEMON_TESTS=1) ever reach them.
let bashRunner: ShellRunner | undefined;
let zshRunner: ShellRunner | undefined;
function bash(): ShellRunner {
  assertDaemonSpawnAllowed("a bash shell subprocess");
  bashRunner ??= new ShellRunner("bash", ["--noprofile", "--norc"]);
  return bashRunner;
}
function zshShell(): ShellRunner {
  assertDaemonSpawnAllowed("a zsh shell subprocess");
  zshRunner ??= new ShellRunner("zsh", ["-f"]);
  return zshRunner;
}

/** Run a script in a clean bash subshell and return stdout. */
function runBash(script: string, cwd = "/tmp"): Promise<string> {
  return bash().run(script, cwd);
}

/** Run a script in a clean zsh subshell and return stdout. Skips if zsh unavailable. */
async function runZsh(script: string, cwd = "/tmp"): Promise<string | null> {
  try {
    return await zshShell().run(script, cwd);
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

describe("SPAWN_ENV_ALLOWLIST — the one shared allowlist, pinned exactly as data BY CLASS", () => {
  // Rider: the exact-set test groups keys by their NAMED CLASS, each with a one-line
  // rationale, so a future addition must name the class it belongs to — and an
  // identity-ish key has no class to claim (it fails this test, not review vigilance).
  // The invariant is "no ambient IDENTITY, finite, pinned" — not "narrow for its own
  // sake"; a non-identity capability var the login session owns is legitimately in-scope.

  it("Class 1 FUNCTIONAL — exactly what a shell/daemon needs to run", () => {
    expect([...SPAWN_ENV_FUNCTIONAL]).toEqual([
      "HOME",
      "USER",
      "LOGNAME",
      "PATH",
      "SHELL",
    ]);
  });

  it("Class 2 PRESENTATION — exactly the terminal/locale vars (full POSIX locale-category set)", () => {
    expect([...SPAWN_ENV_PRESENTATION]).toEqual([
      "TERM",
      "COLORTERM",
      "LANG",
      "LANGUAGE",
      "LC_ALL",
      "LC_CTYPE",
      "LC_MESSAGES",
      "LC_TIME",
      "LC_NUMERIC",
      "LC_COLLATE",
      "LC_MONETARY",
    ]);
  });

  it("Class 3 OPERATIONAL-SESSION — exactly the login-session capability vars (never dotfile-restorable)", () => {
    expect([...SPAWN_ENV_OPERATIONAL]).toEqual([
      "XDG_RUNTIME_DIR",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_CACHE_HOME",
      "XDG_STATE_HOME",
      "SSH_AUTH_SOCK", // signing capability — needed; SSH_AGENT_PID (kill) is OUT.
      "DISPLAY", // X11 GUI-session capability, sibling of WAYLAND_DISPLAY.
      "WAYLAND_DISPLAY",
      "XAUTHORITY",
      "DBUS_SESSION_BUS_ADDRESS",
      "TMPDIR", // darwin: launchd mints a per-user /var/folders temp per session.
    ]);
    // SSH_AGENT_PID (kill-the-agent capability) is deliberately NOT here.
    expect(SPAWN_ENV_OPERATIONAL as readonly string[]).not.toContain(
      "SSH_AGENT_PID",
    );
  });

  it("the full allowlist is exactly the three named classes, in order, no extras", () => {
    expect([...SPAWN_ENV_ALLOWLIST]).toEqual([
      ...SPAWN_ENV_FUNCTIONAL,
      ...SPAWN_ENV_PRESENTATION,
      ...SPAWN_ENV_OPERATIONAL,
    ]);
  });

  it("no identity var can claim a class — CLAUDE_CODE_* / secrets / kolu-internal are absent", () => {
    for (const forbidden of [
      "CLAUDE_CODE_CHILD_SESSION",
      "CLAUDECODE",
      "CLAUDE_CODE_SESSION_ID",
      "AWS_SECRET_ACCESS_KEY",
      "KOLU_KAVAL_BIN",
      "KAVAL_BUILD_ID",
      "SSH_AGENT_PID",
    ]) {
      expect(SPAWN_ENV_ALLOWLIST as readonly string[]).not.toContain(forbidden);
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

    // the allowlisted base is kept (PATH modulo the empty-entry strip below).
    expect(env.HOME).toBe("/home/x");
    expect(env.PATH).toBe(
      (process.env.PATH ?? "")
        .split(":")
        .filter((e) => e !== "")
        .join(":"),
    );

    // every surviving key is on the allowlist (or the SHELL fallback) — no leak.
    for (const k of Object.keys(env)) {
      expect(SPAWN_ENV_ALLOWLIST as readonly string[]).toContain(k);
    }
  });

  it("drops empty PATH entries — the implicit current-directory hazard, killed once", () => {
    // POSIX reads an empty PATH entry as "the current directory", so a daemon that
    // inherited one would hand every hosted shell a PATH that resolves commands out
    // of whatever tree the user cd'd into. This is the single place that fixes it:
    // sanitizing at the env boundary means it happens once, over the composed
    // value, instead of being re-implemented by every downstream transform — and
    // notably NOT by prependPathEntries / PATH_REASSERT, whose contract is just
    // "prepend these dirs, skipping any already present".
    process.env.PATH = ":/usr/bin::/bin:";

    expect(cleanEnv().PATH).toBe("/usr/bin:/bin");
  });

  it("leaves a PATH with no empty entries byte-identical", () => {
    process.env.PATH = "/usr/bin:/bin";

    expect(cleanEnv().PATH).toBe("/usr/bin:/bin");
  });
});

describeDaemon("OSC7_FN", () => {
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

describeDaemon("OSC2_PREEXEC_FN", () => {
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

describeDaemon("OSC2_PRECMD_BASH", () => {
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

describeDaemon("PS0_PREEXEC_BASH", () => {
  // The PS0-riding preexec (#2119). PS0 itself only expands in an INTERACTIVE
  // bash — the real prompt→PS0 cycle is exercised end-to-end on a PTY in
  // kaval's shellPreexecCapture.test.ts (including under bash-preexec). Here
  // the machinery is driven directly in a subshell: `history -s` plays the
  // role of readline appending the accepted command, `__kolu_hist_sync` the
  // prompt-time baseline, and a direct `__kolu_ps0` call the PS0 expansion.
  // Each ShellRunner script runs in its own `( … )` subshell, so the enabled
  // history is isolated per test.

  /** Emitter + PS0 machinery, with history writable in a non-interactive
   *  subshell (no HISTFILE side effects). */
  const prelude = [
    OSC2_PREEXEC_FN,
    PS0_PREEXEC_BASH,
    `HISTFILE=/dev/null`,
    `set -o history`,
    "",
  ].join("\n");

  it("emits both OSC marks for the entry readline just appended", async () => {
    const out = await runBash(
      `${prelude}history -s "ls -la"\n` + // an earlier command already in history
        `__kolu_hist_sync\n` + // prompt draws → baseline
        `history -s "claude --resume abc"\n` + // readline accepts the next command
        `__kolu_ps0\n`, // PS0 expands
    );
    expect(out).toContain("\x1b]633;E;claude --resume abc\x1b\\");
    expect(out).toContain("\x1b]2;claude --resume abc\x1b\\");
  });

  it("emits for the FIRST command of a session (the #2119 slot)", async () => {
    // Empty history at the first prompt, then the session's first command —
    // the agent-launch slot the DEBUG-trap design lost under bash-preexec.
    const out = await runBash(
      `${prelude}__kolu_hist_sync\nhistory -s "claude"\n__kolu_ps0\n`,
    );
    expect(out).toContain("\x1b]633;E;claude\x1b\\");
  });

  it("skips when history gained nothing (HISTCONTROL=ignorespace)", async () => {
    // A space-prefixed command adds no history entry; emitting would replay
    // the PREVIOUS command's line as if it had just been run.
    const out = await runBash(
      `${prelude}history -s "claude"\n__kolu_hist_sync\n__kolu_ps0\necho done\n`,
    );
    expect(out).not.toContain("\x1b]633;E;");
    expect(out).toContain("done");
  });

  it("emits nothing when history is off entirely", async () => {
    // No `set -o history`: `builtin history 1` is empty — the shell behaves
    // like one without the integration, never emitting a stale line.
    const out = await runBash(
      `${OSC2_PREEXEC_FN}\n${PS0_PREEXEC_BASH}\n__kolu_hist_sync\n__kolu_ps0\necho done\n`,
    );
    expect(out).not.toContain("\x1b]633;E;");
    expect(out).toContain("done");
  });

  it("strips history's numeric prefix, preserving the command verbatim", async () => {
    // `history 1` renders "  123  cmd"; only that prefix may be removed —
    // inner double spaces and quotes belong to the command.
    const out = await runBash(
      `${prelude}__kolu_hist_sync\nhistory -s 'grep "a  b" file.txt'\n__kolu_ps0\n`,
    );
    expect(out).toContain('\x1b]633;E;grep "a  b" file.txt\x1b\\');
  });

  it("appends to a user PS0 rather than clobbering it", async () => {
    const out = await runBash(
      `PS0='user-ps0'\n${OSC2_PREEXEC_FN}\n${PS0_PREEXEC_BASH}\necho "PS0=$PS0"\n`,
    );
    expect(out).toContain("PS0=user-ps0$(__kolu_ps0)");
  });
});

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

describeDaemon("prepareShellInit zsh wrapper", () => {
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

describe("readAgentToolsBake", () => {
  // Where a daemon's client toolchain comes from — the fact it is TOLD, never
  // derives. These pin the parsing AND the deliberate absence: a daemon with no
  // baked toolchain must report `[]` (and so inject nothing) rather than guess a
  // path from `process.execPath` / `argv[1]` / a PATH search. A guess would
  // resolve to the tsx loader or to whatever build happens to be installed on
  // the host, which is exactly the skew this indirection makes unspellable.
  it("splits the colon-joined bake, preserving priority order", () => {
    expect(
      readAgentToolsBake({
        [AGENT_TOOLS_BAKE_ENV]: "/nix/store/aaa/bin:/nix/store/bbb/bin",
      }),
    ).toEqual(["/nix/store/aaa/bin", "/nix/store/bbb/bin"]);
  });

  it("reports NO toolchain when unset or empty — never a guessed default", () => {
    // The from-source (`just dev` / e2e) daemon: no wrapper, so nothing baked.
    expect(readAgentToolsBake({})).toEqual([]);
    expect(readAgentToolsBake({ [AGENT_TOOLS_BAKE_ENV]: "" })).toEqual([]);
  });

  it("drops empty segments so no entry can mean 'the current directory'", () => {
    // An empty PATH entry is CWD to a POSIX shell — a real hazard, not cosmetic.
    expect(readAgentToolsBake({ [AGENT_TOOLS_BAKE_ENV]: "/a::/b:" })).toEqual([
      "/a",
      "/b",
    ]);
  });

  it("reads the BAKE name and never the terminal STAMP", () => {
    // The whole point of two names: a daemon started inside a kolu terminal sees
    // that terminal's stamp and must NOT mistake it for its own build's tools.
    expect(
      readAgentToolsBake({ [TERMINAL_TOOLS_PATH_ENV]: "/foreign/bin" }),
    ).toEqual([]);
  });
});

describe("prependPathEntries", () => {
  // Driven from the shared oracle, which the real-shell block below asserts the
  // SHELL half against — so the rule cannot be changed in one language only.
  for (const c of PATH_PREPEND_CASES) {
    it(`PATH=${JSON.stringify(c.path)} + [${c.dirs.join(", ")}] → ${c.expect}`, () => {
      expect(prependPathEntries(c.path, c.dirs)).toBe(c.expect);
    });
  }

  it("treats an absent PATH as empty", () => {
    expect(prependPathEntries(undefined, ["/a"])).toBe("/a");
  });

  it("never introduces an empty entry from the dirs it was asked to add", () => {
    // An empty entry in PATH means "the current directory" to a POSIX shell, so
    // this function must not create one. Filtering the INCOMING dirs is the whole
    // of that duty — the caller's own PATH is passed through untouched (pinned by
    // the "/usr/bin::/bin" row of the shared oracle above), because sanitizing
    // somebody else's PATH belongs to cleanEnv, which does it once for everyone.
    // The shell half filters the incoming dirs the same way.
    expect(prependPathEntries("/usr/bin:/bin", ["", "/a", ""])).toBe(
      "/a:/usr/bin:/bin",
    );
  });
});

describe("prepareShellInit — PATH re-assert", () => {
  it("emits the re-assert AFTER the dotfile replay (the ordering is the point)", () => {
    // A user dotfile doing an absolute `export PATH=…` is exactly what the replay
    // re-runs, so a re-assert placed before it would be silently undone. Pin the
    // ordering, not just the presence.
    const init = prepareShellInit({
      shell: "/bin/bash",
      home: "/home/x",
      terminalId: "T-order",
      rcDir: "/r",
    });
    const content = onlyInitFile(init).content;
    expect(content).toContain(TERMINAL_TOOLS_PATH_ENV);
    expect(content.indexOf("/home/x/.bashrc")).toBeLessThan(
      content.indexOf(TERMINAL_TOOLS_PATH_ENV),
    );
  });

  it("carries no caller data — the dirs are read from the env at runtime", () => {
    // The block is a FIXED string: paths arrive in a variable, never interpolated
    // into shell source, so no quoting question (and no injection) can arise.
    const a = prepareShellInit({
      shell: "/bin/bash",
      home: "/home/x",
      terminalId: "T-a",
      rcDir: "/r",
    });
    const b = prepareShellInit({
      shell: "/bin/bash",
      home: "/home/x",
      terminalId: "T-b",
      rcDir: "/r",
    });
    const reassert = (init: ReturnType<typeof prepareShellInit>) =>
      onlyInitFile(init).content.slice(
        onlyInitFile(init).content.indexOf("__kolu_path_reassert"),
      );
    expect(reassert(a)).toBe(reassert(b));
  });
});

describeDaemon("prepareShellInit PATH re-assert (real shells)", () => {
  // The behavioral proof, and the reason the rcfile half exists at all: a spawn
  // env alone does NOT survive a user dotfile that assigns PATH absolutely. This
  // spawns a real shell against a fake home whose rc clobbers PATH, and asserts
  // the toolchain is still reachable afterward. A string-match on the generated
  // rcfile cannot catch an unreachable or mis-quoted block; this can.
  const TOOLS = "/opt/kolu-tools-fixture/bin";

  async function pathAfterClobber(
    shell: "/bin/bash" | "/bin/zsh",
    rcName: string,
  ): Promise<string | null> {
    const fakeHome = mkdtempSync(join(tmpdir(), "kolu-shell-"));
    const rcDir = mkdtempSync(join(tmpdir(), "kolu-rc-"));
    try {
      // The hostile case: an ABSOLUTE assignment, not a prepend.
      writeFileSync(join(fakeHome, rcName), 'export PATH="/usr/bin:/bin"\n');
      const init = prepareShellInit({
        shell,
        home: fakeHome,
        terminalId: `test-path-${process.pid}`,
        rcDir,
      });
      materialise(rcDir, init);
      const rcPath =
        shell === "/bin/zsh"
          ? join(init.env.ZDOTDIR as string, ".zshrc")
          : join(rcDir, init.initFiles[0]?.name as string);
      const script = `export ${TERMINAL_TOOLS_PATH_ENV}=${shQuote(TOOLS)}; source ${shQuote(rcPath)} >/dev/null 2>&1; printf '%s' "$PATH"`;
      return shell === "/bin/zsh"
        ? await runZsh(script)
        : await runBash(script);
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(rcDir, { recursive: true, force: true });
    }
  }

  it("bash: the toolchain survives a dotfile that overwrites PATH", async () => {
    const out = await pathAfterClobber("/bin/bash", ".bashrc");
    if (out === null) return;
    expect(out.split(":")).toContain(TOOLS);
    // The user's own PATH is still there — we merged, we did not replace.
    expect(out.split(":")).toContain("/usr/bin");
  });

  it("zsh: the toolchain survives a dotfile that overwrites PATH", async () => {
    const out = await pathAfterClobber("/bin/zsh", ".zshrc");
    if (out === null) return;
    expect(out.split(":")).toContain(TOOLS);
    expect(out.split(":")).toContain("/usr/bin");
  });

  it("no-ops when the daemon baked no toolchain (from-source parity)", async () => {
    // With the var unset the block must leave PATH exactly as the dotfiles left
    // it — a from-source padi spawns the env it does today, not an empty entry.
    const fakeHome = mkdtempSync(join(tmpdir(), "kolu-shell-"));
    const rcDir = mkdtempSync(join(tmpdir(), "kolu-rc-"));
    try {
      writeFileSync(join(fakeHome, ".bashrc"), 'export PATH="/usr/bin:/bin"\n');
      const init = prepareShellInit({
        shell: "/bin/bash",
        home: fakeHome,
        terminalId: `test-path-none-${process.pid}`,
        rcDir,
      });
      materialise(rcDir, init);
      const rcPath = join(rcDir, init.initFiles[0]?.name as string);
      const out = await runBash(
        `unset ${TERMINAL_TOOLS_PATH_ENV}; source ${shQuote(rcPath)} >/dev/null 2>&1; printf '%s' "$PATH"`,
      );
      expect(out).toBe("/usr/bin:/bin");
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(rcDir, { recursive: true, force: true });
    }
  });
});

describeDaemon("PATH_PREPEND_CASES — one oracle, both implementations", () => {
  // The rule "prepend without duplicating" is written twice, in two languages:
  // `prependPathEntries` (TS, the spawn env) and `PATH_REASSERT` (POSIX shell,
  // the rcfile — the only carrier for a `fish` user, who gets no wrapper rc from
  // selectShellInit). Co-locating them in one file does not keep them equal; one
  // shared table does. The TS half is asserted against these same rows above, so
  // adding a row here is asserted against BOTH halves, and editing either
  // implementation alone goes red.
  for (const c of PATH_PREPEND_CASES) {
    const label = `PATH=${JSON.stringify(c.path)} + [${c.dirs.join(", ")}]`;

    it(`bash: ${label}`, async () => {
      const out = await runBash(
        `PATH=${shQuote(c.path)}; ${TERMINAL_TOOLS_PATH_ENV}=${shQuote(c.dirs.join(":"))}\n${PATH_REASSERT}\nprintf '%s' "$PATH"`,
      );
      expect(out).toBe(c.expect);
    });

    it(`zsh: ${label}`, async () => {
      const out = await runZsh(
        `PATH=${shQuote(c.path)}; ${TERMINAL_TOOLS_PATH_ENV}=${shQuote(c.dirs.join(":"))}\n${PATH_REASSERT}\nprintf '%s' "$PATH"`,
      );
      if (out === null) return; // zsh unavailable — skip
      expect(out).toBe(c.expect);
    });
  }
});

describeDaemon("OSC2_PRECMD_ZSH", () => {
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
