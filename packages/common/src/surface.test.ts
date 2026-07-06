/**
 * `shuffleMode` (in `./surface.ts`) — the single source resolving which luminance
 * family a theme shuffle draws from, given the `shuffleBehavior` preference and
 * the app's resolved dark mode. (The terminal-vocabulary tests —
 * `composeTerminalMetadata` and friends — moved to `@kolu/padi`'s `vocab.test.ts`
 * with the schemas they exercise.)
 */

import { padiSurface } from "@kolu/padi/surface";
import { describe, expect, it } from "vitest";
import { shuffleMode, surfaces } from "./surface.ts";
import { surfacesWithPadi } from "./surfacesWithPadi.ts";

describe("surfacesWithPadi — the app composes its registry FROM padi", () => {
  it("adds exactly the `padi` sibling (the MIRRORED surface) to the padi-less map", () => {
    // The padi-less `surfaces` (what `kolu-common/contract` + the client consume)
    // is unchanged; the composed map kolu-server serves adds exactly `padi`,
    // pulling `padiSurface` from @kolu/padi — the post-flip arrow (app→padi).
    expect(Object.keys(surfaces)).not.toContain("padi");
    expect(Object.keys(surfacesWithPadi)).toEqual([
      ...Object.keys(surfaces),
      "padi",
    ]);
    // W4: the padi sibling is the MIRRORED surface — `padiSurface` PLUS the
    // framework `connection` cell the re-serve adds per host (so per-host readiness
    // folds into `padi.health().live`). So it carries every padi member AND
    // `connection`, which the bare `padiSurface` lacks.
    expect(surfacesWithPadi.padi.spec.cells).toHaveProperty("connection");
    for (const cell of Object.keys(padiSurface.spec.cells ?? {})) {
      expect(surfacesWithPadi.padi.spec.cells).toHaveProperty(cell);
    }
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
