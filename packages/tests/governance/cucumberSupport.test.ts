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

test("the ui profile defines every step of every feature it runs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kolu-cucumber-support-"));
  try {
    const config = path.join(dir, "cucumber.mjs");
    const profile = pathToFileURL(path.join(packageRoot, "cucumber.js")).href;
    writeFileSync(
      config,
      `import { ui } from ${JSON.stringify(profile)};\n` +
        `export default { import: ui.import, paths: ui.paths, tags: ui.tags,` +
        ` dryRun: true, format: ["summary"] };\n`,
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
      ],
      // No feature argument: `cucumber.js` keys `paths` off the importing
      // process's own argv, and the importer here is this cucumber child, so
      // `ui.paths` is the whole feature tree.
      { cwd: packageRoot, env: process.env, encoding: "utf8" },
    );
    const out = `${result.stdout}${result.stderr}`;
    // A summary that selected nothing prints a bare `0 scenarios`, with no
    // parenthesised breakdown, so the count is read on its own.
    const scenarios = out.match(/^(\d+) scenarios?(?: \(([^)]*)\))?$/m);
    assert.ok(
      scenarios !== null,
      `no scenario summary in the dry run:\n${out}`,
    );
    assert.ok(
      Number(scenarios[1]) >= SCENARIO_FLOOR,
      `the dry run selected ${scenarios[1]} scenarios, under ${SCENARIO_FLOOR}:\n${out}`,
    );
    const steps = out.match(/^(\d+) steps?(?: \(([^)]*)\))?$/m);
    assert.ok(steps !== null, `no step summary in the dry run:\n${out}`);
    assert.doesNotMatch(steps[2] ?? "", /undefined/, steps[0]);
    assert.equal(result.status, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
