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

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { classifyByAwaiting } from "anyagent";
import { type Logger, readTailLines } from "kolu-shared";
import { match } from "ts-pattern";
import { z } from "zod";
import type {
  ClaudeCodeInfo,
  ClaudeWorkflow,
  TaskProgress,
} from "./schemas.ts";

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
 * Read the last N bytes of a JSONL transcript and split into lines
 * (oldest first). Delegates to anyagent's shared `readTailLines` for
 * the actual open/read — that helper closes the FD in a `try/finally`
 * (fixing the pre-extraction leak this function had on `readSync`
 * throw) and can surface hard errors via an `onError` callback.
 *
 * This caller opts into the legacy "silent on any failure" shape by
 * ignoring `onError` and flattening `null` (read failed) or an
 * absent file to `[]` — the transcript tailer treats all three modes
 * the same way (retry on the next `fs.watch` fire).
 */
export function tailJsonlLines(filePath: string, bytes: number): string[] {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return [];
  }
  return readTailLines({ path: filePath, size, maxBytes: bytes }) ?? [];
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

/** Markers Claude Code writes as the trailing `user` entry when a turn is
 *  interrupted with Esc. The agent is idle awaiting the next prompt, so this
 *  entry must read as `waiting`, not `thinking` (which the generic `user`
 *  branch would otherwise pick — see #1018). Two confirmed shapes:
 *   - mid-turn:      a text block `"[Request interrupted by user]"`
 *   - mid-tool-call: an errored `tool_result` ("The user doesn't want to
 *     proceed…") followed by `"[Request interrupted by user for tool use]"`
 *  Both interrupt-text variants share the `INTERRUPT_TEXT_PREFIX`; matching the
 *  prefix covers both without enumerating the suffix. A real prompt the user
 *  types after the marker is a distinct newer `user` entry that matches
 *  neither marker, so it still reads as `thinking`. */
const INTERRUPT_TEXT_PREFIX = "[Request interrupted by user";
const INTERRUPT_TOOL_RESULT_PREFIX =
  "The user doesn't want to proceed with this tool use";

/** True when a `user` entry's `message.content` is an Esc-interrupt marker.
 *  `content` is either a plain string (mid-turn text) or an array of blocks
 *  (text and/or errored `tool_result`); both forms are checked. */
function isInterruptMarker(content: unknown): boolean {
  if (typeof content === "string")
    return content.startsWith(INTERRUPT_TEXT_PREFIX);
  if (!Array.isArray(content)) return false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: unknown; is_error?: boolean };
    if (
      b.type === "text" &&
      typeof b.text === "string" &&
      b.text.startsWith(INTERRUPT_TEXT_PREFIX)
    ) {
      return true;
    }
    if (
      b.type === "tool_result" &&
      b.is_error === true &&
      toolResultText((block as { content?: unknown }).content).startsWith(
        INTERRUPT_TOOL_RESULT_PREFIX,
      )
    ) {
      return true;
    }
  }
  return false;
}

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
 *  did) masked a valid running count every time the user typed.
 *
 *  A newest `assistant` `end_turn` normally means `waiting` (the agent
 *  yielded its turn back to the user). But under dynamic workflows the
 *  agent can yield its turn while a background task it launched is still
 *  running — there it is busy-waiting, not awaiting the human. When
 *  `outstandingBackgroundTasks` finds such a task, that `waiting` is
 *  promoted to `running_background`. Pass the precomputed set via
 *  `outstanding` to avoid re-scanning; omitted, it is computed from `lines`. */
export function deriveState(
  lines: string[],
  outstanding?: BackgroundTask[],
): {
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
            state: isInterruptMarker(entry.message?.content)
              ? ("waiting" as const)
              : ("thinking" as const),
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

  // Promote a bare `end_turn` (`waiting`) to `running_background` when the
  // agent is still busy-waiting on a background task it launched. Only the
  // `waiting` case is promoted — an in-flight `thinking`/`tool_use` already
  // reads as working, and an `awaiting_user` prompt is a genuine human gate.
  let state = stateAndModel.state;
  if (state === "waiting") {
    const bg = outstanding ?? outstandingBackgroundTasks(lines);
    if (bg.length > 0) state = "running_background";
  }

  return { state, model: stateAndModel.model, contextTokens };
}

