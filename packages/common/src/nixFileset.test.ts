/// <reference types="node" />

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
    const check = (rel: string): void => {
      const pj = join(pkgsDir, rel, "package.json");
      if (!existsSync(pj)) return;
      const scripts = JSON.parse(readFileSync(pj, "utf8")).scripts;
      const hasTypecheck = Boolean(scripts?.typecheck);
      if (hasTypecheck) {
        const present = workspaceNix
          .split("\n")
          .some((line) => line.includes(`= ../packages/${rel};`));
        if (!present) missing.push(rel);
      }
    };

    for (const name of readdirSync(pkgsDir)) {
      check(name);
      const sub = join(pkgsDir, name);
      if (!existsSync(sub) || !existsSync(join(sub, "package.json"))) {
        let children: string[] = [];
        try {
          children = readdirSync(sub);
        } catch {
          continue;
        }
        for (const child of children) check(`${name}/${child}`);
      }
    }

    expect(missing).toEqual([]);
  });
});
