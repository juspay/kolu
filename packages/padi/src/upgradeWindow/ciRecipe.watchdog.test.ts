/**
 * The upgrade-window CI recipe must stay wired into the default DAG — same
 * class of backstop as `@kolu/daemon-test-gate`'s daemon-node.test.ts. Without
 * this, a recipe refactor could drop the previous-release e2e and CI would
 * still go green.
 *
 * Also pins the anti-collapse rules: git fetch --tags, version-tag-only ref,
 * and previous≠current store-path inequality (the miss that green-washed the
 * first landing when a tag-less checkout fell back to the last kaval commit).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { assertRecipeWired } from "@kolu/surface-daemon/upgrade-window.testlib";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const CI = readFileSync(join(REPO_ROOT, "ci", "mod.just"), "utf8");

/** The one file `ci::upgrade-window` owns — named once, asserted from both ends. */
const WINDOW_TEST = "src/upgradeWindow/previousRelease.e2e.test.ts";

test("ci/mod.just wires `upgrade-window` into the default DAG", () => {
  const defaultTarget = CI.split("\n").find((l) => l.startsWith("default:"));
  expect(defaultTarget).toBeDefined();
  expect((defaultTarget as string).split(/\s+/)).toContain("upgrade-window");
});

test("the `upgrade-window` recipe requires the previous binary + anti-collapse rules", () => {
  assertRecipeWired(CI, "upgrade-window", [
    "KOLU_UPGRADE_WINDOW_REQUIRE=1",
    WINDOW_TEST,
    "KOLU_DAEMON_TESTS=1",
    "git ls-remote --tags",
    "https://github.com/juspay/kolu",
    "refs/tags/",
    /v\[0-9\]/,
    "REFUSING",
    ".#kaval",
    "prev_out",
    "curr_out",
    /prev_out.*curr_out/,
    "store paths differ",
    "KOLU_PREVIOUS_KAVAL_REF",
    "KOLU_PREVIOUS_PADI_BIN",
    "KOLU_PREVIOUS_KAVAL_STORE",
    "KOLU_CURRENT_KAVAL_STORE",
  ]);
});

test("the ordinary daemon lane leaves the window to that recipe", () => {
  // The window boots a previous-release kaval and drives a real restart — ~3
  // minutes, measured, and the single most expensive thing in the `daemon` CI
  // node. It has its OWN node for exactly that reason (see this file's header
  // and the suite's), but `padi`'s suite collected it anyway and paid for a
  // second, WEAKER copy every run: no KOLU_PREVIOUS_* env, so it re-derived the
  // previous tag and nix-built it again, and no KOLU_UPGRADE_WINDOW_REQUIRE, so
  // a collapse there would not even have failed. The `test:daemon` script
  // excludes it; `upgrade-window` names it explicitly and keeps running it,
  // which the assertion above pins from the other end.
  const manifest = JSON.parse(
    readFileSync(join(REPO_ROOT, "packages", "padi", "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const lane = manifest.scripts?.["test:daemon"];
  expect(
    lane,
    "padi is a daemon-lane package — it must declare `test:daemon`",
  ).toBeDefined();
  expect(
    lane,
    `\`test:daemon\` must exclude ${WINDOW_TEST}: \`upgrade-window\` owns it, and running ` +
      `it in the lane too costs ~3 minutes per CI run for a strictly weaker copy`,
  ).toContain(`--exclude ${WINDOW_TEST}`);
});