// --- Background-task detection (dynamic workflows) ---

/** A background task launched from this session: its task ID (from the
 *  `tool_result` confirmation) and, for `Workflow` launches, the run ID used
 *  to locate the on-disk journal. `runId` is null for backgrounded `Bash`
 *  commands and `Task`/`Agent` runs, which have no workflow journal. */
export interface BackgroundTask {
  taskId: string;
  runId: string | null;
}

/** Tool-result confirmations that a background task was launched, each paired
 *  with the regex capturing its task ID. Three tools background work, each
 *  with its own phrasing, and the captured ID matches the `<task-id>` in the
 *  eventual completion notification:
 *   - `Workflow`:            "… launched in background. Task ID: <id>"
 *   - `Bash` (background):   "Command running in background with ID: <id>"
 *   - `Agent` (background):  "Async agent launched successfully. agentId: <id>"
 *  IDs are matched as `[\w-]+` so a templated/quoted marker in pasted code
 *  (e.g. "Task ID: ${x}") doesn't produce a phantom task, and so the trailing
 *  punctuation after a Bash ID ("…with ID: abc. Output…") isn't captured. */
const BG_LAUNCH_RES = [
  /launched in background\. Task ID: ([\w-]+)/,
  /Command running in background with ID: ([\w-]+)/,
  /Async agent launched successfully\.\s*agentId: ([\w-]+)/,
];
/** Workflow run ID in the same confirmation ("Run ID: <id>") — only the
 *  `Workflow` tool emits one; it locates the on-disk journal. */
const BG_RUN_ID_RE = /Run ID: ([\w-]+)/;
/** Completion notification fields inside a `queue-operation` enqueue. A task
 *  can finish `completed`/`failed`/`stopped`, or be `killed` (cancelled). */
const TASK_ID_TAG_RE = /<task-id>([^<]+)<\/task-id>/;
const TERMINAL_STATUS_RE =
  /<status>(?:completed|failed|stopped|killed)<\/status>/;

/** Flatten a `tool_result` block's `content` (a string, or an array of
 *  `{type:"text", text}` blocks) to a single string for marker matching. */
function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      out += (block as { text: string }).text;
    }
  }
  return out;
}

/** Scan the transcript tail for background tasks launched but not yet
 *  reporting a terminal status.
 *
 *  Launch markers live in `user` `tool_result` blocks — one of the three
 *  `BG_LAUNCH_RES` phrasings (Workflow / backgrounded Bash / backgrounded
 *  Agent). Completion markers live in `queue-operation` entries
 *  (`operation: "enqueue"`) whose `content` is a `<task-notification>`
 *  carrying `<task-id>X</task-id>` and a terminal `<status>`. The launch ID
 *  and the completion's `<task-id>` are the same token, so
 *  outstanding = launched − completed.
 *
 *  Bounded by the same tail window as `deriveState`: a launch whose
 *  confirmation has scrolled out of the tail can't be detected. That only
 *  costs a fallback to the pre-existing `waiting` classification — never a
 *  crash or a wrong-direction promotion. */
export function outstandingBackgroundTasks(lines: string[]): BackgroundTask[] {
  const launched = new Map<string, string | null>(); // taskId → runId
  const completed = new Set<string>();

  for (const raw of lines) {
    let entry: {
      type?: string;
      operation?: string;
      content?: unknown;
      message?: { content?: Array<{ type?: string; content?: unknown }> };
    };
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }

    if (entry.type === "queue-operation") {
      if (entry.operation !== "enqueue") continue;
      const content = typeof entry.content === "string" ? entry.content : "";
      const id = TASK_ID_TAG_RE.exec(content)?.[1];
      if (id && TERMINAL_STATUS_RE.test(content)) completed.add(id);
      continue;
    }

    if (entry.type !== "user") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || block.type !== "tool_result") continue;
      const text = toolResultText(block.content);
      let taskId: string | undefined;
      for (const re of BG_LAUNCH_RES) {
        taskId = re.exec(text)?.[1];
        if (taskId) break;
      }
      if (!taskId) continue;
      launched.set(taskId, BG_RUN_ID_RE.exec(text)?.[1] ?? null);
    }
  }

  const out: BackgroundTask[] = [];
  for (const [taskId, runId] of launched) {
    if (!completed.has(taskId)) out.push({ taskId, runId });
  }
  return out;
}

