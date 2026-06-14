/** `buildId.ts` reads the nix-baked identity env, with no dev fallback. */

import { afterEach, expect, it } from "vitest";
import {
  currentBuildId,
  currentCommitHash,
  currentPtyHostIdentity,
} from "./buildId.ts";

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

// The server calls this in-process to learn the kaval it WOULD spawn — the
// `expected` operand of B3.4's currency nudge (surfaced as `buildInfo.expectedKaval`).
it("currentPtyHostIdentity assembles the baked id — the server's *expected* kaval", () => {
  process.env.KAVAL_BUILD_ID = "a1b2c3d4";
  process.env.KAVAL_COMMIT_HASH = "deadbee";
  expect(currentPtyHostIdentity()).toEqual({
    staleKey: "a1b2c3d4",
    navigableCommit: "deadbee",
  });
});

it("currentPtyHostIdentity is empty off-nix — the read-site nudge stays silent", () => {
  delete process.env.KAVAL_BUILD_ID;
  delete process.env.KAVAL_COMMIT_HASH;
  expect(currentPtyHostIdentity()).toEqual({
    staleKey: "",
    navigableCommit: "",
  });
});
