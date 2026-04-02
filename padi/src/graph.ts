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

/** An include directive — either a bare path or an object with port wiring. */
type RawInclude = string | { path: string; on?: Record<string, string> };

interface RawYaml {
  version?: number;
  include?: RawInclude[];
  ports?: Record<string, never>; // port names declared by fragments (values unused)
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

/** Rewrite `:portname` edge targets using the port→node mapping. */
function wirePortEdges(
  nodes: Record<string, WorkflowNode>,
  portMap: Record<string, string>,
  sourceFile: string,
): void {
  for (const node of Object.values(nodes)) {
    for (const edge of node.edges) {
      if (!edge.target.startsWith(":")) continue;
      const portName = edge.target.slice(1);
      const target = portMap[portName];
      if (!target) {
        throw new Error(
          `Port ':${portName}' used in node '${node.id}' but not wired by includer of ${sourceFile}`,
        );
      }
      edge.target = target;
    }
  }
}

/** Normalize bare string includes to the object form. */
function normalizeInclude(inc: RawInclude): {
  path: string;
  on?: Record<string, string>;
} {
  return typeof inc === "string" ? { path: inc } : inc;
}

/**
 * Recursively resolve `include:` directives, merging nodes into a flat namespace.
 * Detects circular includes via visited set; errors on node name collisions.
 * Rewrites `:portname` edge targets using the port wiring from the include site.
 */
function resolveIncludes(
  filePath: string,
  raw: RawYaml,
  visited: Set<string>,
  /** Port wiring passed by the parent's include directive. */
  portMap?: Record<string, string>,
): Record<string, WorkflowNode> {
  const absPath = resolve(filePath);
  if (visited.has(absPath)) {
    throw new Error(`Circular include detected: ${absPath}`);
  }
  visited.add(absPath);

  const declaredPorts = raw.ports ? Object.keys(raw.ports) : [];

  // Only enforce port wiring when this file was included by a parent (portMap defined).
  // Standalone loading (portMap undefined) skips this — unresolved :port targets
  // will be caught later by validateEdgeTargets as dangling edges.
  if (portMap && declaredPorts.length > 0) {
    const unwired = declaredPorts.filter((p) => !portMap[p]);
    if (unwired.length > 0) {
      throw new Error(
        `Ports [${unwired.join(", ")}] declared in ${absPath} but not wired by includer`,
      );
    }
  }

  const defaultMaxVisits = raw.defaults?.max_visits ?? 1;
  const nodes = parseNodes(raw, defaultMaxVisits);

  // Rewrite :portname references in this file's nodes
  if (portMap) {
    wirePortEdges(nodes, portMap, absPath);
  }

  for (const rawInc of raw.include ?? []) {
    const inc = normalizeInclude(rawInc);
    const resolvedPath = resolve(dirname(filePath), inc.path);
    let includedRaw: RawYaml;
    try {
      includedRaw = parseYaml(readFileSync(resolvedPath, "utf-8")) as RawYaml;
    } catch (err) {
      throw new Error(
        `Failed to include '${inc.path}' from ${absPath}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Validate that on: keys match declared ports in the included file
    const includedPorts = includedRaw.ports
      ? Object.keys(includedRaw.ports)
      : [];
    if (inc.on) {
      for (const key of Object.keys(inc.on)) {
        if (!includedPorts.includes(key)) {
          throw new Error(
            `Port '${key}' wired in include of ${resolvedPath} but not declared in its ports`,
          );
        }
      }
    }

    // Resolve :portname references in on: values through our own portMap.
    // e.g. outer wires inner's "out" to ":done" — resolve ":done" via outer's portMap.
    const resolvedOn: Record<string, string> | undefined = inc.on
      ? Object.fromEntries(
          Object.entries(inc.on).map(([port, target]) => {
            if (target.startsWith(":")) {
              if (!portMap) {
                throw new Error(
                  `Port reference '${target}' in on: of include ${resolvedPath}, but ${absPath} has no port context`,
                );
              }
              const resolved = portMap[target.slice(1)];
              if (!resolved) {
                throw new Error(
                  `Port '${target}' used in on: of include ${resolvedPath} but not wired by includer of ${absPath}`,
                );
              }
              return [port, resolved];
            }
            return [port, target];
          }),
        )
      : undefined;

    // Pass {} instead of undefined when no on: specified — distinguishes
    // "included with no port wiring" from "loaded standalone (root file)"
    const includedNodes = resolveIncludes(
      resolvedPath,
      includedRaw,
      visited,
      resolvedOn ?? {},
    );

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
