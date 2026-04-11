/**
 * Claude Code integration — pure functions and IO helpers for detecting
 * Claude Code sessions and deriving state from JSONL transcripts.
 *
 * No dependency on server internals (no updateMetadata, no TerminalProcess).
 * The server's provider imports these and wires them into the metadata system.
 *
 * Detection: reads ~/.claude/sessions/{pid}.json to find sessions, then
 * tails the JSONL transcript in ~/.claude/projects/{encoded-cwd}/ to
 * derive state (thinking, tool_use, waiting).
 *
 * Event-driven watchers (fs.watch) are also exported for the server to
 * compose into its provider lifecycle.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { match } from "ts-pattern";
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";

// --- Claude Code schemas (single source of truth) ---

export const TaskProgressSchema = z.object({
  /** Total number of tasks created (excluding deleted). */
  total: z.number(),
  /** Number of tasks with status "completed". */
  completed: z.number(),
});

export const ClaudeCodeInfoSchema = z.object({
  kind: z.literal("claude-code"),
  /** Current state derived from session JSONL. */
  state: z.enum(["thinking", "tool_use", "waiting"]),
  /** Session UUID from ~/.claude/sessions/. */
  sessionId: z.string(),
  /** Model name if available (e.g. "claude-opus-4-6"). */
  model: z.string().nullable(),
  /** Display title from the Claude Agent SDK — custom title › auto-summary › first prompt.
   *  Refreshed best-effort on each transcript change; null until the first lookup resolves. */
  summary: z.string().nullable(),
  /** Task checklist progress derived from TaskCreate/TaskUpdate tool calls in the transcript.
   *  null when no tasks have been created in the session. */
  taskProgress: TaskProgressSchema.nullable(),
});

export type ClaudeCodeInfo = z.infer<typeof ClaudeCodeInfoSchema>;
export type TaskProgress = z.infer<typeof TaskProgressSchema>;

// --- Configuration ---

/** Configurable via env for testing. */
export const SESSIONS_DIR =
  process.env.KOLU_CLAUDE_SESSIONS_DIR ??
  path.join(os.homedir(), ".claude", "sessions");
export const PROJECTS_DIR =
  process.env.KOLU_CLAUDE_PROJECTS_DIR ??
  path.join(os.homedir(), ".claude", "projects");

/** True when the e2e harness has redirected the projects/sessions dirs at
 *  test fixtures. The Claude Agent SDK has no equivalent override and would
 *  silently scan the user's real ~/.claude/projects, adding fs.watch and
 *  inotify pressure that has been observed to race with the mock harness
 *  on Linux. Skip summary fetching entirely under test. */
export const SUMMARY_FETCH_ENABLED =
  process.env.KOLU_CLAUDE_PROJECTS_DIR === undefined &&
  process.env.KOLU_CLAUDE_SESSIONS_DIR === undefined;

/** Tail window for `tailJsonlLines` — must exceed the largest single JSONL
 *  entry so that at least one complete line is present after dropping the
 *  (potentially partial) first line.
 *
 *  Sized at 256 KB because real-world claude-code sessions regularly emit
 *  individual assistant entries in the 20–55 KB range (long thinking blocks,
 *  batched tool_use calls, multi-file diffs), with user entries from pasted
 *  content reaching 1 MB+. At 16 KB we silently miss state transitions when
 *  the terminal assistant line overflows the window — `tailJsonlLines`
 *  returns `[]`, `deriveState` returns `null`, and the previous state (often
 *  "thinking") persists forever, leaving the sidebar stuck mid-response.
 *
 *  256 KB gives ~4.6× headroom over the largest assistant line observed
 *  locally and matches the chunk size in mux's `historyService.ts` reverse
 *  tail reader. Allocated transiently per watcher callback — no lasting
 *  memory cost. If single entries ever exceed this, the correct upgrade is
 *  a chunked reverse read that keeps extending until it finds a newline
 *  (mux's pattern), not another bump. */
export const TAIL_BYTES = 256 * 1024;

// --- Session file reading ---

export interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
}

