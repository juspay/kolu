/**
 * Asking agent-distro which models a harness offers on this host — one run of
 * the package's `agent-distro --models <harness>` in the work's repository,
 * against the stand-in the e2e fixture uses too (`@kolu/agent-distro/testing`).
 * Three answers kept apart: a list, a harness that cannot list, and a failure
 * in its own words — never an empty list.
 */

import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { standInModels } from "@kolu/agent-distro/testing";
import { AgentModelsUnavailable } from "@kolu/padi-client/surface";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentDistroSettingStore } from "./agentDistro.ts";
import { __setAgentDistroBakeForTest } from "./bake.ts";
import { listAgentModels, runAgentModels } from "./models.ts";

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
  picker(
    `${standInModels({
      omp: OMP,
      claude: CLAUDE,
      broken: {
        fails:
          "agent-distro broken: error: cannot list its models: broken models exited 1",
      },
    })}\nexit 2`,
  );
});

afterEach(() => {
  __setAgentDistroBakeForTest(undefined);
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
});

describe("listAgentModels", () => {
  it("a host whose agents are not ready refuses in the words a setup refuses with", async () => {
    // An unbaked padi: kolu built without agent-distro.
    __setAgentDistroBakeForTest(null);
    agentDistroSettingStore.set({ enabled: true, profiles: [] });
    const failed = await listAgentModels({ harness: "omp", cwd: bundle }).catch(
      (err: unknown) => err,
    );
    expect(failed).toBeInstanceOf(AgentModelsUnavailable);
    expect((failed as AgentModelsUnavailable).why).toContain(
      "built without agent-distro",
    );
  });
});
