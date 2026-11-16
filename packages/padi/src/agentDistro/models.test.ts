/**
 * Asking agent-distro about a harness's models on this host — the package's
 * `agent-distro --models <harness>` in the work's repository and
 * `agent-distro --launch <harness>`, against the stand-in the e2e fixture
 * uses too (`@kolu/agent-distro/testing`). Three answers kept apart: a list,
 * a harness that cannot list, and a failure in its own words — never an
 * empty list. And the environment the list runs in: what a new terminal's
 * shell ends up with after the person's dotfiles, not padi's own.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PACKAGE_ANSWERS_FILE } from "@kolu/agent-distro/models";
import { agentsTooOldWords } from "@kolu/agent-distro/status";
import { STAND_IN_ANSWERS, standInModels } from "@kolu/agent-distro/testing";
import {
  AgentLaunchUnavailable,
  AgentModelsUnavailable,
} from "@kolu/padi-client/surface";
import { Effect } from "effect";
import type { PtyHostSystemInfo } from "kaval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeSpawnInput, setSpawnServerVersion } from "../ptyHost/index.ts";
import { readShellEnv, ShellEnvUnreadable } from "../ptyHost/shellEnv.ts";
import { agentDistroSettingStore } from "./agentDistro.ts";
import { __setAgentDistroBakeForTest } from "./bake.ts";
import { listAgentModels, runAgentLaunch, runAgentModels } from "./models.ts";

setSpawnServerVersion("9.9.9-test");

/** The daemon's log, as a record of what was handed to it: what a run printed
 *  is capped BEFORE it reaches a file that outlives the question, and that is
 *  only observable where the log is. */
const logged = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock("../log.ts", () => {
  const one = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: logged.warn,
    error: logged.error,
    child: () => one,
  };
  return { log: one };
});

/** The longest string in the newest call of `said` — what a run printed, as
 *  the log got it. */
const saidInLog = (said: typeof logged.warn): number => {
  const call = said.mock.calls.at(-1);
  if (call === undefined) throw new Error("nothing was logged");
  const fields = call[0] as Record<string, unknown>;
  return Math.max(
    ...Object.values(fields)
      .filter((value) => typeof value === "string")
      .map((value) => value.length),
  );
};

let bundle: string;

/** A package whose picker runs `script` (POSIX sh). */
function picker(script: string): void {
  writeFileSync(join(bundle, "bin", "agent-distro"), `#!/bin/sh\n${script}\n`, {
    mode: 0o755,
  });
}

const OMP = {
  launch: { kind: "flag", flag: "--model" },
  models: {
    kind: "listed",
    ids: ["anthropic/claude-fable-5-2", "litellm/claude-fable-5-2"],
  },
} as const;

const CLAUDE = {
  launch: { kind: "flag", flag: "--model" },
  models: { kind: "unlisted" },
} as const;

beforeEach(() => {
  bundle = realpathSync(mkdtempSync(join(tmpdir(), "agent-distro-models-")));
  mkdirSync(join(bundle, "bin"));
  mkdirSync(join(bundle, "share", "agent-distro"), { recursive: true });
  writeFileSync(join(bundle, PACKAGE_ANSWERS_FILE), STAND_IN_ANSWERS);
  picker(
    `${standInModels({
      omp: OMP,
      claude: CLAUDE,
      broken: {
        launch: { kind: "flag", flag: "--model" },
        fails:
          "agent-distro broken: error: cannot list its models: broken models exited 1",
      },
    })}\nexit 2`,
  );
});
afterEach(() => {
  __setAgentDistroBakeForTest(undefined);
  vi.unstubAllEnvs();
});

const run = (harness: string, cwd = bundle) =>
  runAgentModels({ bundle, cwd, env: {}, harness });

