/** Claude Code — state classification via ~/.claude/ JSONL transcripts. */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentState } from "kolu-common";
import { log } from "../log.ts";

const CLAUDE_DIR = path.join(os.homedir(), ".claude");
const SESSIONS_DIR = path.join(CLAUDE_DIR, "sessions");
const PROJECTS_DIR = path.join(CLAUDE_DIR, "projects");

const WATCH_DEBOUNCE_MS = 150;

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
 *
 * Last entry patterns:
 *   assistant + text content       → "waiting" (responded, awaiting user input)
 *   assistant + tool_use content   → "thinking" (tool execution in progress)
 *   user + tool_result             → "thinking" (tool result sent, awaiting response)
 *   user + text                    → "thinking" (user prompt sent, awaiting response)
 */
export function classifyState(terminalCwd: string): AgentState {
  const session = findSession(terminalCwd);
  if (!session) return "waiting"; // no session yet → at initial prompt

  const jsonlPath = path.join(session.projectDir, `${session.sessionId}.jsonl`);
  const entry = readLastJsonlEntry(jsonlPath);
  if (!entry) return "waiting"; // empty transcript → at initial prompt

  const type = entry.type as string | undefined;
  const content = (entry.message as Record<string, unknown> | undefined)
    ?.content;
  const contentTypes = Array.isArray(content)
    ? content.map((c: { type?: string }) => c.type).filter(Boolean)
    : [];

  if (type === "assistant") {
    if (contentTypes.includes("tool_use")) return "thinking";
    return "waiting";
  }

  if (type === "user") return "thinking";

  return "idle";
}

interface WatchResult {
  cleanup: () => void;
  active: boolean;
}

/**
 * Watch the JSONL transcript for changes.
 * Returns { active: false } if no session found yet (caller should retry).
 */
export function watchState(
  terminalCwd: string,
  onChange: () => void,
): WatchResult {
  const session = findSession(terminalCwd);
  if (!session) {
    log.debug({ terminalCwd }, "no claude session found for transcript watch");
    return { cleanup: () => {}, active: false };
  }

  const jsonlPath = path.join(session.projectDir, `${session.sessionId}.jsonl`);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: fs.FSWatcher | undefined;
  try {
    watcher = fs.watch(jsonlPath, (event) => {
      if (event !== "change") return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, WATCH_DEBOUNCE_MS);
    });
  } catch {
    return { cleanup: () => {}, active: false };
  }

  log.info({ terminalCwd, jsonlPath }, "watching claude transcript");
  return {
    active: true,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      watcher?.close();
    },
  };
}
