import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  declaredDependencyClosure,
  workspacePackageRoots,
} from "@kolu/daemon-test-gate/runtimeDepEdges";

const SURFACE_DIR = /^packages\/surface[^/]*$/;

export function vendorEntries(repoRoot: string): string[] {
  const names: string[] = [];
  for (const dir of workspacePackageRoots(repoRoot)) {
    const rel = relative(repoRoot, dir).split(sep).join("/");
    if (!SURFACE_DIR.test(rel)) continue;
    const name = (
      JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
        name?: string;
      }
    ).name;
    if (name !== undefined) names.push(name);
  }
  names.push("@kolu/padi-client");
  names.push("@kolu/solid-dockrow");
  names.push("@kolu/detect");
  names.push("terminal-themes");
  names.push("@kolu/acp");
  names.push("@kolu/acp-claude");
  names.push("@kolu/acp-client");
  names.push("@kolu/acp-harness");
  names.push("@kolu/child");
  return names.sort();
}

export function vendoredManifests(repoRoot: string): ReadonlySet<string> {
  return new Set(
    declaredDependencyClosure({ repoRoot, entries: vendorEntries(repoRoot) })
      .manifestPaths,
  );
}
