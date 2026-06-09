/**
 * `just` → PipelineSpec: the translator that replaces justci's DAG ingestion.
 *
 * `just --dump --dump-format json` (just ≥ 1.50) emits the whole justfile
 * tree; odu discovers the unique recipe tagged `[metadata("ci")]`, expands
 * its reachable dependency subgraph, and turns every reachable recipe into a
 * task executed as `just --no-deps <namepath>` — exactly the invocation
 * justci used, so recipe-internal conventions (the `install` funnel, the
 * `nix_shell` wrapper) carry over unchanged.
 *
 * Dump-shape notes (just 1.50.0):
 *   - module recipes live at `.modules.<m>.recipes.<name>`, recursively;
 *   - `dependencies[].recipe` is the *module-local* bare name — resolved
 *     within the recipe's own module (cross-module deps are a hard error);
 *   - attributes are strings or single-key objects:
 *     `["linux", {"metadata": ["ci"]}, "parallel"]`;
 *   - `namepath` is the qualified name (`ci::e2e`) — the prefix of the
 *     status context / log filename (`ci::e2e@x86_64-linux`).
 */

import { spawnSync } from "node:child_process";
import type { PipelineSpec, TaskSpec } from "../common/spec";
import { validatePipeline } from "../common/spec";

interface DumpRecipe {
  name: string;
  namepath: string;
  attributes: ReadonlyArray<string | Record<string, unknown>>;
  body: ReadonlyArray<unknown>;
  dependencies: ReadonlyArray<{ recipe: string }>;
}

interface DumpModule {
  recipes: Record<string, DumpRecipe>;
  modules: Record<string, DumpModule>;
}

interface FlatRecipe {
  recipe: DumpRecipe;
  /** The module's recipe table — dependency names resolve against this. */
  siblings: Record<string, DumpRecipe>;
}

function flatten(
  module: DumpModule,
  byNamepath: Map<string, FlatRecipe>,
): void {
  for (const recipe of Object.values(module.recipes ?? {})) {
    byNamepath.set(recipe.namepath, { recipe, siblings: module.recipes });
  }
  for (const sub of Object.values(module.modules ?? {})) {
    flatten(sub, byNamepath);
  }
}

function hasCiMetadata(recipe: DumpRecipe): boolean {
  return recipe.attributes.some(
    (attr) =>
      typeof attr === "object" &&
      Array.isArray((attr as Record<string, unknown>).metadata) &&
      ((attr as Record<string, unknown>).metadata as unknown[]).includes("ci"),
  );
}

export interface IngestOptions {
  /** Override the DAG root by namepath (justci's `--root`). */
  root?: string;
}

/** Build the pipeline from a parsed `just --dump --dump-format json` tree. */
export function pipelineFromDump(
  dump: unknown,
  opts: IngestOptions = {},
): PipelineSpec {
  const byNamepath = new Map<string, FlatRecipe>();
  flatten(dump as DumpModule, byNamepath);

  let root: FlatRecipe;
  if (opts.root !== undefined) {
    const found = byNamepath.get(opts.root);
    if (found === undefined) {
      throw new Error(`odu: no recipe named "${opts.root}" in the justfile`);
    }
    root = found;
  } else {
    const tagged = [...byNamepath.values()].filter((r) =>
      hasCiMetadata(r.recipe),
    );
    if (tagged.length !== 1) {
      throw new Error(
        `odu: expected exactly one [metadata("ci")] recipe, found ${tagged.length}` +
          (tagged.length > 0
            ? ` (${tagged.map((r) => r.recipe.namepath).join(", ")})`
            : ""),
      );
    }
    root = tagged[0] as FlatRecipe;
  }

  // Reachable subgraph from the root's dependency edges only — recipes that
  // merely live in the same module (pool-ensure, pool-status) never schedule.
  const reachable = new Map<string, FlatRecipe>();
  const queue: FlatRecipe[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const dep of current.recipe.dependencies) {
      const sibling = current.siblings[dep.recipe];
      if (sibling === undefined) {
        throw new Error(
          `odu: recipe "${current.recipe.namepath}" depends on "${dep.recipe}", ` +
            "which is not in the same module (cross-module deps are unsupported)",
        );
      }
      if (!reachable.has(sibling.namepath)) {
        const flat = { recipe: sibling, siblings: current.siblings };
        reachable.set(sibling.namepath, flat);
        queue.push(flat);
      }
    }
  }

  // An empty-bodied root (kolu's `ci::default`) is a pure fan-out marker, not
  // a node — justci posted no status for it. A root with a body is a task.
  const includeRoot = root.recipe.body.length > 0;
  if (includeRoot) reachable.set(root.recipe.namepath, root);

  const tasks: TaskSpec[] = [...reachable.values()].map(
    ({ recipe, siblings }) => ({
      id: recipe.namepath,
      name: recipe.namepath,
      command: `just --no-deps ${recipe.namepath}`,
      needs: recipe.dependencies
        .map((dep) => siblings[dep.recipe]?.namepath)
        .filter((np): np is string => np !== undefined && reachable.has(np)),
    }),
  );
  // Deterministic order: dependencies first (stable topo by repeated passes),
  // alphabetical within a rank — so dashboards and dumps are reproducible.
  tasks.sort((a, b) => a.id.localeCompare(b.id));
  const ranked = topoOrder(tasks);

  return validatePipeline({
    name: root.recipe.namepath,
    tasks: ranked,
  });
}

