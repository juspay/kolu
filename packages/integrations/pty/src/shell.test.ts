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
  isShellKoluWraps,
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

function runBash(script: string, cwd = "/tmp"): Promise<string> {
  return bash().run(script, cwd);
}

async function runZsh(script: string, cwd = "/tmp"): Promise<string | null> {
  try {
    return await zshShell().run(script, cwd);
  } catch (err) {
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
    expect(koluIdentityEnv("9.9.9").COLORTERM).toBe("truecolor");
  });

  it("VTE_VERSION stomps a parent value when layered via Object.assign", () => {
    const layered: Record<string, string> = { VTE_VERSION: "9999" };
    Object.assign(layered, koluIdentityEnv("9.9.9"));
    expect(layered.VTE_VERSION).toBe("7603");
  });
});

describe("SPAWN_ENV_ALLOWLIST — the one shared allowlist, pinned exactly as data BY CLASS", () => {
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
      "SSH_AUTH_SOCK",
      "DISPLAY",
      "WAYLAND_DISPLAY",
      "XAUTHORITY",
      "DBUS_SESSION_BUS_ADDRESS",
      "TMPDIR",
    ]);
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
    process.env.CLAUDE_CODE_CHILD_SESSION = "1";
    process.env.PTY_TEST_USER_VAR = "drop-me";
    process.env.HOME = "/home/x";

    const env = cleanEnv();

    expect(env.KOLU_KAVAL_BIN).toBeUndefined();
    expect(env.KOLU_STATE_DIR).toBeUndefined();
    expect(env.KAVAL_BUILD_ID).toBeUndefined();
    expect(env.KAVAL_COMMIT_HASH).toBeUndefined();
    expect(env.CLAUDE_CODE_CHILD_SESSION).toBeUndefined();
    expect(env.PTY_TEST_USER_VAR).toBeUndefined();
    expect(Object.keys(env).some((k) => k.startsWith("KOLU_"))).toBe(false);

    expect(env.HOME).toBe("/home/x");
    expect(env.PATH).toBe(
      (process.env.PATH ?? "")
        .split(":")
        .filter((e) => e !== "")
        .join(":"),
    );

    for (const k of Object.keys(env)) {
      expect(SPAWN_ENV_ALLOWLIST as readonly string[]).toContain(k);
    }
  });

  it("drops empty PATH entries — the implicit current-directory hazard, killed once", () => {
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
    expect(out).toMatch(/^\x1b\]7;file:\/\/test-host.*\/tmp\x1b\\$/);
  });

  it("reflects current PWD not the initial cwd", async () => {
    const out = await runBash(
      `${OSC7_FN}; ${hostnameStub}cd /; __kolu_osc7; cd /tmp; __kolu_osc7`,
      "/tmp",
    );
    const matches = [...out.matchAll(/file:\/\/[^/]+([^\x1b]*)/g)];
    expect(matches).toHaveLength(2);
    expect(matches[0]?.[1]).toBe("/");
    expect(matches[1]?.[1]).toBe("/tmp");
  });
});

describeDaemon("OSC2_PREEXEC_FN", () => {
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
    expect(out).toMatch(/^\x1b\]2;[^\x1b]*\x1b\\$/);
    expect(out).toContain("tmp");
  });
});

describeDaemon("PS0_PREEXEC_BASH", () => {
  const ps0HarnessPrelude = [
    OSC2_PREEXEC_FN,
    PS0_PREEXEC_BASH,
    `HISTFILE=/dev/null`,
    `set -o history`,
    "",
  ].join("\n");
  const readlineAccepts = (command: string) =>
    `history -s ${shQuote(command)}\n`;
  const promptDraws = `__kolu_hist_sync\n`;
  const ps0Expands = `__kolu_ps0\n`;

  it("emits both OSC marks for the entry readline just appended", async () => {
    const out = await runBash(
      ps0HarnessPrelude +
        readlineAccepts("ls -la") +
        promptDraws +
        readlineAccepts("claude --resume abc") +
        ps0Expands,
    );
    expect(out).toContain("\x1b]633;E;claude --resume abc\x1b\\");
    expect(out).toContain("\x1b]2;claude --resume abc\x1b\\");
  });

  it("emits for the FIRST command of a session (the #2119 slot)", async () => {
    const out = await runBash(
      ps0HarnessPrelude + promptDraws + readlineAccepts("claude") + ps0Expands,
    );
    expect(out).toContain("\x1b]633;E;claude\x1b\\");
  });

  it("skips when history gained nothing (HISTCONTROL=ignorespace)", async () => {
    const out = await runBash(
      ps0HarnessPrelude +
        readlineAccepts("claude") +
        promptDraws +
        ps0Expands +
        `echo done\n`,
    );
    expect(out).not.toContain("\x1b]633;E;");
    expect(out).toContain("done");
  });

  it("emits nothing when history is off entirely", async () => {
    const out = await runBash(
      `${OSC2_PREEXEC_FN}\n${PS0_PREEXEC_BASH}\n__kolu_hist_sync\n__kolu_ps0\necho done\n`,
    );
    expect(out).not.toContain("\x1b]633;E;");
    expect(out).toContain("done");
  });

  it("strips history's numeric prefix, preserving the command verbatim", async () => {
    const out = await runBash(
      ps0HarnessPrelude +
        promptDraws +
        readlineAccepts('grep "a  b" file.txt') +
        ps0Expands,
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

function onlyInitFile(init: ReturnType<typeof prepareShellInit>): {
  name: string;
  content: string;
} {
  expect(init.initFiles).toHaveLength(1);
  const [file] = init.initFiles;
  if (!file) throw new Error("expected exactly one init file");
  return file;
}

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
    expect(existsSync(join(rcDir, `bashrc-${id}`))).toBe(false);
    const content = file.content;
    expect(content).toContain("/etc/profile");
    expect(content).toContain("/home/x/.bashrc");
    expect(content).toContain(OSC7_FN);
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

  it("says the same thing twice about every shell: a plan, and wrapped", () => {
    for (const shell of ["/bin/bash", "/usr/bin/bash5", "/bin/zsh"]) {
      expect(isShellKoluWraps(shell)).toBe(true);
      expect(
        prepareShellInit({
          shell,
          home: "/home/x",
          terminalId: "x",
          rcDir: "/r",
        }).initFiles,
      ).toHaveLength(1);
    }
    for (const shell of ["/usr/bin/fish", "/bin/sh", "/bin/dash"])
      expect(isShellKoluWraps(shell)).toBe(false);
  });
});

describeDaemon("prepareShellInit zsh wrapper", () => {
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
      materialise(rcDir, init);
      const rcPath = join(init.env.ZDOTDIR as string, ".zshrc");
      const out = await runZsh(
        `source ${shQuote(rcPath)} >/dev/null 2>&1; printf '%s' "$KOLU_TEST_MARKER"`,
      );
      if (out === null) return;
      expect(out).toBe("loaded");
    } finally {
      rmSync(fakeHome, { recursive: true, force: true });
      rmSync(rcDir, { recursive: true, force: true });
    }
  });
});

