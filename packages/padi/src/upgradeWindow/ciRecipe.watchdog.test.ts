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
import { assertRecipeWired } from "@kolu/surface-daemon/upgrade-window.testlib";
import { expect, test } from "vitest";

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const CI = readFileSync(join(REPO_ROOT, "ci", "mod.just"), "utf8");

test("ci/mod.just wires `upgrade-window` into the default DAG", () => {
  const defaultTarget = CI.split("\n").find((l) => l.startsWith("default:"));
  expect(defaultTarget).toBeDefined();
  expect((defaultTarget as string).split(/\s+/)).toContain("upgrade-window");
});

test("the `upgrade-window` recipe requires the previous binary + anti-collapse rules", () => {
  assertRecipeWired(CI, "upgrade-window", [
    "KOLU_UPGRADE_WINDOW_REQUIRE=1",
    "previousRelease.e2e.test.ts",
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