/**
 * Read a Claude session file by pid. Returns null if the file doesn't
 * exist (the common case — most pids are not claude-code sessions) or
 * if the file is unreadable / malformed / missing required fields.
 */
export function readSessionFile(
  pid: number,
  log?: { debug: (obj: Record<string, unknown>, msg: string) => void },
): SessionFile | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(SESSIONS_DIR, `${pid}.json`), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.debug({ err, pid }, "claude session file unreadable");
    }
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SessionFile>;
    if (
      typeof parsed.pid !== "number" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.cwd !== "string"
    ) {
      log?.debug({ pid, parsed }, "claude session file shape unexpected");
      return null;
    }
    return parsed as SessionFile;
  } catch (err) {
    log?.debug({ err, pid }, "claude session file parse failed");
    return null;
  }
}

// --- Project path encoding ---

/** Encode a CWD path to the Claude projects directory key (replace / and . with -). */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

// --- Transcript path discovery ---

/**
 * Find the JSONL transcript path for a session — exact match by session ID.
 *
 * Returns null if the file doesn't exist yet (common: claude creates the
 * JSONL lazily on the first user↔assistant exchange, not at session start).
 * Callers should treat null as "wait and retry" via a project dir watcher,
 * not as "give up".
 *
 * No MRU fallback: picking the most recently modified file in the project
 * dir leads to attaching to a stale previous-session transcript while the
 * current session's file is still being created. Better to wait.
 */
export function findTranscriptPath(session: SessionFile): string | null {
  const projectDir = path.join(PROJECTS_DIR, encodeProjectPath(session.cwd));
  const exactPath = path.join(projectDir, `${session.sessionId}.jsonl`);
  try {
    fs.accessSync(exactPath);
    return exactPath;
  } catch {
    return null;
  }
}

// --- JSONL reading ---

/**
 * Read JSONL lines from a file starting at the given byte offset.
 * Used by the debug transcript procedure to surface every event since
 * monitoring began (not just the state-derivation tail).
 *
 * Unlike `tailJsonlLines`, this never trims a partial first line — the
 * caller anchors `offset` at a known line boundary (the file size at
 * watcher-attach time).
 */
export function readJsonlFromOffset(
  filePath: string,
  offset: number,
): unknown[] {
  try {
    const stat = fs.statSync(filePath);
    if (offset >= stat.size) return [];
    const length = stat.size - offset;
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, offset);
    fs.closeSync(fd);
    const out: unknown[] = [];
    for (const line of buf.toString("utf8").split("\n")) {
      if (line.length === 0) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        out.push({ __unparsed: line });
      }
    }
    return out;
  } catch (err) {
    return [];
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

// --- State derivation ---

/** Derive Claude Code state from the last relevant JSONL message. */
export function deriveState(
  lines: string[],
): { state: ClaudeCodeInfo["state"]; model: string | null } | null {
  // Walk backwards to find the last assistant or user message
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry: {
        type?: string;
        message?: { stop_reason?: string | null; model?: string | null };
      } = JSON.parse(lines[i]!);
      const model = entry.message?.model ?? null;
      const result = match({
        type: entry.type,
        stopReason: entry.message?.stop_reason ?? null,
      })
        .with({ type: "assistant", stopReason: "end_turn" }, () => ({
          state: "waiting" as const,
          model,
        }))
        .with({ type: "assistant", stopReason: "tool_use" }, () => ({
          state: "tool_use" as const,
          model,
        }))
        .with({ type: "assistant" }, () => ({
          state: "thinking" as const,
          model,
        }))
        .with({ type: "user" }, () => ({
          state: "thinking" as const,
          model: null,
        }))
        .otherwise(() => null);
      if (result !== null) return result;
    } catch {
      // Skip malformed lines
    }
  }
  return null;
}

// --- Task extraction ---

/**
 * Scan JSONL lines for TaskCreate/TaskUpdate tool calls and accumulate into
 * the provided task map. Returns true if the map changed.
 */