describe("runAgentModels", () => {
  it("a harness that lists: its ids, exactly what the launch takes, and how a launch takes one", async () => {
    expect(await run("omp")).toEqual(OMP);
  });

  it("a harness that cannot list: `unlisted`, never an empty list", async () => {
    const answer = await run("claude");
    expect(answer.models).toEqual({ kind: "unlisted" });
  });

  it("a list command that fails: the declared refusal, in the harness's own words", async () => {
    const failed = await run("broken").catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(AgentModelsUnavailable);
    expect((failed as AgentModelsUnavailable).why).toContain(
      "broken models exited 1",
    );
  });

  it("output kolu cannot read is a refusal, not a guess", async () => {
    picker('echo \'{"harness":"omp"}\'');
    const failed = await run("omp").catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(AgentModelsUnavailable);
    expect((failed as AgentModelsUnavailable).why).toContain(
      "printed something kolu cannot read",
    );
  });

  it("runs in the directory it is given — the work's repository", async () => {
    const repo = join(bundle, "repo");
    mkdirSync(repo);
    picker(
      `d=$(pwd); printf '{"launch":{"kind":"flag","flag":"--model"},"models":{"kind":"listed","ids":["%s"]}}\\n' "\${d##*/}"`,
    );
    expect((await run("omp", repo)).models).toEqual({
      kind: "listed",
      ids: ["repo"],
    });
  });

  it("a package older than `--models` is named as such, and never run", async () => {
    // The delivered package predates the answers file: its picker would take
    // `--models` for a launch and fail with its no-terminal message. kolu
    // learns it from the package, so that message is never read.
    rmSync(join(bundle, PACKAGE_ANSWERS_FILE));
    picker("touch ran; exit 1");
    const failed = await run("omp").catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(AgentModelsUnavailable);
    expect((failed as AgentModelsUnavailable).why).toBe(
      agentsTooOldWords("this host"),
    );
    expect(existsSync(join(bundle, "ran"))).toBe(false);
  });

  it("an answers file that is THERE and names nothing is broken, not old", async () => {
    // A truncated or half-written package. "Too old" would send somebody to
    // wait for an update that has already landed, so the two are told apart.
    writeFileSync(join(bundle, PACKAGE_ANSWERS_FILE), "\n");
    picker("touch ran; exit 1");
    const failed = await run("omp").catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(AgentModelsUnavailable);
    const why = (failed as AgentModelsUnavailable).why;
    expect(why).not.toBe(agentsTooOldWords("this host"));
    expect(why).toContain("broken");
    expect(why).toContain(PACKAGE_ANSWERS_FILE);
    expect(existsSync(join(bundle, "ran"))).toBe(false);
  });

  /** A quarter-megabyte of one letter, with shell builtins alone: the run
   *  gets the environment it is given and nothing else, so `head` and `tr`
   *  are not there to be called. */
  const flood = (letter: string): string =>
    [
      `s=${letter.repeat(32)}`,
      "i=0",
      'while [ $i -lt 13 ]; do s="$s$s"; i=$((i+1)); done',
    ].join("\n");

  it("caps what a flooding list command puts in a refusal and in the log", async () => {
    // The run carries the environment the person's dotfiles built — their
    // keys are in it — so neither the refusal nor the daemon's log file
    // keeps a megabyte of whatever it printed.
    picker([flood("z"), 'echo "$s" >&2', "exit 1"].join("\n"));
    const failed = await run("omp").catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(AgentModelsUnavailable);
    const why = (failed as AgentModelsUnavailable).why;
    expect(why.length).toBeLessThan(2_200);
    expect(why).toContain("characters in all");
    expect(saidInLog(logged.warn)).toBeLessThan(2_200);
  });

  it("caps what it logs of output it cannot read", async () => {
    picker([flood("q"), 'echo "$s"'].join("\n"));
    const failed = await run("omp").catch((err: unknown) => err);
    expect(failed).toBeInstanceOf(AgentModelsUnavailable);
    expect((failed as AgentModelsUnavailable).why).toContain(
      "printed something kolu cannot read",
    );
    expect(saidInLog(logged.error)).toBeLessThan(2_200);
  });
});

describe("listAgentModels", () => {
  it("a host whose agents are not ready refuses in the words a setup refuses with", async () => {
    // An unbaked padi: kolu built without agent-distro.
    __setAgentDistroBakeForTest(null);
    agentDistroSettingStore.set({ enabled: true, profiles: [] });
    const failed = await Effect.runPromise(
      Effect.flip(listAgentModels({ harness: "omp", cwd: bundle })),
    );
    expect(failed).toBeInstanceOf(AgentModelsUnavailable);
    expect((failed as AgentModelsUnavailable).why).toContain(
      "built without agent-distro",
    );
  });
});

