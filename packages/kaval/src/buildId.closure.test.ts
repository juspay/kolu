import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { walkRuntimeDepEdges } from "@kolu/daemon-test-gate/runtimeDepEdges";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
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
