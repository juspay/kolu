/**
 * The e2e profile's support code loads WHOLE: every step a feature names is
 * defined once cucumber has imported what the `ui` profile tells it to.
 *
 * A file the profile imports runs inside every cucumber process, so one that
 * is not support code can take the run down without failing a step of its
 * own — a harness unit test that opens its own support library resets the
 * builder and leaves every step registered before it undefined. A dry run of
 * one feature with the profile's own `import` list answers whether the library
 * survived. It runs in a child process, as `runE2e.ts` runs cucumber, and with
 * only that list taken from the profile, so it writes none of the run's
 * reports.
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

test("the ui profile defines every step of a feature it runs", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kolu-cucumber-support-"));
  try {
    const config = path.join(dir, "cucumber.mjs");
    const profile = pathToFileURL(path.join(packageRoot, "cucumber.js")).href;
    writeFileSync(
      config,
      `import { ui } from ${JSON.stringify(profile)};\n` +
        `export default { import: ui.import, dryRun: true, format: ["summary"] };\n`,
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
        "features/agent-presence.feature",
      ],
      { cwd: packageRoot, env: process.env, encoding: "utf8" },
    );
    const out = `${result.stdout}${result.stderr}`;
    const steps = out.match(/^(\d+) steps? \(([^)]*)\)$/m);
    assert.ok(steps !== null, `no step summary in the dry run:\n${out}`);
    assert.doesNotMatch(steps[2], /undefined/, steps[0]);
    assert.equal(result.status, 0, out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
