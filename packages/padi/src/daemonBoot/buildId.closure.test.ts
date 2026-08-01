/**
 * The dependency-edge guard for padi's staleKey (W2.2) — the twin of kaval's
 * `buildId.closure.test.ts`, one layer up.
 *
 * `PADI_BUILD_ID` is DERIVED, not hand-listed (juspay/kolu#2094): `default.nix`
 * hashes the transitive package.json `dependencies` closure of `@kolu/padi`
 * (`nix/workspace.nix`'s `depClosure`, following `workspace:` edges, minus the
 * documented framework-tier `stableLeaves`). There is no file list here to keep
 * in lockstep any more — nix reads the same manifests pnpm resolves by.
 *
 * What this test guards is the ONE assumption that derivation rests on: the
 * manifests must be an honest map of what padi's process can load. From padi's
 * two entry roots — the **process** (`daemonBoot/bin.ts`) and the **library
 * barrel** (`assembly.ts`, the single seam kolu-server still imports) — every
 * reachable runtime import must be declared in the importing package's
 * `dependencies`. A runtime module riding a devDependency link works in every
 * dev install while being INVISIBLE to the hashed closure — the exact silent
 * stale-daemon hole #2094 recorded — so that edge shape fails here, forcing the
 * dependency to move where nix can see it. (Type-only imports are erased by
 * tsx and exempt; the walker is shared — see
 * `@kolu/daemon-test-gate/runtimeDepEdges`.)
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkRuntimeDepEdges } from "@kolu/daemon-test-gate/runtimeDepEdges";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), ".."); // packages/padi/src
const REPO_ROOT = resolve(SRC, "../../..");

describe("padi daemon closure (the staleKey's derived set)", () => {
  it("declares every runtime import in `dependencies`, so the nix-derived staleKey is sound", () => {
    const { violations } = walkRuntimeDepEdges({
      repoRoot: REPO_ROOT,
      entries: [resolve(SRC, "daemonBoot/bin.ts"), resolve(SRC, "assembly.ts")],
    });
    expect(
      violations,
      "Runtime import edge(s) reachable from padi's daemon entries are not honest `dependencies` edges — nix's derived PADI_BUILD_ID cannot see code reached through them. Move each offending package into the importing package.json's `dependencies` (with the workspace: protocol for workspace members).",
    ).toEqual([]);
  });
});
