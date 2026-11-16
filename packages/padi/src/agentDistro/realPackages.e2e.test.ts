/**
 * THE REAL PACKAGES, ASKED — padi's model call against two packages Nix built
 * from agent-distro itself: the FLOOR this tree pins, and the one upstream's
 * `main` was at one commit BEFORE `--models` existed
 * (juspay/agent-distro#163's parent). Nothing here stands in for a launcher.
 *
 * It is the test the skew bug walked past. Every other test of this call uses
 * upstream's stand-in picker (`@kolu/agent-distro/testing`), so the whole suite
 * stayed green while a host — which serves the package kolu DELIVERED,
 * upstream's newest PUBLISHED one, not this tree's floor — answered the setup
 * form with the old picker's "run this from a terminal" error. Two halves,
 * because either alone would have stayed green:
 *
 *   * the floor really answers `--models` for a real harness, read by kolu's
 *     own parser;
 *   * a really older package is refused by kolu in the skew's own words
 *     ({@link agentsTooOldWords}) and its picker is never run.
 *
 * A LANE, NOT A SANDBOXED CHECK (`ci::agent-models`, `just test-agent-models`).
 * These are real launchers: they want a writable HOME, and a harness that
 * lists asks its own catalogue — neither is available to a Nix check, which
 * builds with no network and a read-only home. The lane builds both packages
 * and names them in the two variables below; this file REFUSES to run without
 * them rather than skipping, because it is excluded from padi's default lanes
 * (`package.json`'s `test:daemon`) and a silent skip would be the same
 * invisible green the bug shipped behind.
 */

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
import { packageAnswers } from "./onHost.ts";

/** The floor's bundle (`nix build .#agent-distro-bundle`), whose manifest
 *  names the package, and the pre-`--models` package
 *  (`nix build -f default.nix agent-distro-pre-models`). */
const FLOOR_BUNDLE_ENV = "KOLU_AGENT_FLOOR_BUNDLE";
const PRE_MODELS_PACKAGE_ENV = "KOLU_AGENT_PRE_MODELS_PACKAGE";

/** A real launcher takes as long as a first terminal launch does. */
const LAUNCH_TIMEOUT_MS = 240_000;

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "")
    throw new Error(
      `${name} is unset — this file is run by \`just test-agent-models\` (ci::agent-models), which builds the package it names. Run that recipe, never this file bare.`,
    );
  return value;
}

/** The package inside a floor bundle, read the way kolu-server reads it. */
function floorPackage(bundle: string): string {
  return parseAgentDistroManifest(readFileSync(manifestFile(bundle), "utf8"))
    .dir;
}

let home: string;
let cwd: string;

beforeAll(() => {
  // A HOME of its own (a launcher writes there) and a directory with no
  // `plugin.json`, so a harness's first run in it fetches no plugin.
  home = realpathSync(mkdtempSync(join(tmpdir(), "agent-models-home-")));
  cwd = realpathSync(mkdtempSync(join(tmpdir(), "agent-models-cwd-")));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
});

/** The call a setup form makes, against `bundle`. The environment is explicit
 *  (padi hands a launcher a clean one): a writable HOME and this process's
 *  PATH, which is what the launchers' own tools are reached through. */
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
    expect(missingPackageCalls(packageAnswers(floor))).toEqual([]);
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
      // Read by kolu's own parser; a harness the adapter has no word for
      // would throw here, never answer an empty launch.
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
      // `listed`, never `unlisted`: omp HAS a list command, and that is the
      // half a package older than `--models` cannot answer at all.
      //
      // The ids themselves are whatever that HOME's omp can see. omp lists its
      // catalogue from the credentials under `$HOME` (`~/.omp`), so on this
      // temp home — and on a CI box, which has no account — the real answer is
      // an EMPTY list, where the same call on a signed-in machine answers
      // dozens. So the assertion is the rule, not a count: every id omp does
      // list must be one kolu can hand a launch.
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
    expect(packageAnswers(old)).toEqual([]);
    expect(missingPackageCalls(packageAnswers(old))).toEqual([
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
      // What a host served before this was the old picker taking `--models`
      // for a launch with no terminal. kolu reads the package, so that line is
      // never what a person is shown.
      expect(why).not.toContain("agent-distro picker:");
    },
    LAUNCH_TIMEOUT_MS,
  );
});
