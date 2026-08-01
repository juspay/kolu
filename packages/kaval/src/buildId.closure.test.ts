/**
 * The dependency-edge guard for kaval's CURRENCY key (`currentBuildId()` /
 * `KAVAL_BUILD_ID`).
 *
 * kaval's staleKey drives ONE thing: the human "update available" nudge (its
 * build-mismatch policy is `nudge-human`, because recycling kaval to pick up a
 * new build KILLS live PTYs). Its hashed slice is DERIVED, not hand-listed
 * (juspay/kolu#2094): `default.nix` walks kaval's package.json `dependencies`
 * closure and subtracts kaval's documented `stableLeaves` — which today
 * resolves to the two BEHAVIORAL roots, kaval itself and
 * `@kolu/terminal-protocol` (the wire/behaviour it serves). The slice POLICY —
 * notably that the `@kolu/surface-daemon` spine is a stable leaf, the zest
 * 2026-07-03 lesson (#L3): a contract-COMPATIBLE spine refactor must not fire
 * the PTY-costing nudge, because the spine's behavioral surface IS the wire
 * contract (`PTY_HOST_CONTRACT_VERSION`, hashed in kaval/src) — lives with its
 * rationale on `default.nix`'s stableLeaves, in ONE place. A NEW kaval
 * dependency joins the hashed slice automatically (the safe direction: at worst
 * an early nudge) until deliberately declared a leaf there.
 *
 * What this test guards is the ONE assumption the derivation rests on: the
 * manifests must be an honest map of what a kaval restart can load. From
 * kaval's two entry roots — `index.ts` (the embedded library surface) and
 * `bin.ts` (the standalone daemon executable) — every reachable runtime import
 * must be declared in the importing package's `dependencies`; a runtime module
 * riding a devDependency link would be invisible to the derived closure (the
 * #2094 hole), so it fails here. (Type-only imports are erased by tsx and
 * exempt; the walker is shared — see
 * `@kolu/daemon-test-gate/runtimeDepEdges`.)
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkRuntimeDepEdges } from "@kolu/daemon-test-gate/runtimeDepEdges";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url)); // packages/kaval/src
const REPO_ROOT = resolve(SRC, "../../..");

describe("kaval currency key (the staleKey's derived slice)", () => {
  it("declares every runtime import in `dependencies`, so the nix-derived staleKey is sound", () => {
    const { violations } = walkRuntimeDepEdges({
      repoRoot: REPO_ROOT,
      entries: [resolve(SRC, "index.ts"), resolve(SRC, "bin.ts")],
    });
    expect(
      violations,
      "Runtime import edge(s) reachable from kaval's entries are not honest `dependencies` edges — nix's derived KAVAL_BUILD_ID cannot see code reached through them. Move each offending package into the importing package.json's `dependencies` (with the workspace: protocol for workspace members).",
    ).toEqual([]);
  });
});
