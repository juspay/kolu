import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { classifyByAwaiting } from "anyagent";
import { Effect, Result, Schema, SchemaGetter } from "effect";
import { meterSyncChild, stampedCache } from "kolu-io";
import { type Logger, readTailLines } from "kolu-shared";
import { parseIsoTimestamp } from "kolu-transcript-core";
import { match } from "ts-pattern";
import {
  type ClaudeCodeInfo,
  type ClaudeWorkflow,
  ClaudeWorkflowSchema,
  type TaskProgress,
} from "./schemas.ts";

export const CLAUDE_SESSIONS_DIR_ENV = "KOLU_CLAUDE_SESSIONS_DIR";
export const CLAUDE_PROJECTS_DIR_ENV = "KOLU_CLAUDE_PROJECTS_DIR";
export const CLAUDE_ENV_KEYS = [
  CLAUDE_SESSIONS_DIR_ENV,
  CLAUDE_PROJECTS_DIR_ENV,
] as const;

export const SESSIONS_DIR =
  process.env[CLAUDE_SESSIONS_DIR_ENV] ??
  path.join(os.homedir(), ".claude", "sessions");
export const PROJECTS_DIR =
  process.env[CLAUDE_PROJECTS_DIR_ENV] ??
  path.join(os.homedir(), ".claude", "projects");

export const SUMMARY_FETCH_ENABLED =
  process.env[CLAUDE_PROJECTS_DIR_ENV] === undefined &&
  process.env[CLAUDE_SESSIONS_DIR_ENV] === undefined;

export const TAIL_BYTES = 256 * 1024;

export interface SessionFile {
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt?: number;
}

export function watcherIdentityKey(session: SessionFile): string {
  const identity: { [K in keyof Required<SessionFile>]: string } = {
    pid: String(session.pid),
    sessionId: session.sessionId,
    cwd: session.cwd,
    startedAt: session.startedAt === undefined ? "" : String(session.startedAt),
  };
  return `${identity.sessionId}:${identity.pid}:${identity.cwd}:${identity.startedAt}`;
}

const SESSION_FILE_CACHE_MAX = 512;

const sessionFiles = stampedCache<SessionFile | null | "unreadable">(
  SESSION_FILE_CACHE_MAX,
);

export function readSessionFile(
  pid: number,
  log?: { debug: (obj: Record<string, unknown>, msg: string) => void },
): SessionFile | null | "unreadable" {
  const file = path.join(SESSIONS_DIR, `${pid}.json`);
  return sessionFiles.read(file, (stat) => {
    if (stat === undefined) return null;
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log?.debug({ err, pid }, "claude session file unreadable");
        return "unreadable";
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
        startedAt:
          typeof parsed.startedAt === "number" ? parsed.startedAt : undefined,
      };
    } catch (err) {
      log?.debug({ err, pid }, "claude session file parse failed");
      return "unreadable";
    }
  });
}

export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

export function transcriptPathFor(session: SessionFile): string {
  const projectDir = path.join(PROJECTS_DIR, encodeProjectPath(session.cwd));
  return path.join(projectDir, `${session.sessionId}.jsonl`);
}

export function tailJsonlLines(filePath: string, bytes: number): string[] {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return [];
  }
  return readTailLines({ path: filePath, size, maxBytes: bytes }) ?? [];
}

const HEAD_BYTES = 16_384;

export function firstTranscriptTimestampMs(filePath: string): number | null {
  let size: number;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    return null;
  }

  const head = readTailLines({
    path: filePath,
    size: Math.min(size, HEAD_BYTES),
    maxBytes: HEAD_BYTES,
  });
  if (!head) return null;
  for (const raw of head) {
    let ts: string | undefined;
    try {
      ts = (JSON.parse(raw) as { timestamp?: string }).timestamp;
    } catch {
      continue;
    }
    if (typeof ts !== "string") continue;
    const ms = parseIsoTimestamp(ts);
    if (ms !== null) return ms;
  }
  return null;
}

function parseJsonLine<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { text: string } =>
        !!b &&
        typeof b === "object" &&
        typeof (b as { text?: unknown }).text === "string",
    )
    .map((b) => b.text)
    .join("");
}