describe("readAgentToolsBake", () => {
  it("splits the colon-joined bake, preserving priority order", () => {
    expect(
      readAgentToolsBake({
        [AGENT_TOOLS_BAKE_ENV]: "/nix/store/aaa/bin:/nix/store/bbb/bin",
      }),
    ).toEqual(["/nix/store/aaa/bin", "/nix/store/bbb/bin"]);
  });

  it("reports NO toolchain when unset or empty — never a guessed default", () => {
    expect(readAgentToolsBake({})).toEqual([]);
    expect(readAgentToolsBake({ [AGENT_TOOLS_BAKE_ENV]: "" })).toEqual([]);
  });

  it("drops empty segments so no entry can mean 'the current directory'", () => {
    expect(readAgentToolsBake({ [AGENT_TOOLS_BAKE_ENV]: "/a::/b:" })).toEqual([
      "/a",
      "/b",
    ]);
  });

  it("reads the BAKE name and never the terminal STAMP", () => {
    expect(
      readAgentToolsBake({ [TERMINAL_TOOLS_PATH_ENV]: "/foreign/bin" }),
    ).toEqual([]);
  });
});

describe("prependPathEntries", () => {
  for (const c of PATH_PREPEND_CASES) {
    it(`${c.name} — PATH=${JSON.stringify(c.path)} + [${c.dirs.join(", ")}]`, () => {
      expect(prependPathEntries(c.path, c.dirs)).toBe(c.expect);
    });
  }

  it("treats an absent PATH as empty", () => {
    expect(prependPathEntries(undefined, ["/a"])).toBe("/a");
  });

  it("never introduces an empty entry from the dirs it was asked to add", () => {
    expect(prependPathEntries("/usr/bin:/bin", ["", "/a", ""])).toBe(
      "/a:/usr/bin:/bin",
    );
  });
});

describe("prepareShellInit — PATH re-assert", () => {
  it("emits the re-assert AFTER the dotfile replay (the ordering is the point)", () => {
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
  const TOOLS = "/opt/kolu-tools-fixture/bin";

  async function pathAfterClobber(
    shell: "/bin/bash" | "/bin/zsh",
    rcName: string,
  ): Promise<string | null> {
    const fakeHome = mkdtempSync(join(tmpdir(), "kolu-shell-"));
    const rcDir = mkdtempSync(join(tmpdir(), "kolu-rc-"));
    try {
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
    expect(out.split(":")).toContain("/usr/bin");
  });

  it("zsh: the toolchain survives a dotfile that overwrites PATH", async () => {
    const out = await pathAfterClobber("/bin/zsh", ".zshrc");
    if (out === null) return;
    expect(out.split(":")).toContain(TOOLS);
    expect(out.split(":")).toContain("/usr/bin");
  });

  it("no-ops when the daemon baked no toolchain (from-source parity)", async () => {
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
  for (const c of PATH_PREPEND_CASES) {
    const label = `${c.name} — PATH=${JSON.stringify(c.path)} + [${c.dirs.join(", ")}]`;

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
      if (out === null) return;
      expect(out).toBe(c.expect);
    });
  }
});

describeDaemon("OSC2_PRECMD_ZSH", () => {
  it("emits OSC 2 with compact zsh prompt path", async () => {
    const out = await runZsh(`${OSC2_PRECMD_ZSH}; __kolu_title_precmd`, "/tmp");
    if (out === null) return;
    expect(out).toMatch(/^\x1b\]2;[^\x1b]*\x07$/);
    expect(out).toContain("tmp");
  });

  it("uses compact notation for deep paths", async () => {
    const out = await runZsh(
      `mkdir -p /tmp/kolu-deep-test/a/b/c && ${OSC2_PRECMD_ZSH}; cd /tmp/kolu-deep-test/a/b/c && __kolu_title_precmd`,
    );
    if (out === null) return;
    expect(out).toMatch(/^\x1b\]2;.*\x07$/);
    expect(out).toContain("a/b/c");
  });
});
