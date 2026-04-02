import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseWorkflowFile, listWorkflows } from "./graph.js";
import {
  createSession,
  getCurrentNode,
  advance,
  getProgress,
} from "./session.js";
import { writeResults } from "./results.js";
import type { Session, WorkflowGraph } from "./schema.js";

// Resolve paths relative to CWD (the project root)
const cwd = process.cwd();
const workflowsDir = resolve(
  process.env["WORKFLOW_MCP_WORKFLOWS_DIR"] ?? join(cwd, ".claude/workflows"),
);
const resultsDir = resolve(
  process.env["WORKFLOW_MCP_RESULTS_DIR"] ?? join(cwd, ".workflow-runs"),
);

// Single active session (one workflow at a time)
let activeSession: Session | undefined;
let activeGraph: WorkflowGraph | undefined;

const server = new McpServer({
  name: "workflow-mcp",
  version: "0.1.0",
});

// --- workflow_list ---
server.tool(
  "workflow_list",
  "List available workflow definitions",
  {},
  async () => {
    const names = listWorkflows(workflowsDir);
    return {
      content: [{ type: "text", text: JSON.stringify(names) }],
    };
  },
);

// --- workflow_start ---
server.tool(
  "workflow_start",
  "Start a new workflow session. Returns the first step instruction.",
  {
    workflow: z.string().describe("Workflow name (filename without .yaml)"),
    entryPoint: z
      .string()
      .optional()
      .describe("Entry point name (default: 'default')"),
    input: z.string().optional().describe("Task input / description"),
  },
  async ({ workflow, entryPoint, input }) => {
    if (activeSession?.status === "running") {
      return {
        content: [
          {
            type: "text",
            text: `Error: A session is already running (${activeSession.id}). Complete or abandon it first.`,
          },
        ],
        isError: true,
      };
    }

    const filePath = join(workflowsDir, `${workflow}.yaml`);
    let graph: WorkflowGraph;
    try {
      graph = parseWorkflowFile(filePath, workflow);
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error loading workflow: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }

    const ep = entryPoint ?? "default";
    let session: Session;
    try {
      session = createSession(graph, ep, input);
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error starting session: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }

    activeSession = session;
    activeGraph = graph;

    const node = getCurrentNode(graph, session);
    const { line } = getProgress(session);
    writeResults(resultsDir, session);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            sessionId: session.id,
            progress: line,
            currentNode: {
              id: node.id,
              description: node.description,
              instruction: node.instruction,
              visit: session.visitCounts[node.id] ?? 0,
              maxVisits: node.maxVisits,
              edges: node.edges,
            },
          }),
        },
      ],
    };
  },
);

// --- workflow_current ---
server.tool(
  "workflow_current",
  "Get the current step instruction and metadata",
  {},
  async () => {
    if (!activeSession || !activeGraph) {
      return {
        content: [{ type: "text", text: "Error: No active session." }],
        isError: true,
      };
    }

    if (activeSession.status !== "running") {
      return {
        content: [
          {
            type: "text",
            text: `Session is ${activeSession.status}. ${activeSession.haltReason ?? ""}`,
          },
        ],
      };
    }

    const node = getCurrentNode(activeGraph, activeSession);
    const { line } = getProgress(activeSession);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            progress: line,
            currentNode: {
              id: node.id,
              description: node.description,
              instruction: node.instruction,
              visit: activeSession.visitCounts[node.id] ?? 0,
              maxVisits: node.maxVisits,
              edges: node.edges,
            },
          }),
        },
      ],
    };
  },
);

// --- workflow_complete ---
server.tool(
  "workflow_complete",
  "Complete the current step with evidence. Returns the next step or completion status.",
  {
    evidence: z
      .string()
      .describe("What happened — opaque string recorded as-is"),
    edge: z
      .string()
      .optional()
      .describe(
        "Edge condition to follow (omit to auto-advance on default-only nodes)",
      ),
  },
  async ({ evidence, edge }) => {
    if (!activeSession || !activeGraph) {
      return {
        content: [{ type: "text", text: "Error: No active session." }],
        isError: true,
      };
    }

    if (activeSession.status !== "running") {
      return {
        content: [
          {
            type: "text",
            text: `Error: Session is ${activeSession.status}.`,
          },
        ],
        isError: true,
      };
    }

    let result;
    try {
      result = advance(activeGraph, activeSession, evidence, edge);
    } catch (err) {
      return {
        content: [
          {
            type: "text",
            text: `Error: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }

    writeResults(resultsDir, activeSession);

    if (result.done) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "completed",
              message: "Workflow completed successfully.",
              resultsDir: join(resultsDir, activeSession.id),
            }),
          },
        ],
      };
    }

    if (result.halted) {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              status: "halted",
              reason: result.haltReason,
              resultsDir: join(resultsDir, activeSession.id),
            }),
          },
        ],
      };
    }

    const node = result.nextNode!;
    const { line } = getProgress(activeSession);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "running",
            progress: line,
            currentNode: {
              id: node.id,
              description: node.description,
              instruction: node.instruction,
              visit: activeSession.visitCounts[node.id] ?? 0,
              maxVisits: node.maxVisits,
              edges: node.edges,
            },
          }),
        },
      ],
    };
  },
);

// --- workflow_status ---
server.tool(
  "workflow_status",
  "Get full session status including progress and history",
  {},
  async () => {
    if (!activeSession) {
      return {
        content: [{ type: "text", text: "Error: No active session." }],
        isError: true,
      };
    }

    const { nodes, line } = getProgress(activeSession);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            session: {
              id: activeSession.id,
              workflowName: activeSession.workflowName,
              status: activeSession.status,
              haltReason: activeSession.haltReason,
              startedAt: activeSession.startedAt,
              input: activeSession.input,
            },
            progress: nodes,
            progressLine: line,
            history: activeSession.history,
          }),
        },
      ],
    };
  },
);

// --- Start server ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
