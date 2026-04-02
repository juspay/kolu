import { randomUUID } from "node:crypto";
import type {
  Session,
  WorkflowGraph,
  WorkflowNode,
  ProgressNodeSchema,
} from "./schema.js";
import { computeHappyPath } from "./graph.js";
import type { z } from "zod";

type ProgressNode = z.infer<typeof ProgressNodeSchema>;

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

export interface AdvanceResult {
  done: boolean;
  halted: boolean;
  haltReason?: string;
  nextNode?: WorkflowNode;
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
    if (currentStep) currentStep.edgeTaken = undefined;
    return { done: true, halted: false };
  }

  // Resolve which edge to follow
  let targetNodeId: string;
  const nonDefaultEdges = currentNode.edges.filter(
    (e) => e.condition !== "default",
  );
  const defaultEdge = currentNode.edges.find((e) => e.condition === "default");

  if (edge) {
    // Agent specified an edge
    const matched = currentNode.edges.find((e) => e.condition === edge);
    if (!matched) {
      throw new Error(
        `Edge '${edge}' not found on node '${currentNode.id}'. Available: ${currentNode.edges.map((e) => e.condition).join(", ")}`,
      );
    }
    targetNodeId = matched.target;
    if (currentStep) currentStep.edgeTaken = edge;
  } else if (nonDefaultEdges.length === 0 && defaultEdge) {
    // Only default edge — auto-advance
    targetNodeId = defaultEdge.target;
    if (currentStep) currentStep.edgeTaken = "default";
  } else if (nonDefaultEdges.length > 0) {
    // Multiple edges but agent didn't specify — error
    throw new Error(
      `Node '${currentNode.id}' has conditional edges. You must specify which edge to follow: ${currentNode.edges.map((e) => `"${e.condition}"`).join(", ")}`,
    );
  } else {
    // No edges at all (shouldn't reach here due to earlier check)
    session.status = "completed";
    return { done: true, halted: false };
  }

  const nextNode = graph.nodes[targetNodeId];
  if (!nextNode) {
    throw new Error(`Edge target '${targetNodeId}' not found in graph`);
  }

  // Check visit limit
  const visits = (session.visitCounts[targetNodeId] ?? 0) + 1;
  if (visits > nextNode.maxVisits) {
    session.status = "halted";
    session.haltReason = `Node '${targetNodeId}' exceeded max_visits (${nextNode.maxVisits})`;
    return { done: false, halted: true, haltReason: session.haltReason };
  }

  // Advance
  session.currentNodeId = targetNodeId;
  session.visitCounts[targetNodeId] = visits;
  session.history.push({
    nodeId: targetNodeId,
    visit: visits,
    startedAt: new Date().toISOString(),
  });

  return { done: false, halted: false, nextNode };
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
