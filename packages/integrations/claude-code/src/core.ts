/**
 * Claude Code core — pure functions and executor-routed IO helpers for
 * detecting Claude Code sessions and deriving state from JSONL transcripts.
 *
 * Every IO operation flows through an `Executor` — the controller's local
 * fs (`localExecutor`) for local terminals, the SSH `Host` for remote ones.
 * Same code, two backends.
 *
 * Detection: reads `~/.claude/sessions/{pid}.json` via `executor.readFile`
 * to find sessions, then tails the JSONL transcript in
 * `~/.claude/projects/{encoded-cwd}/` via `executor.exec("tail", ...)` to
 * derive state (thinking, tool_use, waiting).
 */

import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { classifyByAwaiting, type Executor } from "anyagent";
import type { Logger } from "kolu-shared";
import { match } from "ts-pattern";
import type { ClaudeCodeInfo, TaskProgress } from "./schemas.ts";

// --- Configuration ---

/** Default `~/.claude/sessions/` rel-path. The controller's local
 *  `KOLU_CLAUDE_SESSIONS_DIR` env override (for tests) still wins. */
const SESSIONS_REL = ".claude/sessions";
const PROJECTS_REL = ".claude/projects";

/** Test-time override for local. Only applies on the controller's local
 *  fs — for a remote terminal these env vars are scoped to the local
 *  kolu process, so they don't affect what the helper reads. */
const LOCAL_SESSIONS_DIR_OVERRIDE = process.env.KOLU_CLAUDE_SESSIONS_DIR;
const LOCAL_PROJECTS_DIR_OVERRIDE = process.env.KOLU_CLAUDE_PROJECTS_DIR;

/** Back-compat re-export: code outside this module (notably
 *  `agent-provider.ts`'s `externalChanges.isPresent` for the controller's
 *  local case) reads this as the path to fs.existsSync. */
export const SESSIONS_DIR = LOCAL_SESSIONS_DIR_OVERRIDE
  ? LOCAL_SESSIONS_DIR_OVERRIDE
  : `${process.env.HOME ?? ""}/${SESSIONS_REL}`;

export const SUMMARY_FETCH_ENABLED =
  LOCAL_SESSIONS_DIR_OVERRIDE === undefined &&
  LOCAL_PROJECTS_DIR_OVERRIDE === undefined;

export const TAIL_BYTES = 256 * 1024;

/** Resolve the SESSIONS_DIR / PROJECTS_DIR pair on this executor's
 *  filesystem. Honors the env overrides only when the executor is the
 *  controller's localExecutor (signaled by `KOLU_CLAUDE_SESSIONS_DIR`
 *  being set — that env var is process-scoped, so remote helpers don't
 *  observe it). */
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
    const r = await executor.exec("printenv", ["HOME"], { timeoutMs: 5_000 });
    if (r.exitCode !== 0) return null;
    const home = r.stdout.trim();
    if (!home) return null;
    return {
      sessionsDir: `${home}/${SESSIONS_REL}`,
      projectsDir: `${home}/${PROJECTS_REL}`,
    };
  } catch (err) {
    log?.debug({ err }, "resolveClaudeDirs failed");
    return null;
  }
}

// --- Session file reading ---

export interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  /** Resolved sessions dir + projects dir on the executor's fs — stashed
   *  so downstream functions don't re-resolve. */
  sessionsDir: string;
  projectsDir: string;
}

/** Read a Claude session file by pid via the executor. Returns null if the
 *  file doesn't exist or is malformed. */
export async function readSessionFile(
  pid: number,
  executor: Executor,
  log?: Logger,
): Promise<SessionFile | null> {
  const dirs = await resolveClaudeDirs(executor, log);
  if (!dirs) return null;
  let raw: string;
  try {
    const r = await executor.readFile(`${dirs.sessionsDir}/${pid}.json`, {
      maxBytes: 64 * 1024,
    });
    raw = r.content;
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

export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

// --- Transcript path discovery ---

/** Find the JSONL transcript path for a session — exact match by id.
 *  Returns null if the file doesn't exist yet. */
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

// --- JSONL tail reader ---

/** Read the last N bytes of a JSONL transcript via the executor. Uses
 *  `tail -c <bytes>` which is portable across GNU + BSD coreutils and
 *  cheap on both local (execFile) and remote (helper exec). The first
 *  line is dropped because the byte cut likely sliced mid-line. */
export async function tailJsonlLines(
  filePath: string,
  bytes: number,
  executor: Executor,
  log?: Logger,
): Promise<string[]> {
  try {
    const r = await executor.exec("tail", ["-c", String(bytes), filePath], {
      timeoutMs: 10_000,
      maxBytes: bytes + 4096,
    });
    if (r.exitCode !== 0) {
      log?.debug({ stderr: r.stderr, filePath }, "claude tail failed");
      return [];
    }
    // `tail -c <bytes>` returns the LAST <bytes> of the file. If the file
    // is larger than the window the slice begins mid-line, so the first
    // line is a partial that won't parse — drop it. If the file fits
    // entirely, the slice begins at the file's first byte, which (for
    // valid JSONL) is `{` — keep it. Detecting "complete vs. partial"
    // from the first character is enough to stop the small-file case
    // from silently dropping its only line.
    const all = r.stdout.split("\n");
    const start = all[0]?.startsWith("{") ? 0 : 1;
    const out: string[] = [];
    for (let i = start; i < all.length; i++) {
      const l = all[i];
      if (l && l.length > 0) out.push(l);
    }
    return out;
  } catch (err) {
    log?.debug({ err, filePath }, "claude tail threw");
    return [];
  }
}

// --- State derivation (pure) ---

type UsageShape = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type ContentBlock = { type?: string; name?: string };

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

// --- Task extraction (pure) ---

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
    if (entry.type === "user" && entry.toolUseResult?.task?.id) {
      const id = entry.toolUseResult.task.id;
      if (typeof id === "string" && !tasks.has(id)) {
        tasks.set(id, "pending");
        changed = true;
      }
      continue;
    }
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

// --- Subscriptions ---

/** Subscribe to changes in the sessions dir for an executor. Used by
 *  `externalChanges.install` so we re-resolve when a new
 *  `~/.claude/sessions/{pid}.json` appears (or disappears). */
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

/** Local-only — uses the Claude Agent SDK against the controller's local
 *  ~/.claude. Remote sessions don't get summaries through this path; the
 *  watcher's title field is the fallback. */
export async function fetchSessionSummary(
  sessionId: string,
  cwd: string,
): Promise<string | null> {
  if (!SUMMARY_FETCH_ENABLED) return null;
  const info = await getSessionInfo(sessionId, { dir: cwd });
  return info?.summary ?? null;
}