function topoOrder(tasks: TaskSpec[]): TaskSpec[] {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const placed = new Set<string>();
  const out: TaskSpec[] = [];
  while (out.length < tasks.length) {
    let advanced = false;
    for (const task of tasks) {
      if (placed.has(task.id)) continue;
      if (task.needs.every((dep) => placed.has(dep) || !byId.has(dep))) {
        placed.add(task.id);
        out.push(task);
        advanced = true;
      }
    }
    if (!advanced) return tasks; // cycle — validatePipeline reports it
  }
  return out;
}

/** Run `just --dump --dump-format json` in `cwd` and parse it. */
export function loadJustPipeline(
  cwd: string,
  opts: IngestOptions = {},
): PipelineSpec {
  const result = spawnSync("just", ["--dump", "--dump-format", "json"], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error !== undefined) {
    throw new Error(`odu: failed to run just: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`odu: just --dump failed:\n${result.stderr}`);
  }
  return pipelineFromDump(JSON.parse(result.stdout), opts);
}

// ── selectors ──────────────────────────────────────────────────────────────

export interface Selector {
  recipe: string;
  platform?: string;
}

/** Parse a positional `recipe[@platform]` selector. The recipe part matches a
 *  namepath exactly, or a bare leaf name (`e2e` ≡ `ci::e2e`) when unambiguous. */
export function parseSelector(token: string): Selector {
  const at = token.lastIndexOf("@");
  if (at > 0) {
    return { recipe: token.slice(0, at), platform: token.slice(at + 1) };
  }
  return { recipe: token };
}

function resolveRecipe(spec: PipelineSpec, recipe: string): string {
  const exact = spec.tasks.find((t) => t.id === recipe);
  if (exact !== undefined) return exact.id;
  const leaf = spec.tasks.filter(
    (t) => t.id === recipe || t.id.endsWith(`::${recipe}`),
  );
  if (leaf.length === 1 && leaf[0] !== undefined) return leaf[0].id;
  if (leaf.length > 1) {
    throw new Error(
      `odu: selector "${recipe}" is ambiguous (${leaf.map((t) => t.id).join(", ")})`,
    );
  }
  throw new Error(`odu: selector "${recipe}" matches no pipeline recipe`);
}

/** Slice the pipeline for one platform's lane: selected recipes (plus their
 *  dependency closure unless `noDeps`), in pipeline order. No selectors ⇒ the
 *  whole pipeline. */
export function laneTasks(
  spec: PipelineSpec,
  platform: string,
  selectors: readonly Selector[],
  noDeps: boolean,
): TaskSpec[] {
  const relevant = selectors.filter(
    (s) => s.platform === undefined || s.platform === platform,
  );
  if (selectors.length > 0 && relevant.length === 0) return [];
  if (relevant.length === 0) return spec.tasks;

  const byId = new Map(spec.tasks.map((t) => [t.id, t]));
  const wanted = new Set<string>();
  const queue = relevant.map((s) => resolveRecipe(spec, s.recipe));
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || wanted.has(id)) continue;
    wanted.add(id);
    if (!noDeps) {
      for (const dep of byId.get(id)?.needs ?? []) queue.push(dep);
    }
  }
  return spec.tasks
    .filter((t) => wanted.has(t.id))
    .map((t) => ({
      ...t,
      needs: t.needs.filter((dep) => wanted.has(dep)),
    }));
}

/** Mermaid flowchart of the pipeline DAG (justci's `graph` equivalent). */
export function mermaidGraph(spec: PipelineSpec): string {
  const lines = ["flowchart TD"];
  const safe = (id: string): string => id.replace(/[^A-Za-z0-9_]/g, "_");
  for (const task of spec.tasks) {
    lines.push(`    ${safe(task.id)}["${task.id}"]`);
  }
  for (const task of spec.tasks) {
    for (const dep of task.needs) {
      lines.push(`    ${safe(dep)} --> ${safe(task.id)}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
