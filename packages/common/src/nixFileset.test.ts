/**
 * GUARD TEST (C7): `default.nix`'s workspace-typecheck `src` fileset is a MANUALLY
 * maintained `lib.fileset.unions` — a package omitted there is silently type-checked
 * against a source tree that lacks it, which is invisible to `just check` (full working
 * tree) and only reds a real `nix build`. The `@kolu/surface-map` package hit exactly
 * this: added to the workspace, never added to the fileset, so CI's `flake-check` reded
 * ("surface-remote can't resolve @kolu/surface-map"). This pins the fileset's own stated
 * invariant so a future package can't repeat the omission. (juspay/kolu#1716-adjacent.)
 *
 * Runs in the unit suite (full checkout — `default.nix` is present), not the nix
 * type-gate: it READS `default.nix` at runtime and asserts membership; it doesn't need
 * nix. Nested workspace members ride their TOP-LEVEL package dir (the fileset lists whole
 * `./packages/<name>` dirs), so a top-level check is exactly the fileset's granularity.
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

describe("default.nix typecheck `src` fileset — every workspace package with a typecheck script is included", () => {
  it("no top-level packages/* with a `typecheck` script is omitted (the surface-map miss)", () => {
    const root = repoRoot();
    const defaultNix = readFileSync(join(root, "default.nix"), "utf8");
    const pkgsDir = join(root, "packages");

    const missing: string[] = [];
    for (const name of readdirSync(pkgsDir)) {
      const pj = join(pkgsDir, name, "package.json");
      if (!existsSync(pj)) continue;
      let hasTypecheck = false;
      try {
        const scripts = JSON.parse(readFileSync(pj, "utf8")).scripts;
        hasTypecheck = Boolean(scripts?.typecheck);
      } catch {
        // Not a readable package.json — skip (not a workspace member dir).
      }
      // A top-level package that declares `typecheck` MUST appear as `./packages/<name>`
      // in the fileset, or nix type-checks against a source tree missing it.
      if (hasTypecheck && !defaultNix.includes(`./packages/${name}`)) {
        missing.push(name);
      }
    }

    expect(missing).toEqual([]);
  });
});
