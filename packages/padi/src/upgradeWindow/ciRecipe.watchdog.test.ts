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

const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);
const CI = readFileSync(join(REPO_ROOT, "ci", "mod.just"), "utf8");

function upgradeWindowRecipe(): string {
  const lines = CI.split("\n");
  const start = lines.findIndex((l) => /^upgrade-window:/.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const bodyText = lines.slice(start).join("\n");
  const next = bodyText.search(/\n[a-zA-Z][a-zA-Z0-9_-]*:/);
  return next === -1 ? bodyText : bodyText.slice(0, next);
}

test("ci/mod.just wires `upgrade-window` into the default DAG", () => {
  const defaultTarget = CI.split("\n").find((l) => l.startsWith("default:"));
  expect(defaultTarget).toBeDefined();
  expect((defaultTarget as string).split(/\s+/)).toContain("upgrade-window");
});

test("the `upgrade-window` recipe requires the previous binary + anti-collapse rules", () => {
  const recipe = upgradeWindowRecipe();
  expect(recipe).toContain("KOLU_UPGRADE_WINDOW_REQUIRE=1");
  expect(recipe).toContain("previousRelease.e2e.test.ts");
  expect(recipe).toContain("KOLU_DAEMON_TESTS=1");
  // CI checkouts are tag-less — discover via ls-remote (origin + github URL),
  // then fetch that specific tag into the object store.
  expect(recipe).toContain("git ls-remote --tags");
  expect(recipe).toContain("https://github.com/juspay/kolu");
  expect(recipe).toContain("refs/tags/");
  // Version-tag only — no silent SHA fallback.
  expect(recipe).toMatch(/v\[0-9\]/);
  expect(recipe).toContain("REFUSING");
  // Store-path inequality — same path means the window collapsed.
  expect(recipe).toContain(".#kaval");
  expect(recipe).toContain("prev_out");
  expect(recipe).toContain("curr_out");
  expect(recipe).toMatch(/prev_out.*curr_out/);
  expect(recipe).toContain("store paths differ");
  expect(recipe).toContain("KOLU_PREVIOUS_KAVAL_REF");
  expect(recipe).toContain("KOLU_PREVIOUS_KAVAL_STORE");
  expect(recipe).toContain("KOLU_CURRENT_KAVAL_STORE");
});
