/**
 * Every workspace package has its own `README.md`.
 *
 * WHY THIS EXISTS. A package is the unit a reader meets first — in the tree, in
 * a dependency list, in a review of the PR that adds it. Without a README the
 * only description of what it is for and what it exports is its source, so the
 * answer is re-derived by every person who meets it, and the package's own
 * invariants live nowhere a maintainer looks before changing them. The rule is
 * `AGENTS.md`'s (the Documentation section): the README is written with the
 * package, in the same PR. This is what makes the rule hold.
 *
 * THE RULE. Every package the workspace declares has a committed `README.md`
 * beside its `package.json`. No allowlist: a package with nothing to say is a
 * package whose README is one paragraph, not an exception to record here.
 *
 * WHY GOVERNANCE. A claim about the whole tree rather than about one package —
 * the reason the case-collision guard and the `Effect.run*` budget live here
 * too. The package list is the workspace's own: the globs in
 * `pnpm-workspace.yaml`, resolved over `git ls-files`. So a new package joins
 * this check by existing, and a package kolu does not own cannot be caught by
 * it: the grafted trees (`osfacts-client`, `odu/*`, `juspay/agent-distro`) are
 * generated and never committed, so no tracked manifest names them.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
// Effect's own YAML parser rather than the `yaml` package — the same choice
// `effectPin.ts` argues over the same file.
import { Yaml } from "effect/encoding";

const README = "README.md";
const MANIFEST = "package.json";

/** What `pnpm-workspace.yaml` declares under `packages:`. */
export function workspaceGlobs(yamlText: string): string[] {
  const parsed = Yaml.parse(yamlText) as { packages?: unknown };
  const globs = parsed.packages;
  if (!Array.isArray(globs) || globs.length === 0) {
    throw new Error(
      "pnpm-workspace.yaml declares no `packages:` globs — the workspace IS the package list.",
    );
  }
  return globs.map(String);
}

/** A directory matched by one workspace glob. `**` spans path separators, `*`
 *  stops at one; everything else is literal. */
function matches(dir: string, glob: string): boolean {
  const pattern = glob
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((literal) => literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${pattern}$`).test(dir);
}

/** The workspace packages `trackedFiles` declares, and the ones with no README
 *  beside the manifest, both sorted. The package list is the committed one;
 *  the README is looked for on disk, where its reader opens it, so a README
 *  written in a working tree and not yet added is not reported as absent. */
export function collectPackageReadmes(
  repoRoot: string,
  trackedFiles: readonly string[],
): { packages: readonly string[]; missing: readonly string[] } {
  const globs = workspaceGlobs(
    readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8"),
  );
  const packages: string[] = [];
  for (const file of trackedFiles) {
    const dir = path.posix.dirname(file);
    if (path.posix.basename(file) !== MANIFEST || dir === ".") continue;
    if (globs.some((glob) => matches(dir, glob))) packages.push(dir);
  }
  packages.sort();
  return {
    packages,
    missing: packages.filter(
      (dir) => !existsSync(path.join(repoRoot, dir, README)),
    ),
  };
}

/** Throw, naming every package, unless each one has a README. */
export function validatePackageReadmes(missing: readonly string[]): void {
  if (missing.length === 0) return;
  throw new Error(
    [
      `${missing.length} workspace package(s) have no README.md — every package is described where it lives, in the PR that adds it (AGENTS.md, Documentation). Write one for each:`,
      ...missing.map((dir) => `  ${dir}/${README}`),
    ].join("\n"),
  );
}
