/**
 * WHICH package directories an outside repo copies out of a content-addressed
 * kolu pin — and, from those entries, the whole manifest closure that copying
 * them costs.
 *
 * This is not an Effect-pin fact and not a nix-conformance fact; it is the one
 * question two different gates ask (`effectPin.ts`: which manifests owe a
 * LITERAL version, because `catalog:` is workspace-local; `closureWalk.ts`:
 * which entries the nix and TS closure walks must agree over), so it is spelled
 * once, here, and imported by both.
 *
 * **Derived, not listed.** A hardcoded list of the surface directories is the
 * enumeration-without-a-counter problem: a ninth `packages/surface-*` appears,
 * nobody edits the list, and the gate passes while that directory's pins have
 * split. So the `@kolu/surface*` half is READ OUT OF THE TREE — every workspace
 * package root that sits at `packages/surface<something>` — and a new surface
 * package joins both gates BY EXISTING.
 *
 * `@kolu/padi-client` and `@kolu/solid-dockrow` are DECLARED, and they are the
 * only things here that are, because they are genuinely irreducible: both are
 * facts about olai, which dials a running padi from its server and never
 * installs one (juspay/kolu#2216), and renders kolu's Dock terminal row rather
 * than inventing its own status UI. Nothing in this tree says either package is
 * vendored — no directory name, no manifest field — so there is no in-tree
 * source to derive them from.
 */

import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  declaredDependencyClosure,
  workspacePackageRoots,
} from "@kolu/daemon-test-gate/runtimeDepEdges";

/** The surface stack drishti and odu copy (see `packages/AGENTS.md`), read off
 *  the tree rather than listed: a workspace package root at exactly
 *  `packages/surface<…>` — not `packages/surface/example`, which is a sub-package
 *  of one, and not `packages/surfaced-thing` living deeper. */
const SURFACE_DIR = /^packages\/surface[^/]*$/;

/** The package DIRECTORIES an outside repo copies out of a content-addressed
 *  kolu pin, by package name. */
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
  // olai's two, the only entries with no in-tree source — see the header.
  names.push("@kolu/padi-client");
  names.push("@kolu/solid-dockrow");
  return names.sort();
}

/** Every manifest an external consumer installs outside kolu's workspace: the
 *  vendored entry directories AND their transitive `dependencies` closure,
 *  because a vendored directory's manifest is installed from the consumer's own
 *  workspace and so is every manifest it names.
 *
 *  Walked with the shared `declaredDependencyClosure` — the TS mirror of nix's
 *  `depClosure` — so this and `@kolu/padi-client`'s hydrate guard answer "what
 *  does vendoring this cost" with ONE walk rather than two that agree today. */
export function vendoredManifests(repoRoot: string): ReadonlySet<string> {
  return new Set(
    declaredDependencyClosure({ repoRoot, entries: vendorEntries(repoRoot) })
      .manifestPaths,
  );
}
