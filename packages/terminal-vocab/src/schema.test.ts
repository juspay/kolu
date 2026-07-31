/**
 * `shuffleMode` — the single source resolving the candidate-pool filter a theme
 * shuffle applies (`light` / `dark` / `colourful` / unrestricted), given the
 * `shuffleBehavior` preference and the app's RESOLVED dark mode. Both shufflers
 * read it: padi, resolving a `shuffle` new terminal at `lifecycle.create`, and
 * the client, resolving the ⌘⇧J "shuffle this terminal" action.
 */

import { describe, expect, it } from "vitest";
import { shuffleMode } from "./schema.ts";

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

  it("colourful is independent of app light/dark", () => {
    expect(shuffleMode("colourful", true)).toBe("colourful");
    expect(shuffleMode("colourful", false)).toBe("colourful");
  });
});