function toolResultBlock(
  block: unknown,
): { text: string; isError: boolean } | null {
  if (!block || typeof block !== "object") return null;
  const b = block as { type?: string; is_error?: boolean; content?: unknown };
  if (b.type !== "tool_result") return null;
  return { text: toolResultText(b.content), isError: b.is_error === true };
}

type UsageShape = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type ContentBlock = { type?: string; name?: string };

const AWAITING_USER_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"]);

export const INTERRUPT_TEXT_PREFIX = "[Request interrupted by user";
export const INTERRUPT_TOOL_RESULT_PREFIX =
  "The user doesn't want to proceed with this tool use";

function isInterruptMarker(content: unknown): boolean {
  if (typeof content === "string")
    return content.startsWith(INTERRUPT_TEXT_PREFIX);
  if (!Array.isArray(content)) return false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: unknown };
    if (
      b.type === "text" &&
      typeof b.text === "string" &&
      b.text.startsWith(INTERRUPT_TEXT_PREFIX)
    ) {
      return true;
    }
    const tr = toolResultBlock(block);
    if (tr?.isError && tr.text.startsWith(INTERRUPT_TOOL_RESULT_PREFIX)) {
      return true;
    }
  }
  return false;
}

const LOCAL_COMMAND_MARKERS = [
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-stdout>",
  "<local-command-caveat>",
] as const;

function isLocalCommandArtifact(content: unknown): boolean {
  const text = toolResultText(content).trimStart();
  return LOCAL_COMMAND_MARKERS.some((m) => text.startsWith(m));
}

function isNonPromptUserEntry(entry: {
  type?: string;
  isCompactSummary?: boolean;
  message?: { content?: unknown };
}): boolean {
  if (entry.type !== "user") return false;
  return (
    entry.isCompactSummary === true ||
    isLocalCommandArtifact(entry.message?.content)
  );
}

function toolUseOrAwaitingUser(content: unknown): "tool_use" | "awaiting_user" {
  if (!Array.isArray(content)) return "tool_use";
  let total = 0;
  let awaiting = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as ContentBlock;
    if (b.type !== "tool_use") continue;
    total++;
    if (b.name && AWAITING_USER_TOOLS.has(b.name)) awaiting++;
  }
  return classifyByAwaiting(awaiting, total);
}

interface TranscriptEntry {
  type?: string;
  timestamp?: string;
  isCompactSummary?: boolean;
  message?: {
    stop_reason?: string | null;
    model?: string | null;
    usage?: UsageShape;
    content?: unknown;
  };
}

function stateFromEntry(
  entry: TranscriptEntry,
): ClaudeCodeInfo["state"] | null {
  return match({
    type: entry.type,
    stopReason: entry.message?.stop_reason ?? null,
  })
    .with(
      { type: "assistant", stopReason: "end_turn" },
      () => "waiting" as const,
    )
    .with({ type: "assistant", stopReason: "tool_use" }, () =>
      toolUseOrAwaitingUser(entry.message?.content),
    )
    .with({ type: "assistant" }, () => "thinking" as const)
    .with({ type: "user" }, () =>
      isInterruptMarker(entry.message?.content)
        ? ("waiting" as const)
        : ("thinking" as const),
    )
    .otherwise(() => null);
}

function promoteBusyWaiting(
  state: ClaudeCodeInfo["state"],
  outstanding: () => BackgroundTask[],
): ClaudeCodeInfo["state"] {
  if (state !== "waiting") return state;
  return outstanding().some(isWorkflowTask) ? "running_background" : state;
}

