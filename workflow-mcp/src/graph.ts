import { readFileSync, readdirSync } from "node:fs";
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

export function parseWorkflowFile(
  filePath: string,
  name: string,
): WorkflowGraph {
  const content = readFileSync(filePath, "utf-8");
  const raw = parseYaml(content) as RawYaml;

  const defaultMaxVisits = raw.defaults?.max_visits ?? 1;
  const entryPoints = raw.entry_points ?? { default: "start" };
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
