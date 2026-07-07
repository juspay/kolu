/**
 * `shuffleMode` (in `./surface.ts`) — the single source resolving which luminance
 * family a theme shuffle draws from, given the `shuffleBehavior` preference and
 * the app's resolved dark mode. (The terminal-vocabulary tests —
 * `composeTerminalMetadata` and friends — moved to `@kolu/padi`'s `vocab.test.ts`
 * with the schemas they exercise.)
 */

import { padiSurface } from "@kolu/padi/surface";
import { describe, expect, it } from "vitest";
import {
  DaemonInventorySchema,
  PadiConvergenceSchema,
  shuffleMode,
  surfaces,
} from "./surface.ts";
import { surfacesWithPadi } from "./surfacesWithPadi.ts";

describe("surfacesWithPadi — the app composes its registry FROM padi", () => {
  it("adds exactly the `padi` sibling to the padi-less `surfaces` map", () => {
    // The padi-less `surfaces` (what `kolu-common/contract` + the client consume)
    // is unchanged; the composed map kolu-server serves adds exactly `padi`,
    // pulling `padiSurface` from @kolu/padi — the post-flip arrow (app→padi).
    expect(Object.keys(surfaces)).not.toContain("padi");
    expect(Object.keys(surfacesWithPadi)).toEqual([
      ...Object.keys(surfaces),
      "padi",
    ]);
    expect(surfacesWithPadi.padi).toBe(padiSurface);
  });
});

describe("shuffleMode", () => {
  it("random imposes no family restriction", () => {
    expect(shuffleMode("random", true)).toBeUndefined();
    expect(shuffleMode("random", false)).toBeUndefined();
  });

  it("dark / light force their family regardless of app mode", () => {
    expect(shuffleMode("dark", false)).toBe("dark");
    expect(shuffleMode("light", true)).toBe("light");
  });

  it("auto tracks the app's resolved dark mode", () => {
    expect(shuffleMode("auto", true)).toBe("dark");
    expect(shuffleMode("auto", false)).toBe("light");
  });
});

describe("PadiConvergenceSchema — a discriminated union: build fields can't disagree with state", () => {
  it("accepts adopted-stale with a real build pair, and the three reason-only states with null", () => {
    expect(
      PadiConvergenceSchema.safeParse({
        state: "adopted-stale",
        runningBuild: "abc",
        expectedBuild: "def",
        detail: "mismatch",
      }).success,
    ).toBe(true);
    for (const state of ["skew-refused", "unconverged", "link-failed"]) {
      expect(
        PadiConvergenceSchema.safeParse({
          state,
          runningBuild: null,
          expectedBuild: null,
          detail: "reason",
        }).success,
      ).toBe(true);
    }
  });

  it("rejects a non-adopted-stale state carrying a build pair, and adopted-stale carrying null", () => {
    expect(
      PadiConvergenceSchema.safeParse({
        state: "link-failed",
        runningBuild: "abc",
        expectedBuild: "def",
        detail: "reason",
      }).success,
    ).toBe(false);
    expect(
      PadiConvergenceSchema.safeParse({
        state: "adopted-stale",
        runningBuild: null,
        expectedBuild: null,
        detail: "mismatch",
      }).success,
    ).toBe(false);
  });
});

describe("DaemonInventorySchema.boundPadi — exactly one representation of 'nothing to report'", () => {
  const binding = { kind: "local" as const };

  it("accepts the top-level null, and an inner object with at least one non-null field", () => {
    expect(
      DaemonInventorySchema.safeParse({ binding, boundPadi: null }).success,
    ).toBe(true);
    expect(
      DaemonInventorySchema.safeParse({
        binding,
        boundPadi: {
          surfaceVersion: "1.2",
          buildCommit: null,
          convergence: null,
        },
      }).success,
    ).toBe(true);
  });

  it("rejects the redundant inner all-null shape — that meaning is spelled only as top-level null", () => {
    expect(
      DaemonInventorySchema.safeParse({
        binding,
        boundPadi: { surfaceVersion: null, buildCommit: null, convergence: null },
      }).success,
    ).toBe(false);
  });
});
