/**
 * Claude Code core — pure functions and IO helpers for detecting
 * Claude Code sessions and deriving state from JSONL transcripts.
 *
 * No dependency on server internals (no updateServerMetadata, no TerminalProcess).
 * The server's provider imports these and wires them into the metadata system.
 *
 * Detection: reads ~/.claude/sessions/{pid}.json to find sessions, then
 * tails the JSONL transcript in ~/.claude/projects/{encoded-cwd}/ to
 * derive state (thinking, tool_use, waiting).
 *
 * Event-driven watchers (fs.watch) are also exported for the server to
 * compose into its provider lifecycle.
 *
 * Structure note: this file holds the leaf module. Peers `session-watcher.ts`
 * and `agent-provider.ts` import from here; `index.ts` is a pure barrel
 * re-exporting from all three (plus `schemas.ts`). Keeps the package free
 * of the index ↔ session-watcher ↔ agent-provider cycle that `index.ts`
 * sat at the center of when it acted as both the helper hub and the
 * barrel simultaneously.
 */

import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { classifyByAwaiting } from "anyagent";
import {
  readRange as executorReadRange,
  readTailLines as executorReadTailLines,
  statSizeBytes as executorStatSizeBytes,
  type Executor,
} from "kolu-io";
import type { Logger } from "kolu-shared";
import { match } from "ts-pattern";
import type { ClaudeCodeInfo, TaskProgress } from "./schemas.ts";

// --- Configuration ---

const SESSIONS_REL = ".claude/sessions";
const PROJECTS_REL = ".claude/projects";
const LOCAL_SESSIONS_DIR_OVERRIDE = process.env.KOLU_CLAUDE_SESSIONS_DIR;
const LOCAL_PROJECTS_DIR_OVERRIDE = process.env.KOLU_CLAUDE_PROJECTS_DIR;

export const SESSIONS_DIR =
  LOCAL_SESSIONS_DIR_OVERRIDE ?? `${process.env.HOME ?? ""}/${SESSIONS_REL}`;
export const PROJECTS_DIR =
  LOCAL_PROJECTS_DIR_OVERRIDE ?? `${process.env.HOME ?? ""}/${PROJECTS_REL}`;

/** True when the e2e harness has redirected the projects/sessions dirs at
 *  test fixtures. The Claude Agent SDK has no equivalent override and would
 *  silently scan the user's real ~/.claude/projects, adding fs.watch and
 *  inotify pressure that has been observed to race with the mock harness
 *  on Linux. Skip summary fetching entirely under test. */
export const SUMMARY_FETCH_ENABLED =
  LOCAL_PROJECTS_DIR_OVERRIDE === undefined &&
  LOCAL_SESSIONS_DIR_OVERRIDE === undefined;

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

export async function resolveClaudeDirs(
  executor: Executor,
  log?: Logger,
): Promise<{ sessionsDir: string; projectsDir: string } | null> {
  if (LOCAL_SESSIONS_DIR_OVERRIDE && LOCAL_PROJECTS_DIR_OVERRIDE) {
    return {
      sessionsDir: LOCAL_SESSIONS_DIR_OVERRIDE,
      projectsDir: LOCAL_PROJECTS_DIR_OVERRIDE,
    };
  }
  try {
    const result = await executor.exec("printenv", ["HOME"], {
      timeoutMs: 5_000,
    });
    if (result.exitCode !== 0) return null;
    const home = result.stdout.trim();
    if (!home) return null;
    return {
      sessionsDir: `${home}/${SESSIONS_REL}`,
      projectsDir: `${home}/${PROJECTS_REL}`,
    };
  } catch (err) {
    log?.debug({ err }, "claude dir resolution failed");
    return null;
  }
}

// --- Session file reading ---

export interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  sessionsDir: string;
  projectsDir: string;
}

/**
 * Read a Claude session file by pid. Returns null if the file doesn't
 * exist (the common case — most pids are not claude-code sessions) or
 * if the file is unreadable / malformed / missing required fields.
 */
