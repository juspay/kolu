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

export const WorkflowGraphSchema = z.object({
  name: z.string(),
  entryPoints: z.record(z.string(), z.string()),
  defaults: z.object({ maxVisits: z.number().int().positive() }),
  nodes: z.record(z.string(), WorkflowNodeSchema),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraphSchema>;

// --- Session state (in-memory) ---

export const StepRecordSchema = z.object({
  nodeId: z.string(),
  visit: z.number().int(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  evidence: z.string().optional(),
  edgeTaken: z.string().optional(),
});
export type StepRecord = z.infer<typeof StepRecordSchema>;

export type SessionStatus = "running" | "completed" | "halted";

export const SessionSchema = z.object({
  id: z.string(),
  workflowName: z.string(),
  entryPoint: z.string(),
  input: z.string().optional(),
  currentNodeId: z.string(),
  visitCounts: z.record(z.string(), z.number()),
  history: z.array(StepRecordSchema),
  happyPath: z.array(z.string()),
  startedAt: z.string(),
  status: z.enum(["running", "completed", "halted"]),
  haltReason: z.string().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

// --- Tool I/O ---

export const StartInputSchema = z.object({
  workflow: z.string().describe("Workflow name (filename without .yaml)"),
  entryPoint: z
    .string()
    .optional()
    .describe("Entry point name (default: 'default')"),
  input: z.string().optional().describe("Task input / description"),
});

export const CompleteInputSchema = z.object({
  evidence: z.string().describe("What happened — opaque string recorded as-is"),
  edge: z
    .string()
    .optional()
    .describe(
      "Edge condition to follow (omit for auto-advance on default-only nodes)",
    ),
});

export const NodeStatusSchema = z.object({
  id: z.string(),
  description: z.string(),
  instruction: InstructionSchema,
  visit: z.number(),
  maxVisits: z.number(),
  edges: z.array(WorkflowEdgeSchema),
});

export const ProgressNodeSchema = z.object({
  id: z.string(),
  state: z.enum(["completed", "current", "pending"]),
});

export const StatusResponseSchema = z.object({
  session: SessionSchema,
  progress: z.array(ProgressNodeSchema),
  progressLine: z.string(),
});
