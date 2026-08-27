/** **`@kolu/solid-dockrow/rowValues` is the PURE half — as an invariant, not a
 *  promise.**
 *
 *  `rowValues.ts`'s header says the folds carry "no JSX in the import graph", and
 *  that sentence is load-bearing for two different readers: a node-environment
 *  Vitest that cannot transform a Solid component out of a workspace dependency,
 *  and a consumer's SERVER, which folds rows to a wire and must not compile a
 *  component library to do it.
 *
 *  Until now nothing failed if a fold reached for one. A stated invariant the
 *  import graph contradicts will be relied on and will break — this repo has the
 *  scar (`@kolu/padi/render`'s "no I/O, no transport, no tty", twice). So the
 *  sentence gets a test.
 *
 *  It reuses `walkRuntimeDepEdges`, the walker `@kolu/padi-client`'s hydrate
 *  closure already asks the structurally identical question with ("what does a
 *  consumer of this entry actually get"). A second hand-rolled walker beside it
 *  would be the duplicate this package spends itself refusing. */

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
      // LOAD-BEARING, not a nicety. `RowLabel.tsx` and `forgeIcons.tsx` import
      // solid-js TYPE-ONLY, so under the walker's default (runtime edges only)
      // either could join this graph contributing zero solid-js specifier and
      // this guard would pass on a component. It is also the right answer on
      // the merits: kolu ships raw TypeScript, so a consumer's `tsc` resolves a
      // type edge exactly as it resolves a value one.
      includeTypeOnly: true,
    });
    expect(violations).toEqual([]);

    // `reachedSpecifiers`, NOT `reachedPackages`. The walker fills
    // `reachedPackages` only with WORKSPACE MEMBERS whose files it opened, and
    // solid-js is not a workspace member — so `not.toContain("solid-js")` on
    // that field passes even when walked from this package's own barrel, which
    // value-imports `solid-js` and `solid-js/web`. A guard that cannot fail is
    // worse than no guard: it reads as one.
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
