import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../..",
);
const PACKAGES_DIR = join(REPO_ROOT, "packages");
const INTEGRATIONS_DIR = join(PACKAGES_DIR, "integrations");

interface Manifest {
  path: string;
  name: string;
  dependencies: readonly string[];
}

function parseManifest(path: string, text: string): Manifest {
  const pkg = JSON.parse(text) as {
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

function readManifestIfPresent(path: string): Manifest | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return parseManifest(path, text);
}

function allManifests(): Manifest[] {
  const out: Manifest[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      const child = join(dir, entry.name);
      const manifest = readManifestIfPresent(join(child, "package.json"));
      if (manifest) out.push(manifest);
      walk(child);
    }
  };
  walk(PACKAGES_DIR);
  return out;
}

function integrationPackageNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const entry of readdirSync(INTEGRATIONS_DIR, {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const manifest = readManifestIfPresent(
      join(INTEGRATIONS_DIR, entry.name, "package.json"),
    );
    if (manifest) names.set(manifest.name, entry.name);
  }
  return names;
}

function derivedAgentPackages(): Set<string> {
  const integrations = integrationPackageNames();
  const registryPath = join(INTEGRATIONS_DIR, "agents", "package.json");
  const registry = parseManifest(
    registryPath,
    readFileSync(registryPath, "utf8"),
  );
  return new Set(
    registry.dependencies.filter(
      (dep) =>
        dep.startsWith("kolu-") &&
        dep !== "kolu-agents" &&
        integrations.has(dep),
    ),
  );
}

function mayDependOnAgents(manifest: Manifest): boolean {
  return (
    manifest.name === "kolu-agents" ||
    manifest.path.startsWith("packages/tests/")
  );
}

test("agent packages are depended on only by the registry and the tests", () => {
  const agents = derivedAgentPackages();
  assert.ok(
    agents.size >= 5,
    "expected the agent package set to be non-trivial",
  );
  const offenders: string[] = [];
  for (const manifest of allManifests()) {
    if (mayDependOnAgents(manifest)) continue;
    for (const dep of manifest.dependencies) {
      if (agents.has(dep)) {
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
  const agents = derivedAgentPackages();
  const anyagent = allManifests().find((m) => m.name === "anyagent");
  assert.ok(anyagent, "anyagent manifest must exist");
  const leaked = anyagent.dependencies.filter((d) => agents.has(d));
  assert.deepEqual(
    leaked,
    [],
    `anyagent must name no agent: ${leaked.join(", ")}`,
  );
});
