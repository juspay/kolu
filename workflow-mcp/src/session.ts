import { randomUUID } from "node:crypto";
import type {
  AdvanceResult,
  Session,
  WorkflowGraph,
  WorkflowNode,
  NodeStatus,
  ProgressNode,
} from "./schema.js";
import { computeHappyPath } from "./graph.js";

export function createSession(
  graph: WorkflowGraph,
  entryPoint: string,
  input?: string,
): Session {
  const startNodeId = graph.entryPoints[entryPoint];
  if (!startNodeId) throw new Error(`Unknown entry point: ${entryPoint}`);
  if (!graph.nodes[startNodeId])
    throw new Error(`Entry node '${startNodeId}' not found in graph`);

  const happyPath = computeHappyPath(graph, entryPoint);

  return {
    id: randomUUID(),
    workflowName: graph.name,
    entryPoint,
    input,
    currentNodeId: startNodeId,
    visitCounts: { [startNodeId]: 1 },
    history: [
      {
        nodeId: startNodeId,
        visit: 1,
        startedAt: new Date().toISOString(),
      },
    ],
    happyPath,
    startedAt: new Date().toISOString(),
    status: "running",
  };
}

export function getCurrentNode(
  graph: WorkflowGraph,
  session: Session,
): WorkflowNode {
  const node = graph.nodes[session.currentNodeId];
  if (!node) throw new Error(`Node '${session.currentNodeId}' not in graph`);
  return node;
}

/** Build the NodeStatus snapshot used in tool responses. */
export function nodeStatus(node: WorkflowNode, session: Session): NodeStatus {
  return {
    id: node.id,
    description: node.description,
    instruction: node.instruction,
    visit: session.visitCounts[node.id] ?? 0,
    maxVisits: node.maxVisits,
    edges: node.edges,
  };
}

export function advance(
  graph: WorkflowGraph,
  session: Session,
  evidence: string,
  edge?: string,
): AdvanceResult {
  if (session.status !== "running") {
    throw new Error(`Session is ${session.status}, cannot advance`);
  }

  const currentNode = getCurrentNode(graph, session);

  // Record completion of current step
  const currentStep = session.history[session.history.length - 1];
  if (currentStep) {
    currentStep.completedAt = new Date().toISOString();
    currentStep.evidence = evidence;
  }

  // Terminal node — no edges means workflow is done
  if (currentNode.edges.length === 0) {
    session.status = "completed";
    return { status: "completed" };
  }

  // Resolve which edge to follow
  const targetNodeId = resolveEdge(currentNode, edge, currentStep);

  const nextNode = graph.nodes[targetNodeId];
  if (!nextNode) {
    throw new Error(`Edge target '${targetNodeId}' not found in graph`);
  }

  // Check visit limit
  const visits = (session.visitCounts[targetNodeId] ?? 0) + 1;
  if (visits > nextNode.maxVisits) {
    const reason = `Node '${targetNodeId}' exceeded max_visits (${nextNode.maxVisits})`;
    session.status = "halted";
    session.haltReason = reason;
    return { status: "halted", reason };
  }

  // Advance
  session.currentNodeId = targetNodeId;
  session.visitCounts[targetNodeId] = visits;
  session.history.push({
    nodeId: targetNodeId,
    visit: visits,
    startedAt: new Date().toISOString(),
  });

  return { status: "running", nextNode };
}

/**
 * Determine which edge to follow from the current node.
 * Auto-advances on default-only nodes; requires explicit edge when
 * conditional edges exist.
 */
function resolveEdge(
  node: WorkflowNode,
  edge: string | undefined,
  currentStep: { edgeTaken?: string } | undefined,
): string {
  const defaultEdge = node.edges.find((e) => e.condition === "default");
  const hasConditional = node.edges.some((e) => e.condition !== "default");

  if (edge) {
    const matched = node.edges.find((e) => e.condition === edge);
    if (!matched) {
      throw new Error(
        `Edge '${edge}' not found on node '${node.id}'. Available: ${node.edges.map((e) => e.condition).join(", ")}`,
      );
    }
    if (currentStep) currentStep.edgeTaken = edge;
    return matched.target;
  }

  if (!hasConditional && defaultEdge) {
    if (currentStep) currentStep.edgeTaken = "default";
    return defaultEdge.target;
  }

  throw new Error(
    `Node '${node.id}' has conditional edges. You must specify which edge to follow: ${node.edges.map((e) => `"${e.condition}"`).join(", ")}`,
  );
}

export function getProgress(session: Session): {
  nodes: ProgressNode[];
  line: string;
} {
  const completedNodeIds = new Set(
    session.history.filter((s) => s.completedAt != null).map((s) => s.nodeId),
  );

  const nodes: ProgressNode[] = session.happyPath.map((id) => {
    if (id === session.currentNodeId && session.status === "running") {
      return { id, state: "current" as const };
    }
    if (completedNodeIds.has(id)) {
      return { id, state: "completed" as const };
    }
    return { id, state: "pending" as const };
  });

  // If current node is off the happy path, append it
  if (
    session.status === "running" &&
    !session.happyPath.includes(session.currentNodeId)
  ) {
    nodes.push({ id: session.currentNodeId, state: "current" });
  }

  const markers = { completed: "✓", current: "▸", pending: "·" };
  const line = nodes.map((n) => `${markers[n.state]}${n.id}`).join(" ");

  return { nodes, line };
}