export function extractTasks(
  lines: string[],
  tasks: Map<string, "pending" | "in_progress" | "completed">,
  plog: { warn: (obj: Record<string, unknown>, msg: string) => void },
): boolean {
  let changed = false;
  for (const line of lines) {
    let entry: {
      type?: string;
      message?: {
        content?: Array<{
          type?: string;
          name?: string;
          input?: Record<string, unknown>;
        }>;
      };
      toolUseResult?: { task?: { id?: string } };
    };
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    // TaskCreate results come on "user" type messages with toolUseResult.task
    if (entry.type === "user" && entry.toolUseResult?.task?.id) {
      const id = entry.toolUseResult.task.id;
      if (typeof id === "string" && !tasks.has(id)) {
        tasks.set(id, "pending");
        changed = true;
      }
      continue;
    }

    // TaskUpdate calls come on "assistant" type messages as tool_use content blocks
    if (entry.type !== "assistant" || !Array.isArray(entry.message?.content))
      continue;

    for (const block of entry.message!.content!) {
      if (block.type !== "tool_use" || block.name !== "TaskUpdate") continue;
      const input = block.input;
      if (!input || typeof input !== "object") {
        plog.warn({ block }, "TaskUpdate tool call has unexpected input shape");
        continue;
      }
      const taskId = input.taskId;
      const status = input.status;
      if (typeof taskId !== "string" || typeof status !== "string") {
        plog.warn({ input }, "TaskUpdate tool call missing taskId or status");
        continue;
      }
      if (status === "deleted") {
        if (tasks.has(taskId)) {
          tasks.delete(taskId);
          changed = true;
        }
      } else if (
        status === "pending" ||
        status === "in_progress" ||
        status === "completed"
      ) {
        if (tasks.get(taskId) !== status) {
          tasks.set(taskId, status);
          changed = true;
        }
      }
    }
  }
  return changed;
}

/** Derive TaskProgress summary from a task map. Returns null if empty. */
export function deriveTaskProgress(
  tasks: Map<string, "pending" | "in_progress" | "completed">,
): TaskProgress | null {
  if (tasks.size === 0) return null;
  let completed = 0;
  for (const status of tasks.values()) {
    if (status === "completed") completed++;
  }
  return { total: tasks.size, completed };
}

// --- fs.watch helpers ---

/**
 * Try to watch a directory. Returns a cleanup function on success, null
 * if watch failed. ENOENT (directory doesn't exist yet) is expected and
 * silent; other errors (EACCES, EMFILE, etc.) surface at debug so they're
 * discoverable without spamming the log.
 */
export function tryWatchDir(
  dir: string,
  onChange: () => void,
  log?: { debug: (obj: Record<string, unknown>, msg: string) => void },
): (() => void) | null {
  try {
    const w = fs.watch(dir, () => onChange());
    return () => w.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.debug({ err, dir }, "fs.watch failed");
    }
    return null;
  }
}

/**
 * Watch a directory that may not yet exist. If direct watch fails, falls
 * back to watching the immediate parent (one level only) and re-attaches
 * to the target as soon as it appears. Returns a cleanup function.
 *
 * Used for both SESSIONS_DIR (absent on fresh systems until first claude
 * run) and the per-session project dir under PROJECTS_DIR (created lazily
 * when claude writes its first transcript).
 */
export function watchOrWaitForDir(
  dir: string,
  onChange: () => void,
  log?: { debug: (obj: Record<string, unknown>, msg: string) => void },
): () => void {
  const direct = tryWatchDir(dir, onChange, log);
  if (direct) return direct;

  let child: (() => void) | null = null;
  let parentWatcher: fs.FSWatcher | null = null;
  try {
    parentWatcher = fs.watch(path.dirname(dir), () => {
      if (child) return;
      const attached = tryWatchDir(dir, onChange, log);
      if (!attached) return;
      child = attached;
      parentWatcher?.close();
      parentWatcher = null;
      // Kick — dir may already contain files (race: created between our
      // first attempt and the parent event).
      onChange();
    });
  } catch (err) {
    log?.debug({ err, dir }, "fs.watch parent fallback failed");
  }
  return () => {
    parentWatcher?.close();
    child?.();
  };
}

