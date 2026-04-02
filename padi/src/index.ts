import { join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { parseWorkflowFile, listWorkflows } from "./graph.js";
import {
  createSession,
  getCurrentNode,
  nodeStatus,
  advance,
  getProgress,
} from "./session.js";
import { writeResults } from "./results.js";
import type { Session, WorkflowGraph } from "./schema.js";

// Resolve paths relative to CWD (the project root)
const cwd = process.cwd();
const workflowsDir = resolve(
  process.env["PADI_WORKFLOWS_DIR"] ?? join(cwd, ".claude/workflows"),
);
const resultsDir = resolve(
  process.env["PADI_RESULTS_DIR"] ?? join(cwd, ".workflow-runs"),
);

// Single active session (one workflow at a time)
let activeSession: Session | undefined;
let activeGraph: WorkflowGraph | undefined;

const server = new McpServer({
  name: "padi",
  version: "0.1.0",
});

/** Validate workflow name contains no path separators. */
function validateWorkflowName(name: string): void {
  if (name.includes("/") || name.includes("\\") || name.includes("..")) {
    throw new Error(`Invalid workflow name: ${name}`);
  }
}

function errorResponse(msg: string) {
  return {
    content: [{ type: "text" as const, text: msg }],
    isError: true as const,
  };
}

function jsonResponse(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

/** Guard: returns the active session + graph or an error response. */
function requireSession() {
  if (!activeSession || !activeGraph)
    return errorResponse("No active session.");
  return { session: activeSession, graph: activeGraph };
}

// --- workflow_list ---
server.tool(
  "workflow_list",
  "List available workflow definitions",
  {},
  async () => jsonResponse(listWorkflows(workflowsDir)),
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
      return errorResponse(
        `A session is already running (${activeSession.id}). Complete or abandon it first.`,
      );
    }

    try {
      validateWorkflowName(workflow);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err));
    }

    const filePath = join(workflowsDir, `${workflow}.yaml`);
    let graph: WorkflowGraph;
    try {
      graph = parseWorkflowFile(filePath, workflow);
    } catch (err) {
      return errorResponse(
        `Error loading workflow: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const ep = entryPoint ?? "default";
    let session: Session;
    try {
      session = createSession(graph, ep, input);
    } catch (err) {
      return errorResponse(
        `Error starting session: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    activeSession = session;
    activeGraph = graph;

    const node = getCurrentNode(graph, session);
    const { line } = getProgress(session);
    writeResults(resultsDir, session);

    return jsonResponse({
      sessionId: session.id,
      progress: line,
      currentNode: nodeStatus(node, session),
    });
  },
);

// --- workflow_current ---
server.tool(
  "workflow_current",
  "Get the current step instruction and metadata",
  {},
  async () => {
    const guard = requireSession();
    if ("isError" in guard) return guard;
    const { session, graph } = guard;

    if (session.status !== "running") {
      return jsonResponse({
        status: session.status,
        haltReason: session.haltReason,
      });
    }

    const node = getCurrentNode(graph, session);
    const { line } = getProgress(session);

    return jsonResponse({
      progress: line,
      currentNode: nodeStatus(node, session),
    });
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
    const guard = requireSession();
    if ("isError" in guard) return guard;
    const { session, graph } = guard;

    if (session.status !== "running") {
      return errorResponse(`Session is ${session.status}.`);
    }

    let result;
    try {
      result = advance(graph, session, evidence, edge);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : String(err));
    }

    writeResults(resultsDir, session);

    if (result.status === "completed") {
      return jsonResponse({
        status: "completed",
        message: "Workflow completed successfully.",
        resultsDir: join(resultsDir, session.id),
      });
    }

    if (result.status === "halted") {
      return jsonResponse({
        status: "halted",
        reason: result.reason,
        resultsDir: join(resultsDir, session.id),
      });
    }

    const { line } = getProgress(session);
    return jsonResponse({
      status: "running",
      progress: line,
      currentNode: nodeStatus(result.nextNode, session),
    });
  },
);

// --- workflow_status ---
server.tool(
  "workflow_status",
  "Get full session status including progress and history",
  {},
  async () => {
    if (!activeSession) return errorResponse("No active session.");

    const { nodes, line } = getProgress(activeSession);

    return jsonResponse({
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
    });
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
