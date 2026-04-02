import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  Instruction,
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from "./schema.js";

interface RawYamlNode {
  description?: string;
  run?: string;
  skill?: string;
  prompt?: string;
  max_visits?: number;
  on?: Record<string, string>;
}

interface RawYaml {
  version?: number;
  include?: string[];
  defaults?: { max_visits?: number };
  entry_points?: Record<string, string>;
  nodes?: Record<string, RawYamlNode>;
}

function parseInstruction(raw: RawYamlNode): Instruction {
  if (raw.run != null) return { type: "run", command: raw.run };
  if (raw.skill != null) return { type: "skill", name: raw.skill };
  if (raw.prompt != null) return { type: "prompt", text: raw.prompt };
  throw new Error(
    `Node has no instruction (run/skill/prompt): ${JSON.stringify(raw)}`,
  );
}

/** Parse nodes from raw YAML, applying the given default max_visits. */
function parseNodes(
  raw: RawYaml,
  defaultMaxVisits: number,
): Record<string, WorkflowNode> {
  const nodes: Record<string, WorkflowNode> = {};
  for (const [id, rawNode] of Object.entries(raw.nodes ?? {})) {
    const edges = rawNode.on
      ? Object.entries(rawNode.on).map(([condition, target]) => ({
          condition,
          target,
        }))
      : [];

    nodes[id] = {
      id,
      description: rawNode.description ?? id,
      instruction: parseInstruction(rawNode),
      maxVisits: rawNode.max_visits ?? defaultMaxVisits,
      edges,
    };
  }
  return nodes;
}

/**
 * Recursively resolve `include:` directives, merging nodes into a flat namespace.
 * Detects circular includes via visited set; errors on node name collisions.
 */
function resolveIncludes(
  filePath: string,
  raw: RawYaml,
  visited: Set<string>,
): Record<string, WorkflowNode> {
  const absPath = resolve(filePath);
  if (visited.has(absPath)) {
    throw new Error(`Circular include detected: ${absPath}`);
  }
  visited.add(absPath);

  const defaultMaxVisits = raw.defaults?.max_visits ?? 1;
  const nodes = parseNodes(raw, defaultMaxVisits);

  for (const includePath of raw.include ?? []) {
    const resolvedPath = resolve(dirname(filePath), includePath);
    let includedRaw: RawYaml;
    try {
      includedRaw = parseYaml(readFileSync(resolvedPath, "utf-8")) as RawYaml;
    } catch (err) {
      throw new Error(
        `Failed to include '${includePath}' from ${absPath}: ${err instanceof Error ? err.message : err}`,
      );
    }
    const includedNodes = resolveIncludes(resolvedPath, includedRaw, visited);

    for (const [id, node] of Object.entries(includedNodes)) {
      if (nodes[id]) {
        throw new Error(
          `Node name collision: '${id}' defined in both ${absPath} and ${resolvedPath}`,
        );
      }
      nodes[id] = node;
    }
  }

  return nodes;
}

/** Validate that every edge target references an existing node. */
function validateEdgeTargets(nodes: Record<string, WorkflowNode>): void {
  for (const [id, node] of Object.entries(nodes)) {
    for (const edge of node.edges) {
      if (!nodes[edge.target]) {
        throw new Error(
          `Dangling edge: node '${id}' has edge '${edge.condition}' → '${edge.target}', but '${edge.target}' does not exist`,
        );
      }
    }
  }
}

export function parseWorkflowFile(
  filePath: string,
  name: string,
): WorkflowGraph {
  const content = readFileSync(filePath, "utf-8");
  const raw = parseYaml(content) as RawYaml;

  const nodes = resolveIncludes(filePath, raw, new Set());
  validateEdgeTargets(nodes);

  const defaultMaxVisits = raw.defaults?.max_visits ?? 1;
  const entryPoints = raw.entry_points ?? { default: "start" };

  return {
    name,
    entryPoints,
    defaults: { maxVisits: defaultMaxVisits },
    nodes,
  };
}

export function computeHappyPath(
  graph: WorkflowGraph,
  entryPoint: string,
): string[] {
  const startNodeId = graph.entryPoints[entryPoint];
  if (!startNodeId) throw new Error(`Unknown entry point: ${entryPoint}`);

  const path: string[] = [];
  const visited = new Set<string>();
  let current: string | undefined = startNodeId;

  while (current && !visited.has(current)) {
    visited.add(current);
    path.push(current);

    const node: WorkflowNode | undefined = graph.nodes[current];
    if (!node || node.edges.length === 0) break;

    const defaultEdge: WorkflowEdge | undefined = node.edges.find(
      (e: WorkflowEdge) => e.condition === "default",
    );
    current = defaultEdge?.target;
  }

  return path;
}

export function listWorkflows(workflowsDir: string): string[] {
  try {
    return readdirSync(workflowsDir)
      .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
      .map((f) => f.replace(/\.ya?ml$/, ""));
  } catch (err: unknown) {
    // Missing directory is expected (no workflows yet); anything else is a real error
    if (err instanceof Error && "code" in err && err.code === "ENOENT")
      return [];
    throw err;
  }
}