describe("the environment a list runs in", () => {
  /** A person's home whose `~/.bashrc` exports a key — behind the guard a
   *  NixOS or home-manager bashrc starts with, so a shell that is not
   *  interactive never sees it. */
  function homeWithKey(): string {
    const home = realpathSync(mkdtempSync(join(tmpdir(), "shell-env-home-")));
    writeFileSync(
      join(home, ".bashrc"),
      [
        "[[ $- == *i* ]] || return",
        'echo "a banner the rc file prints"',
        "export LITELLM_API_KEY=sk-from-bashrc",
      ].join("\n"),
    );
    return home;
  }

  /** The spawn a new terminal in `cwd` gets, as padi composes it — with
   *  `shell` as the person's login shell and `home` as their home. */
  function terminalSpawn(shell: string, home: string, cwd: string) {
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
      input: composeSpawnInput({ id: "shell-env-test", cwd }, info, {
        kavalSocket: join(rcDir, "kaval.sock"),
        toolsPath: [],
        agents: {
          binDir: join(bundle, "bin"),
          plugins: join(bundle, "plugins"),
          profiles: [],
        },
        serverVersion: "9.9.9-test",
      }),
    };
  }

  /** A picker whose list command needs the key, as omp's does behind a
   *  litellm gateway: no key, the harness's own refusal. */
  function needsKey(): void {
    picker(
      [
        'if [ "$1" = "--models" ] && [ -z "$LITELLM_API_KEY" ]; then',
        "  echo 'agent-distro omp: error: cannot list its models: LITELLM_API_KEY is not set' >&2",
        "  exit 1",
        "fi",
        standInModels({ omp: OMP }),
        "exit 2",
      ].join("\n"),
    );
  }

  const bash = execFileSync("sh", ["-c", "command -v bash"], {
    encoding: "utf8",
  }).trim();

  /** What a capture here is bounded by: a generous deadline (these shells
   *  answer in milliseconds) and a question nobody withdraws. */
  const CAPTURE = {
    timeoutMs: 20_000,
    signal: new AbortController().signal,
  };

  it("a key only the person's rc file exports reaches the list", async () => {
    needsKey();
    const { input, rcDir } = terminalSpawn(bash, homeWithKey(), bundle);
    // What padi asked in before: the spawn's own environment, before any rc
    // file ran. The list cannot work there, whatever the person's terminal
    // can do.
    const bare = await runAgentModels({
      bundle,
      cwd: bundle,
      env: input.env,
      harness: "omp",
    }).catch((err: unknown) => err);
    expect((bare as AgentModelsUnavailable).why).toContain(
      "LITELLM_API_KEY is not set",
    );
    // ... and in the environment the terminal's shell ends up with, it does.
    const env = await readShellEnv(input, rcDir, CAPTURE);
    expect(env.LITELLM_API_KEY).toBe("sk-from-bashrc");
    expect(
      await runAgentModels({ bundle, cwd: bundle, env, harness: "omp" }),
    ).toEqual(OMP);
  });

  it("a shell that cannot be asked is a failure naming it, never the bare environment", async () => {
    // Named `bash`, because a shell kolu cannot ask at all is refused before
    // it is run (see `shellEnv.test.ts`); this one is asked, and fails.
    const broken = join(bundle, "bash");
    writeFileSync(
      broken,
      "#!/bin/sh\necho 'broken-shell: cannot read /etc/hostile' >&2\nexit 3\n",
      { mode: 0o755 },
    );
    const { input, rcDir } = terminalSpawn(broken, homeWithKey(), bundle);
    const failed = await readShellEnv(input, rcDir, CAPTURE).catch(
      (err: unknown) => err,
    );
    expect(failed).toBeInstanceOf(ShellEnvUnreadable);
    const words = (failed as ShellEnvUnreadable).message;
    expect(words).toContain(broken);
    expect(words).toContain("exited 3");
    expect(words).toContain("cannot read /etc/hostile");
  });
});

describe("runAgentLaunch", () => {
  it("answers how a launch takes a model, without listing anything", async () => {
    picker(
      [
        'if [ "$1" = "--models" ]; then echo listed >&2; exit 1; fi',
        standInModels({ omp: OMP }),
        "exit 2",
      ].join("\n"),
    );
    expect(await runAgentLaunch({ bundle, harness: "omp" })).toEqual({
      model: OMP.launch,
    });
  });

  it("a package older than `--launch` is named as such, and never run", async () => {
    writeFileSync(join(bundle, PACKAGE_ANSWERS_FILE), "--list\n--models\n");
    picker('touch "$0.ran"; exit 1');
    const failed = await runAgentLaunch({ bundle, harness: "omp" }).catch(
      (err: unknown) => err,
    );
    expect(failed).toBeInstanceOf(AgentLaunchUnavailable);
    expect((failed as AgentLaunchUnavailable).why).toBe(
      agentsTooOldWords("this host"),
    );
    expect(existsSync(join(bundle, "bin", "agent-distro.ran"))).toBe(false);
  });
});
