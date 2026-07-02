/**
 * `shuffleMode` (in `./surface.ts`) — the single source resolving which luminance
 * family a theme shuffle draws from, given the `shuffleBehavior` preference and
 * the app's resolved dark mode. (The terminal-vocabulary tests —
 * `composeTerminalMetadata` and friends — moved to `@kolu/padi`'s `vocab.test.ts`
 * with the schemas they exercise.)
 */

import { describe, expect, it } from "vitest";
import { shuffleMode } from "./surface.ts";

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
