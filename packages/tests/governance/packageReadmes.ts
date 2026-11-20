import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Yaml } from "effect/encoding";

const README = "README.md";
const MANIFEST = "package.json";

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

export function validatePackageReadmes(missing: readonly string[]): void {
  if (missing.length === 0) return;
  throw new Error(
    [
      `${missing.length} workspace package(s) have no README.md — every package is described where it lives, in the PR that adds it (AGENTS.md, Documentation). Write one for each:`,
      ...missing.map((dir) => `  ${dir}/${README}`),
    ].join("\n"),
  );
}
