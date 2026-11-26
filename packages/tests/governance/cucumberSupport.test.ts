/**
 * The e2e profile's support code loads WHOLE: every step a feature names is
 * defined once cucumber has imported what the `ui` profile tells it to.
 *
 * A file the profile imports runs inside every cucumber process, so one that
 * is not support code can take the run down without failing a step of its
 * own — a harness unit test that opens its own support library resets the
 * builder and leaves every step registered before it undefined. A dry run of
 * the WHOLE profile — its `import` list, its `paths` and its `tags` — answers
 * whether the library survived across every feature the lane runs, which is
 * the question the e2e lanes answer at execution time. It runs in a child
 * process, as `runE2e.ts` runs cucumber, with only those three keys taken
 * from the profile, so it writes none of the run's reports.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const cucumber = path.join(
  packageRoot,
  "node_modules/@cucumber/cucumber/bin/cucumber-js",
);

// The floor is well under today's count (774 scenarios, 8337 steps) so that
// adding or retiring features never makes this test the thing to edit, and
// far above any single feature (the largest is in the dozens), so a `paths`
// or `tags` slip that selects almost nothing is caught rather than passed.
const SCENARIO_FLOOR = 500;

/**
 * Dry-run the `ui` profile in a child cucumber process and return its output.
 *
 * `features` are passed as positional arguments, which `cucumber.js` reads
 * off the importing process's own argv — the importer is this child, so a
 * feature argument drops `ui.paths` and lets the argument select the run,
 * exactly as `just record` and a one-feature `just test` do. `env` is added
 * to this process's environment, so the profile's env-keyed `tags` is
 * computed the way the lane computes it.
 */
function dryRun(features: string[], env: NodeJS.ProcessEnv = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "kolu-cucumber-support-"));
  try {
    const config = path.join(dir, "cucumber.mjs");
    const profile = pathToFileURL(path.join(packageRoot, "cucumber.js")).href;
    writeFileSync(
      config,
      `import { ui } from ${JSON.stringify(profile)};\n` +
        `export default { import: ui.import, ...(ui.paths && { paths: ui.paths }),` +
        ` tags: ui.tags, dryRun: true, format: ["summary"] };\n`,
    );
    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        cucumber,
        "--config",
        // cucumber joins the config path onto its cwd, so it goes relative.
        path.relative(packageRoot, config),
        ...features,
      ],
      { cwd: packageRoot, env: { ...process.env, ...env }, encoding: "utf8" },
    );
    return { out: `${result.stdout}${result.stderr}`, status: result.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Assert the summary selected at least `floor` scenarios, none undefined. */
function assertSelected(
  { out, status }: { out: string; status: number | null },
  floor: number,
) {
  // A summary that selected nothing prints a bare `0 scenarios`, with no
  // parenthesised breakdown, so the count is read on its own.
  const scenarios = out.match(/^(\d+) scenarios?(?: \(([^)]*)\))?$/m);
  assert.ok(scenarios !== null, `no scenario summary in the dry run:\n${out}`);
  assert.ok(
    Number(scenarios[1]) >= floor,
    `the dry run selected ${scenarios[1]} scenarios, under ${floor}:\n${out}`,
  );
  const steps = out.match(/^(\d+) steps?(?: \(([^)]*)\))?$/m);
  assert.ok(steps !== null, `no step summary in the dry run:\n${out}`);
  assert.doesNotMatch(steps[2] ?? "", /undefined/, steps[0]);
  assert.equal(status, 0, out);
}

test("the ui profile defines every step of every feature it runs", () => {
  // No feature argument: `ui.paths` is the whole feature tree.
  assertSelected(dryRun([]), SCENARIO_FLOOR);
});

/**
 * `recordings.feature` is `@recording`, which the default tag filter excludes;
 * only `KOLU_X11CAP` (set by `just record`) admits it, so the lane's dry run
 * above never checks its step text. This child sets that key and names the
 * feature, which is the pair `just record` uses.
 *
 * It proves the `@recording` steps are DEFINED — nothing more. The recording
 * flow itself launches real agents under X11 capture and stays unexercised
 * here; on Solid 2 it is first exercised by the next `just record`.
 */
test("the ui profile defines every step of the @recording feature", () => {
  assertSelected(
    dryRun(["features/recordings.feature"], { KOLU_X11CAP: "1" }),
    1,
  );
});
