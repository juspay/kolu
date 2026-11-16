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
    const env = await readShellEnv(input, rcDir);
    expect(env.LITELLM_API_KEY).toBe("sk-from-bashrc");
    expect(
      await runAgentModels({ bundle, cwd: bundle, env, harness: "omp" }),
    ).toEqual(OMP);
  });

  it("a shell that cannot be asked is a failure naming it, never the bare environment", async () => {
    const broken = join(bundle, "broken-shell");
    writeFileSync(
      broken,
      "#!/bin/sh\necho 'broken-shell: cannot read /etc/hostile' >&2\nexit 3\n",
      { mode: 0o755 },
    );
    const { input, rcDir } = terminalSpawn(broken, homeWithKey(), bundle);
    const failed = await readShellEnv(input, rcDir).catch(
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
