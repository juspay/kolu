/**
 * Agent detection — identify AI agents by foreground process name,
 * classify state from session transcript files.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentState, AgentStatus } from "kolu-common";
import { log } from "./log.ts";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const SESSIONS_DIR = path.join(CLAUDE_DIR, "sessions");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

/** Known agent: binary names to match against PTY foreground process. */
interface AgentProfile {
  id: string;
  processNames: string[];
}

const PROFILES: AgentProfile[] = [
  { id: "claude-code", processNames: ["claude"] },
];

/**
 * Detect which agent (if any) is the foreground process.
 */
export function detectAgentByProcess(processName: string): string | null {
  const match = PROFILES.find((p) =>
    p.processNames.some((name) => processName === name),
  );
  return match?.id ?? null;
}

/**
 * Resolve full agent status from foreground process + activity + terminal CWD.
 * Reads Claude Code's JSONL transcript for precise state classification.
 */
export function resolveAgentStatus(
  foregroundProcess: string,
  isActive: boolean,
  terminalCwd: string,
): AgentStatus | null {
  const agent = detectAgentByProcess(foregroundProcess);
  if (!agent) return null;

  const state: AgentState = isActive
    ? "thinking"
    : classifyFromTranscript(terminalCwd);
  return { agent, state };
}

// --- Claude Code transcript-based state classification ---

/** Encode a CWD path to the ~/.claude/projects/ directory name format. */
function encodeProjectPath(cwd: string): string {
  return cwd.replace(/\//g, "-");
}

/** Find the active Claude Code session for a given CWD. */
function findSession(
  terminalCwd: string,
): { sessionId: string; projectDir: string } | null {
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const pid = parseInt(path.basename(file, ".json"), 10);
      if (isNaN(pid)) continue;
      // Check PID is alive
      try {
        process.kill(pid, 0);
      } catch {
        continue;
      }
      const raw = fs.readFileSync(path.join(SESSIONS_DIR, file), "utf-8");
      const session = JSON.parse(raw);
      if (session.cwd === terminalCwd) {
        const projectDir = path.join(
          PROJECTS_DIR,
          encodeProjectPath(session.cwd),
        );
        return { sessionId: session.sessionId, projectDir };
      }
    }
  } catch (err) {
    log.debug({ err }, "failed to scan claude sessions");
  }
  return null;
}

/** Read the last complete JSON line from a JSONL file (reads tail ~8KB). */
function readLastJsonlEntry(filePath: string): Record<string, unknown> | null {
  try {
    const fd = fs.openSync(filePath, "r");
    try {
      const stat = fs.fstatSync(fd);
      if (stat.size === 0) return null;
      const readSize = Math.min(8192, stat.size);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
      const text = buf.toString("utf-8");
      const lines = text.split("\n").filter((l) => l.trim());
      if (lines.length === 0) return null;
      return JSON.parse(lines[lines.length - 1]);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/**
 * Classify Claude Code state from its JSONL transcript.
 * Called when the terminal is idle (no PTY output) and claude is foreground.
 *
 * Last entry patterns:
 *   assistant + text content       → "waiting" (responded, awaiting user input)
 *   assistant + tool_use content   → "thinking" (tool execution in progress)
 *   user + tool_result             → "thinking" (tool result sent, awaiting response)
 *   user + text                    → "thinking" (user prompt sent, awaiting response)
 */
function classifyFromTranscript(terminalCwd: string): AgentState {
  const session = findSession(terminalCwd);
  if (!session) return "idle";

  const jsonlPath = path.join(session.projectDir, `${session.sessionId}.jsonl`);
  const entry = readLastJsonlEntry(jsonlPath);
  if (!entry) return "idle";

  const type = entry.type as string | undefined;
  const message = entry.message as
    | { content?: Array<{ type?: string }> }
    | undefined;
  const contentTypes =
    message?.content?.map((c) => c.type).filter(Boolean) ?? [];

  if (type === "assistant") {
    // Assistant responded — check if it's a tool call or a text response
    if (contentTypes.includes("tool_use")) return "thinking";
    return "waiting";
  }

  if (type === "user") {
    // User sent something (prompt or tool result) — Claude should be thinking
    return "thinking";
  }

  return "idle";
}
