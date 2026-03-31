/**
 * Claude Code metadata provider — detects Claude Code sessions in a terminal.
 *
 * Detection: scans ~/.claude/sessions/ for {pid}.json, matches each PID's PTY
 * (via /proc/{pid}/fd/0) to the terminal shell's PTY. Once matched, tails
 * the session JSONL transcript to derive state.
 *
 * States derived from last JSONL message:
 * - thinking:  last message is "user" (API call in flight) or "assistant" with null stop_reason
 * - tool_use:  last assistant message has stop_reason "tool_use" (executing tools / permission prompt)
 * - waiting:   last assistant message has stop_reason "end_turn" (idle, awaiting user input)
 *
 * Limitations (Linux-only for now):
 * - PTY matching relies on /proc/{pid}/fd/0 — not available on macOS
 * - Cannot distinguish "waiting for permission" from "executing tool" (both are tool_use)
 * - JSONL updates are not perfectly real-time — batched when API calls complete
 * - progress/streaming messages during thinking are not tracked (only final state)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ClaudeCodeInfo } from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { updateMetadata } from "./index.ts";
import { log } from "../log.ts";

/** Configurable via env for testing. */
const SESSIONS_DIR =
  process.env.KOLU_CLAUDE_SESSIONS_DIR ??
  path.join(os.homedir(), ".claude", "sessions");
const PROJECTS_DIR =
  process.env.KOLU_CLAUDE_PROJECTS_DIR ??
  path.join(os.homedir(), ".claude", "projects");
const POLL_INTERVAL_MS = 3_000;
const TAIL_BYTES = 16_384;

interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
}

/** Read a symlink target, returning null on any error. */
function readlinkSafe(p: string): string | null {
  try {
    return fs.readlinkSync(p);
  } catch {
    return null;
  }
}

/** Get the PTY path for a process via /proc. */
function getPtyForPid(pid: number): string | null {
  return readlinkSafe(`/proc/${pid}/fd/0`);
}

/** Encode a CWD path to the Claude projects directory key (replace / and . with -). */
function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

/**
 * Find the JSONL transcript path for a session.
 *
 * First tries the exact session ID. Falls back to the most recently modified
 * JSONL in the project dir — handles resumed sessions where the PID's session
 * ID differs from the transcript's original session ID.
 */
function findTranscriptPath(session: SessionFile): string | null {
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
  // Only use if modified recently (within 2 poll cycles) — avoids showing
  // stale state from old sessions when a new session hasn't created its
  // JSONL yet. Handles resumed sessions where the PID's session ID differs
  // from the transcript's original session ID.
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
    if (newest && now - newestMtime > POLL_INTERVAL_MS * 2) return null;
    return newest;
  } catch {
    return null;
  }
}

/**
 * Read the last N bytes of a file and parse JSONL lines.
 * Returns lines in order (oldest first).
 */
function tailJsonlLines(filePath: string, bytes: number): string[] {
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
function deriveState(
  lines: string[],
): { state: ClaudeCodeInfo["state"]; model: string | null } | null {
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

/** Compare two ClaudeCodeInfo values for equality. */
function infoEqual(
  a: ClaudeCodeInfo | null,
  b: ClaudeCodeInfo | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.state === b.state && a.sessionId === b.sessionId && a.model === b.model
  );
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
        // Dead process or unreadable file
      }
    }
    return sessions;
  } catch {
    return [];
  }
}

/**
 * Start the Claude Code metadata provider for a terminal entry.
 * Polls for matching Claude Code sessions and tails their transcripts.
 */
export function startClaudeCodeProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "claude-code", terminal: terminalId });

  // Track current match
  let matchedSession: SessionFile | null = null;
  let transcriptPath: string | null = null;
  let watcher: fs.FSWatcher | null = null;

  plog.info("started");

  function getTerminalPty(): string | null {
    return getPtyForPid(entry.handle.pid);
  }

  /** Try to match a Claude Code session to this terminal via PTY. */
  function matchSession(): SessionFile | null {
    const termPty = getTerminalPty();
    if (!termPty) {
      plog.debug({ pid: entry.handle.pid }, "cannot read terminal PTY");
      return null;
    }
    if (!termPty.startsWith("/dev/pts/")) {
      plog.debug({ pty: termPty }, "terminal fd/0 is not a PTY");
      return null;
    }

    const sessions = scanSessions();
    plog.debug({ termPty, sessionCount: sessions.length }, "scanning sessions");
    for (const session of sessions) {
      const sessionPty = getPtyForPid(session.pid);
      if (sessionPty === termPty) return session;
    }
    return null;
  }

  /** Read transcript and update metadata. */
  function updateState() {
    if (!transcriptPath) return;

    const lines = tailJsonlLines(transcriptPath, TAIL_BYTES);
    const derived = deriveState(lines);
    if (!derived) {
      plog.debug(
        { path: transcriptPath },
        "no user/assistant message in transcript tail",
      );
      return;
    }
    if (!matchedSession) return;

    const info: ClaudeCodeInfo = {
      state: derived.state,
      sessionId: matchedSession.sessionId,
      model: derived.model,
    };

    if (infoEqual(info, entry.info.meta.claude)) return;
    plog.info(
      { state: info.state, model: info.model, session: info.sessionId },
      "claude code state updated",
    );
    updateMetadata(entry, terminalId, (m) => {
      m.claude = info;
    });
  }

  /** Start watching the transcript file for changes. */
  function startWatching(filePath: string) {
    stopWatching();
    transcriptPath = filePath;
    try {
      watcher = fs.watch(filePath, () => updateState());
    } catch {
      plog.warn({ path: filePath }, "failed to watch transcript");
    }
  }

  function stopWatching() {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    transcriptPath = null;
  }

  /** Poll for session match and start/stop watching as needed. */
  function poll() {
    const session = matchSession();

    if (!session) {
      // No match — clear state if previously matched
      if (matchedSession) {
        plog.info("claude code session ended");
        matchedSession = null;
        stopWatching();
        if (entry.info.meta.claude !== null) {
          updateMetadata(entry, terminalId, (m) => {
            m.claude = null;
          });
        }
      }
      return;
    }

    // New or different session matched
    if (!matchedSession || matchedSession.sessionId !== session.sessionId) {
      plog.info(
        { session: session.sessionId, pid: session.pid },
        "claude code session matched",
      );
      matchedSession = session;
    }

    // Retry transcript lookup on each poll — JSONL is created lazily
    // after the first message exchange, not at session start
    if (matchedSession && !transcriptPath) {
      const tp = findTranscriptPath(matchedSession);
      if (tp) {
        plog.info({ path: tp }, "transcript found");
        startWatching(tp);
        updateState();
      } else {
        plog.debug(
          { session: matchedSession.sessionId, cwd: matchedSession.cwd },
          "transcript not found yet (JSONL created after first message)",
        );
      }
    }
  }

  // Initial poll + periodic re-scan
  poll();
  const pollTimer = setInterval(poll, POLL_INTERVAL_MS);

  return () => {
    clearInterval(pollTimer);
    stopWatching();
    plog.info("stopped");
  };
}
