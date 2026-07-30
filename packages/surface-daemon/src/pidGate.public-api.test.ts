/**
 * Pins the production-root / testlib split for pid-gate probe seams (R5-1).
 * A re-export of `setSocketProbeDepsForTests` from the package root must red.
 */

import { describe, expect, it } from "vitest";
import * as root from "./index.ts";
import { setSocketProbeDepsForTests } from "./pidGate.testlib.ts";

describe("pid-gate production root does not export test seams (R5-1)", () => {
  it("setSocketProbeDepsForTests is absent from the production root", () => {
    expect(
      Object.prototype.hasOwnProperty.call(root, "setSocketProbeDepsForTests"),
    ).toBe(false);
    // And not present as a value either (covers accidental namespace spread).
    expect(
      (root as { setSocketProbeDepsForTests?: unknown })
        .setSocketProbeDepsForTests,
    ).toBeUndefined();
  });

  it("setSocketProbeDepsForTests remains available on ./pidGate.testlib", () => {
    expect(typeof setSocketProbeDepsForTests).toBe("function");
  });
});
