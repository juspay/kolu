/**
 * Claude Code state reader — derives agent state from session JSONL transcripts.
 *
 * Pure functions for reading Claude Code session data. No polling, no PTY matching —
 * the process provider detects "claude" as the foreground process, then calls
 * readClaudeCodeState() to get the current state.
 *
 * States derived from last JSONL message:
 * - thinking:  last message is "user" (API call in flight) or "assistant" with null stop_reason
 * - tool_use:  last assistant message has stop_reason "tool_use" (executing tools / permission prompt)
 * - waiting:   last assistant message has stop_reason "end_turn" (idle, awaiting user input)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentInfo, AgentState } from "kolu-common";
import { log } from "../log.ts";

/** Configurable via env for testing. */
const SESSIONS_DIR =
  process.env.KOLU_CLAUDE_SESSIONS_DIR ??
  path.join(os.homedir(), ".claude", "sessions");
const PROJECTS_DIR =
  process.env.KOLU_CLAUDE_PROJECTS_DIR ??
  path.join(os.homedir(), ".claude", "projects");
const TAIL_BYTES = 16_384;

export interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
}

/** Encode a CWD path to the Claude projects directory key (replace / and . with -). */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

/**
 * Find the JSONL transcript path for a session.
 *
 * First tries the exact session ID. Falls back to the most recently modified
 * JSONL in the project dir — handles resumed sessions where the PID's session
 * ID differs from the transcript's original session ID.
 */
export function findTranscriptPath(
  session: SessionFile,
  recentThresholdMs: number = 6_000,
): string | null {
  const projectDir = path.join(PROJECTS_DIR, encodeProjectPath(session.cwd));

  // Exact match by session ID
  const exactPath = path.join(projectDir, `${session.sessionId}.jsonl`);
  try {
    fs.accessSync(exactPath);
    return exactPath;
  } catch {
    // fall through to MRU scan
  }

  // Fallback: most recently modified JSONL in the project dir.
  try {
    const files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith(".jsonl"));
    if (files.length === 0) return null;

    const now = Date.now();
    let newest: string | null = null;
    let newestMtime = 0;
    for (const file of files) {
      const full = path.join(projectDir, file);
      const stat = fs.statSync(full);
      if (stat.mtimeMs > newestMtime) {
        newestMtime = stat.mtimeMs;
        newest = full;
      }
    }
    // Stale if not modified within recent window
    if (newest && now - newestMtime > recentThresholdMs) return null;
    return newest;
  } catch {
    return null;
  }
}

/**
 * Read the last N bytes of a file and parse JSONL lines.
 * Returns lines in order (oldest first).
 */
export function tailJsonlLines(filePath: string, bytes: number): string[] {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - bytes);
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(Math.min(bytes, stat.size));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const text = buf.toString("utf8");
    const lines = text.split("\n").filter((l) => l.length > 0);
    // First line may be partial if we started mid-line — skip it unless we read from start
    if (start > 0 && lines.length > 0) lines.shift();
    return lines;
  } catch {
    return [];
  }
}

/** Derive Claude Code state from the last relevant JSONL message. */
export function deriveState(
  lines: string[],
): { state: AgentState; model: string | null } | null {
  // Walk backwards to find the last assistant or user message
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]!);
      const type: string = entry.type;

      if (type === "assistant") {
        const stopReason: string | null = entry.message?.stop_reason ?? null;
        const model: string | null = entry.message?.model ?? null;
        if (stopReason === "end_turn") {
          return { state: "waiting", model };
        }
        if (stopReason === "tool_use") {
          return { state: "tool_use", model };
        }
        // null or other → still thinking
        return { state: "thinking", model };
      }

      if (type === "user") {
        // User sent a message or tool result — Claude is about to think
        return { state: "thinking", model: null };
      }
    } catch {
      // Skip malformed lines
    }
  }
  return null;
}

/** Read a symlink target, returning null on any error. */
function readlinkSafe(p: string): string | null {
  try {
    return fs.readlinkSync(p);
  } catch {
    return null;
  }
}

/** Scan sessions dir and return all live sessions. */
function scanSessions(): SessionFile[] {
  try {
    const files = fs.readdirSync(SESSIONS_DIR);
    const sessions: SessionFile[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const raw = fs.readFileSync(path.join(SESSIONS_DIR, file), "utf8");
        const data = JSON.parse(raw) as SessionFile;
        // Verify process is still alive
        process.kill(data.pid, 0);
        sessions.push(data);
      } catch {
        // Dead process or unreadable file — skip
      }
    }
    return sessions;
  } catch {
    // Sessions dir doesn't exist yet — not an error
    return [];
  }
}

/**
 * Find the Claude Code session running in a terminal by matching PTYs.
 * The shell PID owns the PTY; Claude (a child) inherits the same PTY.
 * We match by checking if any live session's PID has the same PTY as the shell.
 */
function findSessionForTerminal(shellPid: number): SessionFile | null {
  const termPty = readlinkSafe(`/proc/${shellPid}/fd/0`);
  if (!termPty || !termPty.startsWith("/dev/pts/")) return null;

  for (const session of scanSessions()) {
    const sessionPty = readlinkSafe(`/proc/${session.pid}/fd/0`);
    if (sessionPty === termPty) return session;
  }
  return null;
}

/**
 * Read Claude Code agent state for a terminal's shell PID.
 * Scans session files and matches via PTY to find the Claude process,
 * then tails its JSONL transcript to derive state.
 */
export function readClaudeCodeState(shellPid: number): AgentInfo | null {
  const session = findSessionForTerminal(shellPid);
  if (!session) return null;

  const transcriptPath = findTranscriptPath(session);
  if (!transcriptPath) return null;

  const lines = tailJsonlLines(transcriptPath, TAIL_BYTES);
  const derived = deriveState(lines);
  if (!derived) return null;

  return {
    kind: "claude-code",
    state: derived.state,
    sessionId: session.sessionId,
    model: derived.model,
  };
}

/** Compare two AgentInfo values for equality. */
export function agentInfoEqual(
  a: AgentInfo | null,
  b: AgentInfo | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.kind === b.kind &&
    a.state === b.state &&
    a.sessionId === b.sessionId &&
    a.model === b.model
  );
}

/** Optional: start watching a Claude JSONL transcript for near-instant state updates.
 *  Returns a cleanup function. The `onChange` callback is called when the file changes. */
export function watchTranscript(
  shellPid: number,
  onChange: () => void,
): (() => void) | null {
  const session = findSessionForTerminal(shellPid);
  if (!session) return null;

  const transcriptPath = findTranscriptPath(session);
  if (!transcriptPath) return null;

  const plog = log.child({ provider: "claude-watch" });
  try {
    const watcher = fs.watch(transcriptPath, () => onChange());
    plog.debug({ path: transcriptPath }, "watching transcript");
    return () => {
      watcher.close();
      plog.debug("transcript watch stopped");
    };
  } catch {
    plog.warn({ path: transcriptPath }, "failed to watch transcript");
    return null;
  }
}
