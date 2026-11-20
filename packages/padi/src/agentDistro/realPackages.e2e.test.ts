import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  manifestFile,
  parseAgentDistroManifest,
} from "@kolu/agent-distro/manifest";
import { floorListing } from "@kolu/agent-distro/listing";
import { isAgentModelId, missingPackageCalls } from "@kolu/agent-distro/models";
import { agentsTooOldWords } from "@kolu/agent-distro/status";
import { AgentModelsUnavailable } from "@kolu/padi-client/surface";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAgentLaunch, runAgentModels } from "./models.ts";
import { type PackageAnswers, packageAnswers } from "./onHost.ts";

const FLOOR_BUNDLE_ENV = "KOLU_AGENT_FLOOR_BUNDLE";
const PRE_MODELS_PACKAGE_ENV = "KOLU_AGENT_PRE_MODELS_PACKAGE";

const LAUNCH_TIMEOUT_MS = 240_000;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(
      `${name} is unset — this file is run by \`just test-agent-models\` (ci::agent-models), which builds the package it names. Run that recipe, never this file bare.`,
    );
  return value;
}

function floorPackage(bundle: string): string {
  return parseAgentDistroManifest(readFileSync(manifestFile(bundle), "utf8"))
    .dir;
}

let home: string;
let cwd: string;

beforeAll(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "agent-models-home-")));
  cwd = realpathSync(mkdtempSync(join(tmpdir(), "agent-models-cwd-")));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

const answerFlags = (answers: PackageAnswers): ReadonlyArray<string> =>
  answers.kind === "answers" ? answers.flags : [];

const run = (bundle: string, harness: string) =>
  runAgentModels({
    bundle,
    cwd,
    env: { HOME: home, PATH: process.env.PATH ?? "" },
    harness,
  });

describe("the floor package this tree builds", () => {
  it("answers every call kolu's contract makes", () => {
    const floor = floorPackage(required(FLOOR_BUNDLE_ENV));
    expect(missingPackageCalls(answerFlags(packageAnswers(floor)))).toEqual([]);
  });

  it("says how a launch takes a model for every harness it carries — running none", async () => {
    const bundle = required(FLOOR_BUNDLE_ENV);
    const manifest = parseAgentDistroManifest(
      readFileSync(manifestFile(bundle), "utf8"),
    );
    const listing = floorListing(manifest, (path) =>
      readFileSync(path, "utf8"),
    );
    const names =
      listing.kind === "available"
        ? listing.harnesses.map((one) => one.name)
        : [];
    expect(names.length).toBeGreaterThan(0);
    for (const harness of names) {
      const answer = await runAgentLaunch({ bundle: manifest.dir, harness });
      expect(["flag", "config"]).toContain(answer.model.kind);
    }
  });

  it(
    "claude: a real launcher with no list — `unlisted`, and `--model` to launch with",
    async () => {
      const answer = await run(
        floorPackage(required(FLOOR_BUNDLE_ENV)),
        "claude",
      );
      expect(answer).toEqual({
        launch: { kind: "flag", flag: "--model" },
        models: { kind: "unlisted" },
      });
    },
    LAUNCH_TIMEOUT_MS,
  );

  it(
    "omp: a real list, and every id upstream's own rule accepts",
    async () => {
      const answer = await run(floorPackage(required(FLOOR_BUNDLE_ENV)), "omp");
      expect(answer.launch).toEqual({ kind: "flag", flag: "--model" });
      expect(answer.models.kind).toBe("listed");
      const ids = answer.models.kind === "listed" ? answer.models.ids : [];
      expect(ids.filter((id) => !isAgentModelId(id))).toEqual([]);
    },
    LAUNCH_TIMEOUT_MS,
  );
});

describe("the package from before upstream's `--models`", () => {
  it("says it answers nothing kolu calls", () => {
    const old = required(PRE_MODELS_PACKAGE_ENV);
    expect(packageAnswers(old)).toEqual({ kind: "pre-models" });
    expect(missingPackageCalls(answerFlags(packageAnswers(old)))).toEqual([
      "--models",
      "--launch",
    ]);
  });

  it(
    "is refused as older than this kolu — in the skew's words, never the picker's error",
    async () => {
      const old = required(PRE_MODELS_PACKAGE_ENV);
      const failed = await run(old, "omp").catch((err: unknown) => err);
      expect(failed).toBeInstanceOf(AgentModelsUnavailable);
      const why = (failed as AgentModelsUnavailable).why;
      expect(why).toBe(agentsTooOldWords("this host"));
      expect(why).not.toContain("agent-distro picker:");
    },
    LAUNCH_TIMEOUT_MS,
  );
});
