/** `buildId.ts` reads the nix-baked identity env, with no dev fallback. */

import { afterEach, expect, it } from "vitest";
import { currentBuildId, currentCommitHash } from "./buildId.ts";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

it("currentBuildId reads the nix-baked KAVAL_BUILD_ID", () => {
  process.env.KAVAL_BUILD_ID = "a1b2c3d4";
  expect(currentBuildId()).toBe("a1b2c3d4");
});

it("currentCommitHash reads the nix-baked KAVAL_COMMIT_HASH", () => {
  process.env.KAVAL_COMMIT_HASH = "deadbee";
  expect(currentCommitHash()).toBe("deadbee");
});

it("both are empty off-nix (env unbaked) — no dev fallback", () => {
  delete process.env.KAVAL_BUILD_ID;
  delete process.env.KAVAL_COMMIT_HASH;
  expect(currentBuildId()).toBe("");
  expect(currentCommitHash()).toBe("");
});