// --- Workflow journal (dynamic-workflow fan-out progress) ---

/** Per-session workflow-journal directory: `<projects>/<cwd>/<session>/workflows`.
 *  Sibling of the transcript JSONL, which lives at `<projects>/<cwd>/<session>.jsonl`. */
export function workflowsDirFor(session: SessionFile): string {
  return path.join(
    PROJECTS_DIR,
    encodeProjectPath(session.cwd),
    session.sessionId,
    "workflows",
  );
}

/** On-disk shape of a workflow run journal (`workflows/<runId>.json`) — just
 *  the fields we surface. The wire field names differ from the public
 *  `ClaudeWorkflow` (`workflowName`→`name`, `agentCount`→`agents`), so the
 *  `.transform` maps the wire shape to the domain type; `ClaudeWorkflow` stays
 *  the single workflow concept that crosses a module boundary. Unexported —
 *  the wire format is a private detail of this reader. Encapsulating it as one
 *  schema means a journal-format change fails the parse here (the journal is
 *  skipped) rather than silently defaulting in scattered guards. */
const WorkflowJournalSchema = z
  .object({
    workflowName: z.string(),
    status: z.string().default("running"),
    agentCount: z.number().default(0),
  })
  .transform(
    (j): ClaudeWorkflow => ({
      name: j.workflowName,
      status: j.status,
      agents: j.agentCount,
    }),
  );

/** Read fan-out progress for outstanding background workflows from their
 *  on-disk journals (`workflows/<runId>.json`). Only `Workflow` launches have
 *  a `runId`/journal; plain background `Task`/`Agent` launches are skipped.
 *  Returns the first journal still `running` (falling back to the first
 *  readable one), or null when no outstanding task is a workflow with a
 *  readable journal. */
export function deriveWorkflowProgress(
  session: SessionFile,
  outstanding: BackgroundTask[],
): ClaudeWorkflow | null {
  const wfDir = workflowsDirFor(session);
  let fallback: ClaudeWorkflow | null = null;
  for (const task of outstanding) {
    if (!task.runId) continue;
    const journalPath = path.join(wfDir, `${task.runId}.json`);
    let json: unknown;
    try {
      json = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    } catch {
      continue;
    }
    const parsed = WorkflowJournalSchema.safeParse(json);
    if (!parsed.success) continue;
    const info = parsed.data;
    if (info.status === "running") return info;
    fallback ??= info;
  }
  return fallback;
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
  log?: Logger,
): (() => void) | null {
  try {
    const w = fs.watch(dir, () => onChange());
    log?.info({ dir }, "claude-code: dir watcher installed");
    return () => {
      w.close();
      log?.info({ dir }, "claude-code: dir watcher retired");
    };
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
  log?: Logger,
): () => void {
  const direct = tryWatchDir(dir, onChange, log);
  if (direct) return direct;

  let child: (() => void) | null = null;
  let parentWatcher: fs.FSWatcher | null = null;
  const parent = path.dirname(dir);
  try {
    parentWatcher = fs.watch(parent, () => {
      if (child) return;
      const attached = tryWatchDir(dir, onChange, log);
      if (!attached) return;
      child = attached;
      parentWatcher?.close();
      parentWatcher = null;
      log?.info({ dir, parent }, "claude-code: parent-dir watcher retired");
      // Kick — dir may already contain files (race: created between our
      // first attempt and the parent event).
      onChange();
    });
    log?.info({ dir, parent }, "claude-code: parent-dir watcher installed");
  } catch (err) {
    log?.debug({ err, dir }, "fs.watch parent fallback failed");
  }
  return () => {
    if (parentWatcher) {
      parentWatcher.close();
      log?.info({ dir, parent }, "claude-code: parent-dir watcher retired");
    }
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
  log?: Logger,
): () => void {
  if (!sharedSessionsDir) {
    const listeners = new Set<SessionsDirListener>();
    const cleanup = watchOrWaitForDir(
      SESSIONS_DIR,
      () => {
        // Snapshot before iteration so a listener that subscribes or
        // unsubscribes synchronously can't skip a peer for this event.
        for (const l of [...listeners]) {
          try {
            l.cb();
          } catch (err) {
            l.onError(err);
          }
        }
      },
      log,
    );
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
