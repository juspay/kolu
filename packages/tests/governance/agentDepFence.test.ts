/**
 * The agent-dependency fence — makes "adding an agent touches only its own
 * package plus the registry" a CI invariant, not a convention.
 *
 * A `kolu-<agent>` package (kolu-claude-code, kolu-codex, …) may be a
 * dependency ONLY of the registry (`kolu-agents`, which owns the folding) and
 * of `packages/tests` (which drives real adapters end-to-end). Anything else
 * importing an agent package directly has re-braided the per-agent knowledge
 * the registry de-complects — the defect the whole refactor exists to prevent.
 * `anyagent` (the kernel) must name no agent at all.
 *
 * The agent-package set is DERIVED from the tree, never hand-listed: a new
 * `packages/integrations/<agent>/package.json` joins the fence the moment it
 * exists.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/** `packages/tests/governance/` → the repo root. */
const REPO_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const INTEGRATIONS_DIR = join(PACKAGES_DIR, "integrations");

/** Integrations that are NOT agents — the kernel (anyagent), the forge leaf
 *  (anyforge), the registry itself (kolu-agents), and the non-agent
 *  integrations. Everything else under `integrations/` is an agent package. */
const NON_AGENT_INTEGRATIONS = new Set([
  "anyagent",
  "anyforge",
  "kolu-agents",
  "kolu-git",
  "kolu-github",
  "kolu-io",
  "kolu-pty",
]);

interface Manifest {
  /** Path relative to the repo root, for a readable failure. */
  path: string;
  name: string;
  dependencies: readonly string[];
}

function readManifest(path: string): Manifest {
  const pkg = JSON.parse(readFileSync(path, "utf8")) as {
    name?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
  return {
    path: relative(REPO_ROOT, path),
    name: pkg.name ?? "(unnamed)",
    dependencies: [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.peerDependencies ?? {}),
    ],
  };
}

/** Every `package.json` under `packages/`, excluding `node_modules`. */
function allManifests(): Manifest[] {
  const out: Manifest[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const child = join(dir, entry.name);
      try {
        out.push(readManifest(join(child, "package.json")));
      } catch {
        // Not a package dir — keep walking.
      }
      walk(child);
    }
  };
  walk(PACKAGES_DIR);
  return out;
}

/** The `kolu-<agent>` package names, derived from the integrations tree. */
function agentPackageNames(): Set<string> {
  const names = new Set<string>();
  for (const entry of readdirSync(INTEGRATIONS_DIR, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const manifest = readManifest(
      join(INTEGRATIONS_DIR, entry.name, "package.json"),
    );
    if (!NON_AGENT_INTEGRATIONS.has(manifest.name)) names.add(manifest.name);
  }
  return names;
}

/** A dependency is an agent package if it is a workspace `kolu-<agent>`. */
function isAgentDep(name: string, agents: Set<string>): boolean {
  return agents.has(name);
}

/** Is this manifest allowed to depend on an agent package? */
function mayDependOnAgents(manifest: Manifest): boolean {
  return (
    manifest.name === "kolu-agents" ||
    manifest.path.startsWith("packages/tests/")
  );
}

test("agent packages are depended on only by the registry and the tests", () => {
  const agents = agentPackageNames();
  assert.ok(
    agents.size >= 5,
    "expected the agent package set to be non-trivial",
  );
  const offenders: string[] = [];
  for (const manifest of allManifests()) {
    if (mayDependOnAgents(manifest)) continue;
    for (const dep of manifest.dependencies) {
      if (isAgentDep(dep, agents)) {
        offenders.push(`${manifest.path} (${manifest.name}) → ${dep}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `agent packages must be imported, not depended on directly:\n${offenders.join("\n")}`,
  );
});

test("anyagent depends on no kolu-<agent> package", () => {
  const anyagent = allManifests().find((m) => m.name === "anyagent");
  assert.ok(anyagent, "anyagent manifest must exist");
  const leaked = anyagent.dependencies.filter((d) => d.startsWith("kolu-"));
  assert.deepEqual(
    leaked,
    [],
    `anyagent must name no agent: ${leaked.join(", ")}`,
  );
});
