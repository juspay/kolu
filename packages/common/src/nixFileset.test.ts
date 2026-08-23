/// <reference types="node" />

/**
 * GUARD TEST (C7): `nix/workspace.nix`'s `src` fileset is a MANUALLY
 * maintained `lib.fileset.unions` — a package omitted there is silently type-checked
 * against a source tree that lacks it, which is invisible to `just check` (full working
 * tree) and only reds a real `nix build`. The `@kolu/surface-map` package hit exactly
 * this: added to the workspace, never added to the fileset, so CI's `flake-check` reded
 * ("surface-remote can't resolve @kolu/surface-map"). This pins the fileset's own stated
 * invariant so a future package can't repeat the omission. (juspay/kolu#1716-adjacent.)
 *
 * Runs in the unit suite (full checkout — `nix/workspace.nix` is present), not the nix
 * type-gate: it READS `workspace.nix` at runtime and asserts membership; it doesn't need
 * nix. The fileset lists BOTH whole top-level `../packages/<name>` dirs AND each
 * second-level `../packages/integrations/<name>` dir individually (kolu-pi hit exactly
 * this: added under integrations/, never added to the fileset), so the walk is
 * two levels deep — exactly the fileset's granularity.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Walk up from this test file to the repo root (the dir holding pnpm-workspace.yaml). */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = dirname(dir);
  }
  throw new Error(
    "repo root (pnpm-workspace.yaml) not found from nixFileset.test.ts",
  );
}

describe("workspace.nix `src` fileset — every workspace package with a typecheck script is included", () => {
  it("no packages/* or packages/integrations/* with a `typecheck` script is omitted (the surface-map + pi misses)", () => {
    const root = repoRoot();
    const workspaceNix = readFileSync(
      join(root, "nix", "workspace.nix"),
      "utf8",
    );
    const pkgsDir = join(root, "packages");

    const missing: string[] = [];
    /** A package dir that declares `typecheck` MUST appear as `../packages/<rel>`
     *  in the fileset, or nix type-checks against a source tree missing it. */
    const check = (rel: string): void => {
      const pj = join(pkgsDir, rel, "package.json");
      if (!existsSync(pj)) return;
      let hasTypecheck = false;
      try {
        const scripts = JSON.parse(readFileSync(pj, "utf8")).scripts;
        hasTypecheck = Boolean(scripts?.typecheck);
      } catch {
        // Not a readable package.json — skip (not a workspace member dir).
      }
      if (hasTypecheck && !workspaceNix.includes(`../packages/${rel}`)) {
        missing.push(rel);
      }
    };

    for (const name of readdirSync(pkgsDir)) {
      check(name);
      // Second-level members (packages/integrations/*) are listed
      // individually by the fileset — each one needs its own entry.
      const sub = join(pkgsDir, name);
      if (!existsSync(sub) || !existsSync(join(sub, "package.json"))) {
        // Not itself a package root: treat as a container dir (integrations/)
        // and check one level deeper. A container dir without a package.json
        // of its own whose children are packages is the only shape here.
        let children: string[] = [];
        try {
          children = readdirSync(sub);
        } catch {
          continue; // not a directory
        }
        for (const child of children) check(`${name}/${child}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
