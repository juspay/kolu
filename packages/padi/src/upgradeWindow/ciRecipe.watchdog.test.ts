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