export function deriveState(
  lines: string[],
  outstanding?: BackgroundTask[],
): {
  state: ClaudeCodeInfo["state"];
  model: string | null;
  contextTokens: number | null;
  timestampMs: number | null;
} | null {
  let state: ClaudeCodeInfo["state"] | null = null;
  let model: string | null = null;
  let timestampMs: number | null = null;
  let contextTokens: number | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw === undefined) continue;
    const entry = parseJsonLine<TranscriptEntry>(raw);
    if (entry === null) continue;

    if (contextTokens === null) {
      const tokens = sumUsageTokens(entry.message?.usage);
      if (tokens !== null) contextTokens = tokens;
    }

    if (model === null && entry.type === "assistant") {
      const m = entry.message?.model;
      if (typeof m === "string") model = m;
    }

    if (isNonPromptUserEntry(entry)) continue;

    if (state === null) {
      state = stateFromEntry(entry);
      if (state !== null) timestampMs = parseIsoTimestamp(entry.timestamp);
    }

    if (state !== null && model !== null && contextTokens !== null) break;
  }

  if (state === null) return null;

  return {
    state: promoteBusyWaiting(
      state,
      () => outstanding ?? outstandingBackgroundTasks(lines),
    ),
    model,
    contextTokens,
    timestampMs,
  };
}

export interface WorkflowTask {
  taskId: string;
  runId: string;
}

export interface DetachedTask {
  taskId: string;
  runId: null;
}

export type BackgroundTask = WorkflowTask | DetachedTask;

export function isWorkflowTask(task: BackgroundTask): task is WorkflowTask {
  return task.runId !== null;
}

const BG_LAUNCH_RES = [
  /launched in background\. Task ID: ([\w-]+)/,
  /Command running in background with ID: ([\w-]+)/,
  /Async agent launched successfully\.\s*agentId: ([\w-]+)/,
];

const BG_RUN_ID_RE = /Run ID: ([\w-]+)/;

const TERMINAL_STATUSES = ["completed", "failed", "stopped", "killed"] as const;

const TASK_ID_TAG_RE = /<task-id>([^<]+)<\/task-id>/;
const TERMINAL_STATUS_RE = new RegExp(
  `<status>(?:${TERMINAL_STATUSES.join("|")})</status>`,
);

export function completedBackgroundTaskIds(lines: string[]): Set<string> {
  const completed = new Set<string>();
  for (const raw of lines) {
    const entry = parseJsonLine<{
      type?: string;
      operation?: string;
      content?: unknown;
    }>(raw);
    if (entry === null) continue;
    if (entry.type !== "queue-operation" || entry.operation !== "enqueue")
      continue;
    const content = typeof entry.content === "string" ? entry.content : "";
    const id = TASK_ID_TAG_RE.exec(content)?.[1];
    if (id && TERMINAL_STATUS_RE.test(content)) completed.add(id);
  }
  return completed;
}

export function outstandingBackgroundTasks(
  lines: string[],
  completed: Set<string> = completedBackgroundTaskIds(lines),
): BackgroundTask[] {
  const launched = new Map<string, string | null>();

  for (const raw of lines) {
    const entry = parseJsonLine<{
      type?: string;
      message?: { content?: Array<{ type?: string; content?: unknown }> };
    }>(raw);
    if (entry === null) continue;

    if (entry.type !== "user") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const tr = toolResultBlock(block);
      if (!tr) continue;
      let taskId: string | undefined;
      for (const re of BG_LAUNCH_RES) {
        taskId = re.exec(tr.text)?.[1];
        if (taskId) break;
      }
      if (!taskId) continue;
      launched.set(taskId, BG_RUN_ID_RE.exec(tr.text)?.[1] ?? null);
    }
  }

  const out: BackgroundTask[] = [];
  for (const [taskId, runId] of launched) {
    if (completed.has(taskId)) continue;
    out.push(runId === null ? { taskId, runId: null } : { taskId, runId });
  }
  return out;
}

function sessionRootFor(session: SessionFile): string {
  return path.join(
    PROJECTS_DIR,
    encodeProjectPath(session.cwd),
    session.sessionId,
  );
}

export function workflowsDirFor(session: SessionFile): string {
  return path.join(sessionRootFor(session), "workflows");
}

export function subagentsDirFor(session: SessionFile): string {
  return path.join(sessionRootFor(session), "subagents");
}

