/**
 * The upgrade-window CI recipe must stay wired into the default DAG — same
 * class of backstop as `@kolu/daemon-test-gate`'s daemon-node.test.ts. Without
 * this, a recipe refactor could drop the previous-release e2e and CI would
 * still go green.
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

test("ci/mod.just wires `upgrade-window` into the default DAG", () => {
  const defaultTarget = CI.split("\n").find((l) => l.startsWith("default:"));
  expect(defaultTarget).toBeDefined();
  expect((defaultTarget as string).split(/\s+/)).toContain("upgrade-window");
});

test("the `upgrade-window` recipe requires the previous binary (KOLU_UPGRADE_WINDOW_REQUIRE=1)", () => {
  const lines = CI.split("\n");
  const start = lines.findIndex((l) => /^upgrade-window:/.test(l));
  expect(start).toBeGreaterThanOrEqual(0);
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (
      /^\s+\S/.test(line) ||
      line.trim() === "" ||
      line.startsWith("#!") ||
      line.startsWith("    ")
    )
      body.push(line);
    else break;
  }
  // Recipe body is a shebang script — collect until the next top-level recipe.
  const bodyText = lines.slice(start).join("\n");
  const next = bodyText.search(/\n[a-zA-Z][a-zA-Z0-9_-]*:/);
  const recipe = next === -1 ? bodyText : bodyText.slice(0, next);
  expect(recipe).toContain("KOLU_UPGRADE_WINDOW_REQUIRE=1");
  expect(recipe).toContain("previousRelease.e2e.test.ts");
  expect(recipe).toContain("KOLU_DAEMON_TESTS=1");
});
