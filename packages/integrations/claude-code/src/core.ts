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
import type { AgentSnippet } from "anyagent";
import { type Logger, readTailLines } from "kolu-shared";
import { parseIsoTimestamp } from "kolu-transcript-core";
import { match } from "ts-pattern";
import type { ClaudeCodeInfo, TaskProgress } from "./schemas.ts";

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

// --- Peek snippet derivation ---

/** Max characters retained for a snippet preview. Workspace-switcher
 *  cards clamp to ~2 lines visually; the wire cap is generous enough
 *  to give a hover tooltip more text without flooding the metadata
 *  channel with multi-KB strings on every transcript tick. */
const SNIPPET_MAX_LEN = 200;

/** Derive the most-recent assistant utterance or tool call from a tail
 *  window of JSONL lines. Walks backward to the latest `assistant` entry,
 *  then picks the last text or tool_use block within it — that's "what
 *  the agent is doing right now" when state is `tool_use`, or "what it
 *  last said" when state is `waiting`. Returns null when the window
 *  contains no assistant content (early in a session, or all content is
 *  empty `thinking` blocks). */
export function deriveLatestSnippet(lines: string[]): AgentSnippet | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw === undefined) continue;
    let entry: {
      type?: string;
      timestamp?: string;
      message?: {
        content?: Array<{
          type?: string;
          text?: string;
          name?: string;
          input?: unknown;
        }>;
      };
    };
    try {
      entry = JSON.parse(raw);
    } catch {
      continue;
    }
    if (entry.type !== "assistant") continue;
    const content = entry.message?.content;
    if (!Array.isArray(content) || content.length === 0) continue;

    // `timestamp` is best-effort — synthetic/replay entries occasionally
    // omit it. Default to 0 instead of skipping the snippet entirely so
    // the peek surface still renders; the ts field is informational
    // ("when did this land") and never participates in equality or sort.
    const ts = parseIsoTimestamp(entry.timestamp) ?? 0;
    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j];
      if (!block) continue;
      if (
        block.type === "text" &&
        typeof block.text === "string" &&
        block.text.trim().length > 0
      ) {
        return { kind: "assistant", text: snippetFromText(block.text), ts };
      }
      if (block.type === "tool_use" && typeof block.name === "string") {
        return {
          kind: "tool_use",
          text: snippetFromToolUse(block.name, block.input),
          ts,
        };
      }
    }
  }
  return null;
}

/** Trim a multi-paragraph assistant reply to a single short preview.
 *  Keeps the first paragraph (assistant prose is paragraph-structured)
 *  and caps overall length so streaming-token updates don't pump giant
 *  strings through the wire on every keystroke. */
function snippetFromText(text: string): string {
  const trimmed = text.trim();
  const firstPara = trimmed.split(/\n\s*\n/, 1)[0] ?? trimmed;
  // Collapse single newlines inside the first paragraph to spaces — the
  // workspace card clamps to 2 lines visually, so the snippet flows as
  // one continuous prose blurb rather than carrying mid-paragraph breaks.
  const flowed = firstPara.replace(/\s+/g, " ").trim();
  return flowed.length > SNIPPET_MAX_LEN
    ? `${flowed.slice(0, SNIPPET_MAX_LEN - 1)}…`
    : flowed;
}

/** Render a tool_use block as a compact "Tool(arg)" summary. Picks the
 *  most identifying field from the typed input — `file_path` for file
 *  ops, `command` for Bash, `pattern` for Grep — and falls back to just
 *  the tool name when none of those are present. Inputs are arbitrary
 *  objects from the model so the typing is loose; defensive narrowing
 *  is intentional. */
function snippetFromToolUse(name: string, input: unknown): string {
  if (input !== null && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (typeof o.file_path === "string" && o.file_path.length > 0) {
      return `${name}(${path.basename(o.file_path)})`;
    }
    if (typeof o.command === "string" && o.command.length > 0) {
      const head = o.command.split(/\s+/, 1)[0] ?? "";
      return head.length > 0 ? `${name}: ${head}` : name;
    }
    if (typeof o.pattern === "string" && o.pattern.length > 0) {
      return `${name}(${o.pattern})`;
    }
    if (typeof o.url === "string" && o.url.length > 0) {
      return `${name}(${o.url})`;
    }
    if (typeof o.description === "string" && o.description.length > 0) {
      const head =
        o.description.length > 60
          ? `${o.description.slice(0, 59)}…`
          : o.description;
      return `${name}: ${head}`;
    }
  }
  return name;
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