export const WorkflowJournalSchema = Schema.Struct({
  workflowName: Schema.String,
  status: Schema.String.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("running")),
  ),
  agentCount: Schema.Number.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(0)),
  ),
}).pipe(
  Schema.decodeTo(ClaudeWorkflowSchema, {
    decode: SchemaGetter.transform((j) => ({
      name: j.workflowName,
      status: j.status,
      agents: j.agentCount,
    })),
    encode: SchemaGetter.transform((w) => ({
      workflowName: w.name,
      status: w.status,
      agentCount: w.agents,
    })),
  }),
);

const TERMINAL_JOURNAL_STATUSES = new Set<string>(TERMINAL_STATUSES);

export const WORKFLOW_JOURNAL_STALE_MS = 2 * 60 * 1000;

function newestEntryWriteMs(dir: string): number | null {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let newest: number | null = null;
  for (const name of names) {
    try {
      const m = fs.statSync(path.join(dir, name)).mtimeMs;
      if (newest === null || m > newest) newest = m;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return newest;
}

function liveWorkflowsRootFor(session: SessionFile): string {
  return path.join(subagentsDirFor(session), "workflows");
}

function liveWorkflowRunDir(session: SessionFile, runId: string): string {
  return path.join(liveWorkflowsRootFor(session), runId);
}

function liveWorkflowName(session: SessionFile, runId: string): string | null {
  const scriptsDir = path.join(workflowsDirFor(session), "scripts");
  let names: string[];
  try {
    names = fs.readdirSync(scriptsDir);
  } catch {
    return null;
  }
  const suffix = `-${runId}.js`;
  for (const name of names) {
    if (name.endsWith(suffix) && name.length > suffix.length) {
      return name.slice(0, -suffix.length);
    }
  }
  return null;
}

function liveAgentCount(runDir: string): number | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(runDir, "journal.jsonl"), "utf8");
  } catch {
    return null;
  }
  const ids = new Set<string>();
  let anonymous = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const e = parseJsonLine<{ type?: string; agentId?: unknown }>(line);
    if (e === null || e.type !== "started") continue;
    if (typeof e.agentId === "string") ids.add(e.agentId);
    else anonymous++;
  }
  return ids.size + anonymous;
}

type WorkflowObservation =
  | { kind: "terminal"; workflow: ClaudeWorkflow | null }
  | { kind: "live"; workflow: ClaudeWorkflow | null; anchorMs: number }
  | { kind: "unobservable"; workflow: ClaudeWorkflow | null };

