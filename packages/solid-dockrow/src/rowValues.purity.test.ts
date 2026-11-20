import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkRuntimeDepEdges } from "@kolu/daemon-test-gate/runtimeDepEdges";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SRC, "..", "..", "..");

describe("@kolu/solid-dockrow/rowValues", () => {
  it("reaches no solid-js edge", () => {
    const { violations, reachedSpecifiers } = walkRuntimeDepEdges({
      repoRoot: REPO_ROOT,
      entries: [join(SRC, "rowValues.ts")],
      includeTypeOnly: true,
    });
    expect(violations).toEqual([]);

    const solid = reachedSpecifiers.filter(
      (s) => s === "solid-js" || s.startsWith("solid-js/"),
    );
    expect(
      solid,
      "the PURE half reached SolidJS. A fold started importing a component — " +
        "move the fold, or move the component out of its graph. A consumer's " +
        "server folds rows with this entry and must not compile a component " +
        "library to do it.",
    ).toEqual([]);
  });
});
