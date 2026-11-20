import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkRuntimeDepEdges } from "@kolu/daemon-test-gate/runtimeDepEdges";
import { describe, expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