// --- Shared SESSIONS_DIR watcher ---
//
// Every consumer of this package that wants to react to session
// file appearance/disappearance needs a watch on SESSIONS_DIR. Rather
// than have each caller install its own fs.watch (so N consumers = N
// duplicate watchers + N duplicate dispatches per event), this module
// refcounts a single watcher: first subscriber lazily installs it,
// last unsubscribe tears it down.
//
// `sharedSessionsDir` is a single nullable structure (not a
// {watcher, listeners} pair) so the "active iff non-empty" invariant
// is mechanical — there's no way for the two halves to disagree.
//
// Per-listener `onError` is required (not optional) so fault isolation
// is a type-system obligation, not a convention. If one listener's
// callback throws, its own onError runs, and iteration continues to
// the next listener unaffected.

interface SessionsDirListener {
  cb: () => void;
  onError: (err: unknown) => void;
}

let sharedSessionsDir: {
  cleanup: () => void;
  listeners: Set<SessionsDirListener>;
} | null = null;

/**
 * Subscribe to changes in `SESSIONS_DIR`. Returns an unsubscribe
 * function. The underlying `fs.watch` is shared across all
 * subscribers — refcounted, installed on first subscribe, torn down
 * on last unsubscribe.
 *
 * `onError` receives any exception thrown by `onChange` and runs
 * in place of breaking the iteration over peer listeners. Callers
 * must provide one (silent swallowing would hide bugs) — pass a
 * logger call like `(err) => log.warn({ err }, "...")`.
 */
export function subscribeSessionsDir(
  onChange: () => void,
  onError: (err: unknown) => void,
): () => void {
  if (!sharedSessionsDir) {
    const listeners = new Set<SessionsDirListener>();
    const cleanup = watchOrWaitForDir(SESSIONS_DIR, () => {
      // Snapshot before iteration so a listener that subscribes or
      // unsubscribes synchronously can't skip a peer for this event.
      for (const l of [...listeners]) {
        try {
          l.cb();
        } catch (err) {
          l.onError(err);
        }
      }
    });
    sharedSessionsDir = { cleanup, listeners };
  }
  const listener: SessionsDirListener = { cb: onChange, onError };
  sharedSessionsDir.listeners.add(listener);
  return () => {
    if (!sharedSessionsDir) return;
    sharedSessionsDir.listeners.delete(listener);
    if (sharedSessionsDir.listeners.size === 0) {
      sharedSessionsDir.cleanup();
      sharedSessionsDir = null;
    }
  };
}

// --- Summary fetching ---

/** Fetch the display summary from the Claude Agent SDK. Returns null on failure. */
export async function fetchSessionSummary(
  sessionId: string,
  cwd: string,
): Promise<string | null> {
  if (!SUMMARY_FETCH_ENABLED) return null;
  const info = await getSessionInfo(sessionId, { dir: cwd });
  return info?.summary ?? null;
}

// --- Debug schemas ---

/** A single state transition the server observed. `info: null` = session ended. */
export const ClaudeStateChangeSchema = z.object({
  ts: z.number(),
  info: ClaudeCodeInfoSchema.nullable(),
});

/** Diagnostic snapshot comparing what the server saw against the on-disk JSONL.
 *  Used by the Debug → "Show Claude transcript" command. */
export const ClaudeTranscriptDebugSchema = z.object({
  transcriptPath: z.string(),
  /** epoch ms when kolu attached its transcript watcher (= start of monitoring). */
  startedAt: z.number(),
  /** What the server believes happened — every transition that passed `infoEqual`. */
  stateChanges: z.array(ClaudeStateChangeSchema),
  /** Raw JSONL lines from disk, from `startedAt` offset to EOF. One element per line. */
  rawEvents: z.array(z.unknown()),
});

// --- Session watcher ---

export {
  createSessionWatcher,
  getPendingSummaryFetches,
  infoEqual,
  type SessionWatcher,
  type ClaudeStateChange,
  type ClaudeTranscriptDebug,
  type WatcherLog,
} from "./session-watcher.ts";