export async function readSessionFile(
  pid: number,
  executor: Executor,
  log?: Logger,
): Promise<SessionFile | null> {
  const dirs = await resolveClaudeDirs(executor, log);
  if (!dirs) return null;
  let raw: string;
  try {
    raw = (
      await executor.readFile(`${dirs.sessionsDir}/${pid}.json`, {
        maxBytes: 64 * 1024,
      })
    ).content;
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
    return {
      pid: parsed.pid,
      sessionId: parsed.sessionId,
      cwd: parsed.cwd,
      sessionsDir: dirs.sessionsDir,
      projectsDir: dirs.projectsDir,
    };
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
export async function findTranscriptPath(
  session: SessionFile,
  executor: Executor,
): Promise<string | null> {
  const projectDir = `${session.projectsDir}/${encodeProjectPath(session.cwd)}`;
  const exactPath = `${projectDir}/${session.sessionId}.jsonl`;
  try {
    await executor.statMtimeMs(exactPath);
    return exactPath;
  } catch {
    return null;
  }
}

// --- JSONL reading ---

/**
 * Read the last N bytes of a JSONL transcript and split into lines
 * (oldest first). Delegates bounded file IO to `kolu-io` so local and
 * remote-host executors share one tail/range implementation.
 */
export async function tailJsonlLines(
  filePath: string,
  bytes: number,
  executor: Executor,
  log?: Logger,
): Promise<string[]> {
  return executorReadTailLines(executor, filePath, bytes, log);
}

export async function fileSizeBytes(
  filePath: string,
  executor: Executor,
  log?: Logger,
): Promise<number | null> {
  return executorStatSizeBytes(executor, filePath, log);
}

export async function readFileChunk(
  filePath: string,
  offset: number,
  bytes: number,
  executor: Executor,
  log?: Logger,
): Promise<string | null> {
  return executorReadRange(executor, filePath, offset, bytes, log);
}

// --- State derivation ---

/** Anthropic usage subset from `message.usage` on assistant entries — the
 *  three input-side counters we sum for the running context-token total.
 *  Matches the shape emitted by the Claude Code transcript JSONL. */
type UsageShape = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

/** Minimal assistant `message.content[]` block shape — only the two
 *  fields state derivation reads. The transcript layer carries the full
 *  union (text, thinking, tool_use, etc.); live state derivation just
 *  needs to ask "is this a `tool_use` block and which tool". */
type ContentBlock = { type?: string; name?: string };

/** Claude tool names whose pending invocation means the agent is
 *  awaiting the human. Policy lives in `classifyByAwaiting`. */
const AWAITING_USER_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

function toolUseOrAwaitingUser(
  content: ContentBlock[] | undefined,
): "tool_use" | "awaiting_user" {
  if (!Array.isArray(content)) return "tool_use";
  let total = 0;
  let awaiting = 0;
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    total++;
    if (block.name && AWAITING_USER_TOOLS.has(block.name)) awaiting++;
  }
  return classifyByAwaiting(awaiting, total);
}

/** Derive Claude Code state from the last relevant JSONL message.
 *
 *  Walks backwards once, tracking two independent signals with different
 *  stopping conditions:
 *   - state + model: first `assistant` OR `user` entry (the newest event)
 *   - contextTokens: first `assistant` entry carrying `message.usage` (the
 *     most recent accounting snapshot)
 *
 *  They diverge during Thinking — the newest line is a `user` prompt, so
 *  state is thinking, but the meaningful token total lives one hop back on
 *  the previous assistant reply. Blanking it there (as an earlier version
 *  did) masked a valid running count every time the user typed. */
export function deriveState(lines: string[]): {
  state: ClaudeCodeInfo["state"];
  model: string | null;
  contextTokens: number | null;
} | null {
  let stateAndModel: {
    state: ClaudeCodeInfo["state"];
    model: string | null;
  } | null = null;
  let contextTokens: number | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw === undefined) continue;
    try {
      const entry: {
        type?: string;
        message?: {
          stop_reason?: string | null;
          model?: string | null;
          usage?: UsageShape;
          content?: ContentBlock[];
        };
      } = JSON.parse(raw);

      if (contextTokens === null) {
        const tokens = sumUsageTokens(entry.message?.usage);
        if (tokens !== null) contextTokens = tokens;
      }

      if (stateAndModel === null) {
        const model = entry.message?.model ?? null;
        stateAndModel = match({
          type: entry.type,
          stopReason: entry.message?.stop_reason ?? null,
        })
          .with({ type: "assistant", stopReason: "end_turn" }, () => ({
            state: "waiting" as const,
            model,
          }))
          .with({ type: "assistant", stopReason: "tool_use" }, () => ({
            state: toolUseOrAwaitingUser(entry.message?.content),
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
      }

      if (stateAndModel !== null && contextTokens !== null) break;
    } catch {
      // Skip malformed lines
    }
  }

  if (stateAndModel === null) return null;
  return { ...stateAndModel, contextTokens };
}

/** Sum the three input-side token counters that together represent what
 *  the model had to read for the turn. Returns null when the usage object
 *  is absent OR when none of the three input-side fields are present —
 *  the latter covers synthetic replay entries (e.g. from `claude -c`) that
 *  carry an empty or output-only `usage` block. Rendering null hides the
 *  badge; rendering 0 would flash "0K" during session restore before the
 *  first real API reply lands.
 *
 *  Distinct from "all three fields present and zero" — a theoretical case
 *  that doesn't occur in practice (real API calls always have `input_tokens
 *  ≥ 1`), but if it did, the raw 0 would still render correctly. */
function sumUsageTokens(usage: UsageShape | undefined): number | null {
  if (!usage) return null;
  if (
    usage.input_tokens === undefined &&
    usage.cache_creation_input_tokens === undefined &&
    usage.cache_read_input_tokens === undefined
  ) {
    return null;
  }
  return (
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

// --- Task extraction ---

/**
 * Scan JSONL lines for TaskCreate/TaskUpdate tool calls and accumulate into
 * the provided task map. Returns true if the map changed.
 */
export function extractTasks(
  lines: string[],
  tasks: Map<string, "pending" | "in_progress" | "completed">,
  plog: { error: (obj: Record<string, unknown>, msg: string) => void },
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
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (block.type !== "tool_use" || block.name !== "TaskUpdate") continue;
      const input = block.input;
      if (!input || typeof input !== "object") {
        plog.error(
          { block },
          "TaskUpdate tool call has unexpected input shape",
        );
        continue;
      }
      const taskId = input.taskId;
      const status = input.status;
      if (typeof taskId !== "string" || typeof status !== "string") {
        plog.error({ input }, "TaskUpdate tool call missing taskId or status");
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

/**
 * Subscribe to changes in `SESSIONS_DIR`. Returns an unsubscribe
 * handle. The caller owns any process-wide sharing.
 */
export async function subscribeSessionsDir(
  executor: Executor,
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): Promise<{ stop(): void }> {
  const dirs = await resolveClaudeDirs(executor, log);
  if (!dirs) return { stop: () => {} };
  try {
    return await executor.watch(
      dirs.sessionsDir,
      () => {
        try {
          onChange();
        } catch (err) {
          onError(err);
        }
      },
      { recursive: false },
    );
  } catch (err) {
    log?.debug(
      { err, dir: dirs.sessionsDir },
      "claude sessions dir watch failed",
    );
    return { stop: () => {} };
  }
}

// --- Summary fetching ---

export interface ClaudeSummaryFetcher {
  fetchSessionSummary(sessionId: string, cwd: string): Promise<string | null>;
}

export function summaryFetcherForExecutor(
  executor: Executor,
): ClaudeSummaryFetcher | null {
  if (executor.kind !== "local" || !SUMMARY_FETCH_ENABLED) return null;
  return { fetchSessionSummary };
}

/** Fetch the display summary from the local Claude Agent SDK. Returns null on failure. */
export async function fetchSessionSummary(
  sessionId: string,
  cwd: string,
): Promise<string | null> {
  if (!SUMMARY_FETCH_ENABLED) return null;
  const info = await getSessionInfo(sessionId, { dir: cwd });
  return info?.summary ?? null;
}