function readWorkflowSnapshot(snapPath: string): WorkflowObservation | null {
  let mtimeMs: number;
  let raw: string;
  try {
    const fd = fs.openSync(snapPath, "r");
    try {
      mtimeMs = fs.fstatSync(fd).mtimeMs;
      raw = fs.readFileSync(fd, "utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return null;
  }
  const json = parseJsonLine<unknown>(raw);
  if (json === null) return { kind: "live", workflow: null, anchorMs: mtimeMs };
  const status =
    typeof json === "object" && json !== null && "status" in json
      ? json.status
      : undefined;
  const parsed = Schema.decodeUnknownResult(WorkflowJournalSchema)(json);
  const workflow = Result.isSuccess(parsed) ? parsed.success : null;
  if (typeof status === "string" && TERMINAL_JOURNAL_STATUSES.has(status)) {
    return { kind: "terminal", workflow };
  }
  return { kind: "live", workflow, anchorMs: mtimeMs };
}

function observeWorkflowRun(
  session: SessionFile,
  runId: string,
): WorkflowObservation {
  const snapshot = readWorkflowSnapshot(
    path.join(workflowsDirFor(session), `${runId}.json`),
  );
  if (snapshot !== null) return snapshot;

  const runDir = liveWorkflowRunDir(session, runId);
  const anchorMs = newestEntryWriteMs(runDir);
  const agents = liveAgentCount(runDir);
  const workflow =
    agents === null
      ? null
      : {
          name: liveWorkflowName(session, runId) ?? "workflow",
          status: "running",
          agents,
        };
  return anchorMs === null
    ? { kind: "unobservable", workflow }
    : { kind: "live", workflow, anchorMs };
}

export interface LiveRun {
  id: string;
  anchorMs: number;
  staleMs: number;
}

export function nextStaleDeadline(
  runs: LiveRun[],
  now: number = Date.now(),
): number | null {
  let earliest: number | null = null;
  for (const r of runs) {
    const deadline = Math.max(r.anchorMs + r.staleMs, now);
    if (earliest === null || deadline < earliest) earliest = deadline;
  }
  return earliest;
}

export interface WorkflowView {
  liveTasks: (outstanding: BackgroundTask[]) => BackgroundTask[];
  runs: (tasks: BackgroundTask[]) => LiveRun[];
  progress: (tasks: BackgroundTask[]) => ClaudeWorkflow | null;
}

export function workflowView(
  session: SessionFile,
  now: number = Date.now(),
): WorkflowView {
  const seen = new Map<string, WorkflowObservation>();
  const observe = (runId: string): WorkflowObservation => {
    let o = seen.get(runId);
    if (o === undefined) {
      o = observeWorkflowRun(session, runId);
      seen.set(runId, o);
    }
    return o;
  };

  return {
    liveTasks: (outstanding) =>
      outstanding.filter((task) => {
        if (!isWorkflowTask(task)) return true;
        const obs = observe(task.runId);
        return (
          obs.kind === "live" && now - obs.anchorMs <= WORKFLOW_JOURNAL_STALE_MS
        );
      }),

    runs: (tasks) => {
      const live: LiveRun[] = [];
      for (const task of tasks) {
        if (!isWorkflowTask(task)) continue;
        const obs = observe(task.runId);
        if (obs.kind !== "live") continue;
        live.push({
          id: task.runId,
          anchorMs: obs.anchorMs,
          staleMs: WORKFLOW_JOURNAL_STALE_MS,
        });
      }
      return live;
    },

    progress: (tasks) => {
      let fallback: ClaudeWorkflow | null = null;
      for (const task of tasks) {
        if (!isWorkflowTask(task)) continue;
        const { workflow } = observe(task.runId);
        if (!workflow) continue;
        if (workflow.status === "running") return workflow;
        fallback ??= workflow;
      }
      return fallback;
    },
  };
}

const FORK_AGENT_TYPE = "fork";

const FORK_META_RE = /^agent-(.+)\.meta\.json$/;

export const FORK_TRANSCRIPT_STALE_MS = 2 * 60 * 1000;

function isForkMeta(metaPath: string): boolean {
  try {
    const json = JSON.parse(fs.readFileSync(metaPath, "utf8")) as {
      agentType?: unknown;
    };
    return json.agentType === FORK_AGENT_TYPE;
  } catch {
    return false;
  }
}

export function outstandingForkRuns(
  session: SessionFile,
  completed: Set<string>,
  now: number = Date.now(),
): LiveRun[] {
  const dir = subagentsDirFor(session);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const forks: LiveRun[] = [];
  for (const name of names) {
    const id = FORK_META_RE.exec(name)?.[1];
    if (id === undefined) continue;
    if (completed.has(id)) continue;
    let anchorMs: number;
    try {
      anchorMs = fs.statSync(path.join(dir, `agent-${id}.jsonl`)).mtimeMs;
    } catch {
      continue;
    }
    if (now - anchorMs > FORK_TRANSCRIPT_STALE_MS) continue;
    if (!isForkMeta(path.join(dir, name))) continue;
    forks.push({ id, anchorMs, staleMs: FORK_TRANSCRIPT_STALE_MS });
  }
  return forks;
}

export const TRANSIENT_STALE_MS = 2 * 60 * 1000;

export interface ProcEntry {
  pid: number;
  ppid: number;
}

export function snapshotProcessTreeSync(): ProcEntry[] | null {
  let out: string;
  try {
    const argv = ["ps", "-A", "-o", "pid=,ppid="];
    out = meterSyncChild(argv, () =>
      execFileSync("ps", argv.slice(1), {
        encoding: "utf8",
        timeout: 2_000,
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  } catch {
    return null;
  }
  const procs: ProcEntry[] = [];
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
    if (m) procs.push({ pid: Number(m[1]), ppid: Number(m[2]) });
  }
  return procs;
}

export function hasNoDescendants(pid: number, procs: ProcEntry[]): boolean {
  return !procs.some((p) => p.ppid === pid);
}

export function isClaudeSubtreeIdle(pid: number): boolean {
  const procs = snapshotProcessTreeSync();
  if (procs === null) return false;
  return hasNoDescendants(pid, procs);
}

export interface TransientDecay {
  state: ClaudeCodeInfo["state"];
  recheckAt: number | null;
}

export function decayDanglingToolUse(
  quietMs: number,
  subtreeIdle: () => boolean,
  staleMs: number = TRANSIENT_STALE_MS,
  now: number = Date.now(),
): TransientDecay {
  if (quietMs < staleMs) {
    return { state: "tool_use", recheckAt: now + (staleMs - quietMs) };
  }
  if (subtreeIdle()) return { state: "waiting", recheckAt: null };
  return { state: "tool_use", recheckAt: now + staleMs };
}

export function decayOrphanedThinking(
  quietMs: number,
  staleMs: number = TRANSIENT_STALE_MS,
  now: number = Date.now(),
): TransientDecay {
  if (quietMs < staleMs) {
    return { state: "thinking", recheckAt: now + (staleMs - quietMs) };
  }
  return { state: "waiting", recheckAt: null };
}

export type TrailingTransient =
  | { kind: "dangling_tool_use"; subtreeIdle: () => boolean }
  | { kind: "orphaned_thinking" }
  | { kind: "settled"; state: ClaudeCodeInfo["state"] };

export function trailingTransient(
  state: ClaudeCodeInfo["state"],
  promptMs: number | null,
  session: SessionFile,
): TrailingTransient {
  if (state === "tool_use") {
    return {
      kind: "dangling_tool_use",
      subtreeIdle: () => isClaudeSubtreeIdle(session.pid),
    };
  }
  const { startedAt } = session;
  if (
    state === "thinking" &&
    startedAt !== undefined &&
    promptMs !== null &&
    promptMs < startedAt
  ) {
    return { kind: "orphaned_thinking" };
  }
  return { kind: "settled", state };
}

export function decayTrailingTransient(
  trailing: TrailingTransient,
  quietMs: number,
  staleMs: number = TRANSIENT_STALE_MS,
  now: number = Date.now(),
): TransientDecay {
  switch (trailing.kind) {
    case "dangling_tool_use":
      return decayDanglingToolUse(quietMs, trailing.subtreeIdle, staleMs, now);
    case "orphaned_thinking":
      return decayOrphanedThinking(quietMs, staleMs, now);
    case "settled":
      return { state: trailing.state, recheckAt: null };
  }
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

export function watchOrWaitForDir(
  dir: string,
  onChange: () => void,
  log?: Logger,
): () => void {
  const direct = tryWatchDir(dir, onChange, log);
  if (direct) return direct;

  let child: (() => void) | null = null;
  let ancestorWatcher: (() => void) | null = null;
  const parent = path.dirname(dir);
  if (parent !== dir) {
    const onParentChange = () => {
      if (child) return;
      const attached = tryWatchDir(dir, onChange, log);
      if (!attached) return;
      child = attached;
      ancestorWatcher?.();
      ancestorWatcher = null;
      log?.info({ dir, parent }, "claude-code: ancestor-dir watcher retired");
      onChange();
    };
    ancestorWatcher = watchOrWaitForDir(parent, onParentChange, log);
  }
  return () => {
    ancestorWatcher?.();
    ancestorWatcher = null;
    child?.();
  };
}

interface SessionsDirListener {
  cb: () => void;
  onError: (err: unknown) => void;
}

let sharedSessionsDir: {
  cleanup: () => void;
  listeners: Set<SessionsDirListener>;
} | null = null;

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

export async function fetchSessionSummary(
  sessionId: string,
  cwd: string,
): Promise<string | null> {
  if (!SUMMARY_FETCH_ENABLED) return null;
  const info = await getSessionInfo(sessionId, { dir: cwd });
  return info?.summary ?? null;
}
