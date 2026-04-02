import { z } from "zod";

// --- Workflow definition (parsed from YAML) ---

export const InstructionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run"), command: z.string() }),
  z.object({ type: z.literal("skill"), name: z.string() }),
  z.object({ type: z.literal("prompt"), text: z.string() }),
]);
export type Instruction = z.infer<typeof InstructionSchema>;

export const WorkflowEdgeSchema = z.object({
  condition: z.string(),
  target: z.string(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowNodeSchema = z.object({
  id: z.string(),
  description: z.string(),
  instruction: InstructionSchema,
  maxVisits: z.number().int().positive(),
  edges: z.array(WorkflowEdgeSchema),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export interface WorkflowGraph {
  name: string;
  entryPoints: Record<string, string>;
  defaults: { maxVisits: number };
  nodes: Record<string, WorkflowNode>;
}

// --- Session state (in-memory) ---

export interface StepRecord {
  nodeId: string;
  visit: number;
  startedAt: string;
  completedAt?: string;
  evidence?: string;
  edgeTaken?: string;
}

export interface Session {
  id: string;
  workflowName: string;
  entryPoint: string;
  input?: string;
  currentNodeId: string;
  visitCounts: Record<string, number>;
  history: StepRecord[];
  happyPath: string[];
  startedAt: string;
  status: "running" | "completed" | "halted";
  haltReason?: string;
}

/** Snapshot of a node for tool responses. */
export interface NodeStatus {
  id: string;
  description: string;
  instruction: Instruction;
  visit: number;
  maxVisits: number;
  edges: WorkflowEdge[];
}

export interface ProgressNode {
  id: string;
  state: "completed" | "current" | "pending";
}

/** Result of advancing the state machine one step. */
export type AdvanceResult =
  | { status: "running"; nextNode: WorkflowNode }
  | { status: "completed" }
  | { status: "halted"; reason: string };
