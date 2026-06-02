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

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import { classifyByAwaiting } from "anyagent";
import { type Logger, readTailLines } from "kolu-shared";
import { parseIsoTimestamp } from "kolu-transcript-core";
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
  /** Epoch-ms the claude process started (or resumed via `claude -c`), from the
   *  session file's `startedAt`. A `claude -c` resume writes a *new* session
   *  file with a fresh `startedAt`, so a transcript prompt whose timestamp
   *  predates this value belongs to a previous, killed instance — the current
   *  claude never processed it. Used to tell a resumed-idle phantom from a live
   *  turn (see `decayTransientState`). Optional: absent on older session files. */
  startedAt?: number;
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
    return {
      pid: parsed.pid,
      sessionId: parsed.sessionId,
      cwd: parsed.cwd,
      startedAt:
        typeof parsed.startedAt === "number" ? parsed.startedAt : undefined,
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

// --- Wire-shape helpers (shared) ---
//
// Primitives that read the raw JSONL `message.content` block shapes. Shared by
// both state derivation (interrupt detection) and background-task scanning, so
// they live above both rather than next to whichever caller happened to land
// first.

/** Flatten a `tool_result` block's `content` (a string, or an array of
 *  `{type:"text", text}` blocks) to a single string for marker matching. */
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

/** If `block` is a `tool_result`, return its flattened text and error flag;
 *  otherwise null. Both interrupt detection (errored markers) and
 *  background-task scanning (launch confirmations) classify user-entry
 *  `tool_result` blocks by their text, so the "is it a tool_result, what's its
 *  text" mechanic lives here once. Each caller keeps its own policy on top. */
function toolResultBlock(
  block: unknown,
): { text: string; isError: boolean } | null {
  if (!block || typeof block !== "object") return null;
  const b = block as { type?: string; is_error?: boolean; content?: unknown };
  if (b.type !== "tool_result") return null;
  return { text: toolResultText(b.content), isError: b.is_error === true };
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
export const INTERRUPT_TEXT_PREFIX = "[Request interrupted by user";
export const INTERRUPT_TOOL_RESULT_PREFIX =
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

/** Markers Claude Code writes into a `user` entry's `content` for slash-command
 *  bookkeeping — the command invocation, its message/args, the captured stdout,
 *  and the "messages generated while running local commands" caveat. These are
 *  transcript-only artifacts, not a human prompt: a no-op local command
 *  (`/compact`, `/config`, `/status`, …) leaves them as the *trailing* `user`
 *  entries while the agent sits idle, and `/compact` in particular emits the
 *  `<command-name>` + `<local-command-stdout>` pair *after* its summary, so one
 *  of these — not the summary — is the newest entry. The generic `user` branch
 *  would read that as `thinking` and pin the pill working forever (the
 *  stuck-pill-after-`/compact` bug). A real prompt never begins with one of
 *  these tags. */
const LOCAL_COMMAND_MARKERS = [
  "<command-name>",
  "<command-message>",
  "<command-args>",
  "<local-command-stdout>",
  "<local-command-caveat>",
] as const;

/** True when a `user` entry's `message.content` is slash-command bookkeeping
 *  (see `LOCAL_COMMAND_MARKERS`) rather than a human prompt. `content` is a
 *  plain string or an array of blocks; both flatten to text (via
 *  `toolResultText`) and are prefix-matched. */
function isLocalCommandArtifact(content: unknown): boolean {
  const text = toolResultText(content).trimStart();
  return LOCAL_COMMAND_MARKERS.some((m) => text.startsWith(m));
}

/** True when a trailing `user` entry is a transcript-only artifact that the
 *  human did not type — the `/compact` summary (`isCompactSummary`) or
 *  slash-command bookkeeping/output (`isLocalCommandArtifact`). `deriveState`
 *  walks past these so state derives from the genuine prior turn (an idle
 *  `end_turn` → `waiting`) instead of reading the artifact as a fresh prompt.
 *  A turn that actually resumes work lands a newer `assistant` entry, which is
 *  seen first.
 *
 *  Deliberately NOT keyed on `isMeta`: that flag marks *injected* model input,
 *  which is overwhelmingly a live prompt the agent is about to act on — a
 *  slash-command/skill expansion ("Base directory for this skill: …"), an
 *  auto-continue ("Continue from where you left off."), hook feedback, a
 *  pasted image. Skipping those would read the prior `end_turn` as `waiting`
 *  while Claude is working (e.g. the brief window after `/do` or
 *  `/whatchanged` invokes the model but before its first assistant entry
 *  lands). The one `isMeta` artifact that genuinely trails — the `/compact`
 *  `<local-command-caveat>` — is already caught by `isLocalCommandArtifact`. */
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
 *  running — there it is busy-waiting, not awaiting the human. When the
 *  outstanding set holds a task with an observable run journal (a `Workflow`'s
 *  `runId`), that `waiting` is promoted to `running_background`; a bare
 *  backgrounded `Bash`/`Agent` (runId null) is not enough, since its launch
 *  marker outlives the process. Pass the precomputed set via `outstanding` to
 *  avoid re-scanning (and so the watcher can pre-drop orphaned-journal
 *  workflows); omitted, it is computed from `lines`. */
export function deriveState(
  lines: string[],
  outstanding?: BackgroundTask[],
): {
  state: ClaudeCodeInfo["state"];
  model: string | null;
  contextTokens: number | null;
  /** Epoch-ms timestamp of the entry the state was derived from (the newest
   *  `user`/`assistant` entry), or null when it lacks a parseable `timestamp`.
   *  Used to age a trailing `thinking` prompt against the session's `startedAt`
   *  (the resumed-vs-live discriminator — see the #1017 module note). */
  timestampMs: number | null;
} | null {
  let stateAndModel: {
    state: ClaudeCodeInfo["state"];
    model: string | null;
  } | null = null;
  let timestampMs: number | null = null;
  let contextTokens: number | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw === undefined) continue;
    try {
      const entry: {
        type?: string;
        timestamp?: string;
        isCompactSummary?: boolean;
        message?: {
          stop_reason?: string | null;
          model?: string | null;
          usage?: UsageShape;
          // Raw wire data: a string (interrupt text) or a block array. Each
          // consumer (`toolUseOrAwaitingUser`, `isInterruptMarker`) narrows
          // to the projection it reads rather than trusting one shared shape.
          content?: unknown;
        };
      } = JSON.parse(raw);

      if (contextTokens === null) {
        const tokens = sumUsageTokens(entry.message?.usage);
        if (tokens !== null) contextTokens = tokens;
      }

      // Walk past transcript-only `user` entries the human never typed — the
      // `/compact` summary and slash-command bookkeeping/output (the
      // `<command-name>` + `<local-command-stdout>` pair a `/compact` appends
      // *after* its summary, leaving one of them as the newest entry). A no-op
      // local command (`/compact`, `/config`, …) leaves these at the tail while
      // the agent is idle; reading them as a fresh prompt would pin the pill in
      // `thinking` forever (the stuck-pill bug). Skipping derives state from the
      // genuine prior turn (`end_turn` → `waiting`); a turn that resumes work
      // lands a newer assistant entry, seen first. (An `isMeta` injection is
      // left alone — it is usually a live model prompt; see
      // `isNonPromptUserEntry`.)
      if (isNonPromptUserEntry(entry)) continue;

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
        // Capture the timestamp of the very entry the state derives from — the
        // newest `user`/`assistant` — so the orphaned-prompt age check reads the
        // same entry, not a parallel walk (null if absent/unparseable).
        if (stateAndModel !== null) {
          timestampMs = parseIsoTimestamp(entry.timestamp);
        }
      }

      if (stateAndModel !== null && contextTokens !== null) break;
    } catch {
      // Skip malformed lines
    }
  }

  if (stateAndModel === null) return null;

  // Promote a bare `end_turn` (`waiting`) to `running_background` only when the
  // agent is busy-waiting on a task kolu can actually observe: a `Workflow` run
  // (it carries a `runId` and an on-disk journal). A bare backgrounded
  // `Bash`/`Agent` (runId null) leaves only a launch marker that is permanent
  // in the transcript — its completion notification can be lost forever to a
  // restart, so promoting on it spins the pill indefinitely (the phantom
  // `running_background` bug). The watcher additionally drops a `Workflow`
  // once kolu can no longer observe it as live — journal read as terminal, or
  // its liveness anchor aged past the stale window (`liveOutstandingTasks`) —
  // so an orphaned or unobservable run stops promoting too. Only the `waiting`
  // case is promoted — an
  // in-flight `thinking`/`tool_use` already reads as working, and an
  // `awaiting_user` prompt is a genuine human gate.
  let state = stateAndModel.state;
  if (state === "waiting") {
    const bg = outstanding ?? outstandingBackgroundTasks(lines);
    if (bg.some((t) => t.runId !== null)) state = "running_background";
  }

  return { state, model: stateAndModel.model, contextTokens, timestampMs };
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
/** The lifecycle statuses that mean a run has finished — `completed`/`failed`/
 *  `stopped`, or `killed` (cancelled). Single source of truth: the same domain
 *  fact ("which statuses mean done") is read from two distinct on-disk formats,
 *  so each derives its own matcher from this one ordered list — the transcript
 *  notification's `<status>` XML (`TERMINAL_STATUS_RE`) and the workflow
 *  journal's `status` JSON field (`TERMINAL_JOURNAL_STATUSES`). They can't drift. */
const TERMINAL_STATUSES = ["completed", "failed", "stopped", "killed"] as const;

/** Completion notification fields inside a `queue-operation` enqueue. */
const TASK_ID_TAG_RE = /<task-id>([^<]+)<\/task-id>/;
const TERMINAL_STATUS_RE = new RegExp(
  `<status>(?:${TERMINAL_STATUSES.join("|")})</status>`,
);

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
    if (!completed.has(taskId)) out.push({ taskId, runId });
  }
  return out;
}

// --- Workflow journal (dynamic-workflow fan-out progress) ---

/** The on-disk session root: `<projects>/<cwd>/<session>`. The single anchor for
 *  the per-session layout — both the workflow-journal dir and the live workflow
 *  root derive from here, so a session-root layout move changes one place. */
function sessionRootFor(session: SessionFile): string {
  return path.join(
    PROJECTS_DIR,
    encodeProjectPath(session.cwd),
    session.sessionId,
  );
}

/** Per-session workflow-journal directory: `<projects>/<cwd>/<session>/workflows`.
 *  Sibling of the transcript JSONL, which lives at `<projects>/<cwd>/<session>.jsonl`. */
export function workflowsDirFor(session: SessionFile): string {
  return path.join(sessionRootFor(session), "workflows");
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

/** The journal-side matcher for `TERMINAL_STATUSES` — a Set for O(1) membership
 *  on the workflow snapshot's `status` field, derived from the same source as
 *  `TERMINAL_STATUS_RE` so the two formats can't drift. "running" (the journal's
 *  default) is the only non-terminal status. */
const TERMINAL_JOURNAL_STATUSES = new Set<string>(TERMINAL_STATUSES);

/** How long a `Workflow` run may go without any on-disk write before it is
 *  treated as orphaned. A genuinely-running workflow streams its sub-agent
 *  transcripts (`agent-*.jsonl`) continuously, so a multi-minute gap reliably
 *  means the launching agent died (e.g. a Claude restart) and its completion
 *  notification can never arrive (#1109 phantom guard). A false positive
 *  self-heals — the next write re-derives. 2 min is the safe upper end. */
export const WORKFLOW_JOURNAL_STALE_MS = 2 * 60 * 1000;

/** Newest file mtime (epoch ms) directly inside `dir`, or null when `dir` can't
 *  be read / is empty. Unlike the directory's own mtime (which on Linux only
 *  bumps on create/delete inside it, not on appends to existing files), this
 *  tracks the sub-agent transcripts (`agent-*.jsonl`) as they stream while a
 *  workflow's agents work — so it stays fresh throughout a live run. */
function newestFileMtimeMs(dir: string): number | null {
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
    } catch {
      // entry vanished between readdir and stat — skip
    }
  }
  return newest;
}

/** The live workflow root under the current runtime layout:
 *  `<session>/subagents/workflows/`. Created lazily on the first `Workflow`
 *  launch; holds one `<runId>/` sub-dir per live run (see `liveWorkflowRunDir`).
 *  The session-watcher watches this tree so live-run writes (`journal.jsonl` /
 *  streaming `agent-*.jsonl` appends) re-derive progress (#1123). */
function liveWorkflowsRootFor(session: SessionFile): string {
  return path.join(sessionRootFor(session), "subagents", "workflows");
}

/** The live event-log directory for a `Workflow` run under the current runtime
 *  layout: `<session>/subagents/workflows/<runId>/`. Holds `journal.jsonl`
 *  (per-sub-agent `started`/`result` events) plus one streaming `agent-*.jsonl`
 *  per sub-agent. This is where progress lives DURING a run; the
 *  `<session>/workflows/<runId>.json` snapshot is only written at completion
 *  (#1123 — the runtime layout churned and the snapshot path went write-on-end). */
function liveWorkflowRunDir(session: SessionFile, runId: string): string {
  return path.join(liveWorkflowsRootFor(session), runId);
}

/** The real workflow name of a live run, resolved from its persisted script
 *  `<session>/workflows/scripts/<name>-<runId>.js` (the verified runtime layout
 *  carries `meta.name` there, and the `<name>-<runId>.js` filename mirrors it).
 *  During a live run only the completion snapshot carries the name as JSON, so
 *  the script filename — written at launch — is the one on-disk source of the
 *  user-visible workflow identity before completion. Returns null when no script
 *  matching this `runId` exists (then callers keep a neutral fallback). */
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

/** Number of sub-agents spawned so far in a live run — distinct `started`
 *  agentIds in `journal.jsonl`. Null when the journal can't be read. Counting
 *  distinct ids (not raw `started` rows) guards against a replayed/re-emitted
 *  `started` for the same sub-agent overstating the fan-out badge; a `started`
 *  row lacking an agentId still counts once. */
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
    try {
      const e = JSON.parse(line) as { type?: string; agentId?: unknown };
      if (e.type !== "started") continue;
      if (typeof e.agentId === "string") ids.add(e.agentId);
      else anonymous++;
    } catch {
      // skip a malformed line (transient mid-append)
    }
  }
  return ids.size + anonymous;
}

/** One observation of a `Workflow` run across BOTH on-disk layouts, so every
 *  consumer projects from a single source of truth (#1123):
 *   - the completed snapshot `<session>/workflows/<runId>.json` — authoritative
 *     end-state (name, terminal status, agentCount), written only at completion;
 *   - the live run dir `<session>/subagents/workflows/<runId>/` — progress during
 *     the run (agentCount from `journal.jsonl`, liveness from the newest
 *     streaming file mtime).
 *
 *  `anchorMs` is the most recent on-disk write attributable to the run — the
 *  staleness clock. For a live run it tracks the sub-agent transcripts as they
 *  stream, so a genuinely-running workflow never ages out; once the orchestrator
 *  dies (no more writes) it goes stale and the gate demotes (the #1109 phantom
 *  guard). `terminal` is true only on a positively-read terminal snapshot. */
export interface WorkflowObservation {
  workflow: ClaudeWorkflow | null;
  anchorMs: number | null;
  terminal: boolean;
}

/** Lookup that yields the observation for a run, shared across the three
 *  projections so one running_background check pass observes each run once.
 *  Defaults to a live `observeWorkflowRun(session, runId)` when callers (e.g.
 *  standalone unit tests) don't pre-compute a Map. */
export type ObserveWorkflowRun = (runId: string) => WorkflowObservation;

export function observeWorkflowRun(
  session: SessionFile,
  runId: string,
): WorkflowObservation {
  // 1) Completed snapshot — authoritative end-state when present.
  const snapPath = path.join(workflowsDirFor(session), `${runId}.json`);
  try {
    const mtimeMs = fs.statSync(snapPath).mtimeMs;
    const raw = fs.readFileSync(snapPath, "utf8");
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      // Snapshot mid-write: keep it alive on its mtime, no parsed workflow yet.
      return { workflow: null, anchorMs: mtimeMs, terminal: false };
    }
    const status = (json as { status?: unknown }).status;
    const terminal =
      typeof status === "string" && TERMINAL_JOURNAL_STATUSES.has(status);
    const parsed = WorkflowJournalSchema.safeParse(json);
    return {
      workflow: parsed.success ? parsed.data : null,
      anchorMs: mtimeMs,
      terminal,
    };
  } catch {
    // no snapshot yet — fall through to the live layout
  }

  // 2) Live run dir — progress while the workflow is running.
  const runDir = liveWorkflowRunDir(session, runId);
  const anchorMs = newestFileMtimeMs(runDir);
  const agents = liveAgentCount(runDir);
  if (agents !== null) {
    // The completion snapshot carries the name as JSON only at the end; during
    // the run the persisted script filename is the on-disk source of the
    // user-visible workflow identity. Fall back to a neutral label only when no
    // script for this runId is found.
    const name = liveWorkflowName(session, runId) ?? "workflow";
    return {
      workflow: { name, status: "running", agents },
      anchorMs,
      terminal: false,
    };
  }

  // 3) Unobservable — neither layout readable. `anchorMs` (a bare run-dir mtime,
  // if any) still lets the staleness gate age it out rather than spin forever.
  return { workflow: null, anchorMs, terminal: false };
}

/** Read fan-out progress for outstanding background workflows. Only `Workflow`
 *  launches have a `runId`; plain background `Task`/`Agent` launches are skipped.
 *  Returns the first run still `running` (falling back to the first observable
 *  one), or null when no outstanding task is an observable workflow. */
export function deriveWorkflowProgress(
  session: SessionFile,
  outstanding: BackgroundTask[],
  observe: ObserveWorkflowRun = (runId) => observeWorkflowRun(session, runId),
): ClaudeWorkflow | null {
  let fallback: ClaudeWorkflow | null = null;
  for (const task of outstanding) {
    if (!task.runId) continue;
    const { workflow } = observe(task.runId);
    if (!workflow) continue;
    if (workflow.status === "running") return workflow;
    fallback ??= workflow;
  }
  return fallback;
}

/** Filter `outstanding` to the tasks that may drive the `running_background`
 *  promotion, dropping a `Workflow` run once kolu can no longer observe it as
 *  live: its snapshot is *positively* read as terminal, or its liveness anchor
 *  has aged past `WORKFLOW_JOURNAL_STALE_MS` (the orphaned-by-restart signature).
 *  Non-`Workflow` tasks (runId null) pass through unchanged — `deriveState`'s own
 *  narrowing already declines to promote on them.
 *
 *  The anchor is the newest write across the run's live dir
 *  (`subagents/workflows/<runId>/`) or its completion snapshot — see
 *  `observeWorkflowRun`. A streaming workflow keeps that anchor fresh and stays
 *  promoted; an orphaned/dead one stops writing and ages out. `now` is injectable
 *  for tests; the IO only runs when the tail carries an outstanding task. */
export function liveOutstandingTasks(
  session: SessionFile,
  outstanding: BackgroundTask[],
  now: number = Date.now(),
  observe: ObserveWorkflowRun = (runId) => observeWorkflowRun(session, runId),
): BackgroundTask[] {
  return outstanding.filter((task) => {
    if (!task.runId) return true; // not a workflow — deriveState's narrowing decides
    const obs = observe(task.runId);
    if (obs.terminal) return false; // positively finished → drop
    if (obs.anchorMs === null) return false; // unobservable → demote (phantom guard)
    return now - obs.anchorMs <= WORKFLOW_JOURNAL_STALE_MS; // live iff recently written
  });
}

/** Earliest wall-clock time at which one of `tasks`' workflow runs would cross
 *  the stale threshold, or null if none has an observable liveness anchor.
 *
 *  A quiet run emits no fs event, so the watcher arms a one-shot timer here; when
 *  it fires, the next `liveOutstandingTasks` sees the anchor as stale and demotes
 *  (or, for a still-streaming run, sees it fresh and re-arms). Uses the same
 *  `observeWorkflowRun` anchor as the gate so the two never disagree. */
export function nextWorkflowStaleDeadline(
  session: SessionFile,
  tasks: BackgroundTask[],
  now: number = Date.now(),
  observe: ObserveWorkflowRun = (runId) => observeWorkflowRun(session, runId),
): number | null {
  let earliest: number | null = null;
  for (const task of tasks) {
    if (!task.runId) continue;
    const { anchorMs } = observe(task.runId);
    if (anchorMs === null) continue; // no observable anchor → gate already demoted it
    const deadline = Math.max(anchorMs + WORKFLOW_JOURNAL_STALE_MS, now);
    if (earliest === null || deadline < earliest) earliest = deadline;
  }
  return earliest;
}

// --- Phantom transient de-escalation (#1017) ---
//
// A trailing transient state keeps `deriveState` reporting a *working* state
// indefinitely once the session is abandoned (most reliably: claude killed
// mid-turn, then resumed idle by session-restore) — the dock then spins a
// "running" pill forever. Two trailing shapes hit it, each disambiguated by a
// different out-of-band signal once the transcript has gone quiet past a window:
//
//   - dangling `tool_use` (an assistant tool call with no following
//     `tool_result`): a *live* tool keeps a descendant process (a Bash child, a
//     sub-agent claude), an abandoned one has none — so "subtree idle (no
//     descendant)" tells them apart.
//
//   - `thinking` (the newest entry is a `user` prompt): childless and quiet
//     whether the turn is live (awaiting the model's first token) or abandoned,
//     so the subtree probe alone can't tell them apart. The discriminator is
//     the prompt's age relative to the claude process: a `claude -c` resume
//     writes a fresh `startedAt`, so a prompt that *predates* `startedAt`
//     belongs to a killed instance the current (resumed-idle) claude never
//     processed. A live turn's prompt always postdates `startedAt`, so it is
//     never cleared. The subtree is NOT consulted for `thinking`: a
//     resumed-idle claude often holds a long-lived helper child (a persistent
//     MCP server such as `chrome-devtools-mcp`), so requiring an idle subtree
//     would wrongly keep the phantom spinning forever — `orphaned` + stale is
//     already definitive.
//
// Sibling of the `running_background` decay (#1109), which handles the
// `end_turn`-promotion half on its own workflow-journal signal; the states are
// disjoint, so the paths never overlap.

/** How long the transcript may sit unwritten before a dangling `tool_use`
 *  becomes eligible to decay to `waiting`. A live tool writes the transcript as
 *  it streams tool calls and replies, so a multi-minute gap with an idle
 *  subtree means the tool was abandoned. Mirrors `WORKFLOW_JOURNAL_STALE_MS`
 *  (2 min) — the same "quiet long enough to be sure" threshold as the sibling
 *  decay. A false positive self-heals: the next transcript write fires the
 *  watcher and re-derives the true state. */
export const TRANSIENT_STALE_MS = 2 * 60 * 1000;

/** One process-table row: a pid and its parent pid. */
export interface ProcEntry {
  pid: number;
  ppid: number;
}

/** Snapshot every live process's pid→ppid in a single `ps` call. The invocation
 *  (`ps -A -o pid=,ppid=`) is portable across Linux procps and macOS/BSD ps.
 *  Returns null when ps is unavailable or errors — callers treat null as "can't
 *  tell" and must NOT de-escalate, so a probe failure never clears a genuinely
 *  working pill. Synchronous: it runs only on the (rare) stale-transient
 *  recheck, never the hot transcript-event path, so the brief event-loop block
 *  is acceptable and keeps the watcher's control flow non-async. */
export function snapshotProcessTree(): ProcEntry[] | null {
  let out: string;
  try {
    out = execFileSync("ps", ["-A", "-o", "pid=,ppid="], {
      encoding: "utf8",
      timeout: 2_000,
      maxBuffer: 16 * 1024 * 1024,
    });
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

/** True when no process in `procs` is a descendant of `pid`. A descendant set
 *  is non-empty iff `pid` has at least one direct child, so only direct
 *  parentage need be tested. The #1017 discriminator: a genuinely-working
 *  claude keeps at least one descendant (the Bash child it spawned, or a
 *  sub-agent claude); an abandoned / killed-then-resumed-idle claude has none
 *  (and a dead pid trivially has none). Pure — `procs` is injected. */
export function hasNoDescendants(pid: number, procs: ProcEntry[]): boolean {
  return !procs.some((p) => p.ppid === pid);
}

/** Whether claude's process subtree shows no live work — detected as the
 *  absence of any descendant process (see `hasNoDescendants`). Returns false
 *  ("assume working") when the process table can't be sampled, so a probe
 *  failure never clears a genuinely-working pill.
 *
 *  CPU is deliberately not consulted: `ps` reports a lifetime/decaying CPU
 *  average, not an instantaneous one, so it is not a reliable "busy right now"
 *  signal portably, while the descendant test is the clean discriminator the
 *  issue verified across live sessions. The only case it misses — claude itself
 *  CPU-bound in-process with no child and a quiet transcript — is vanishingly
 *  rare (claude's tools spawn children or do IO) and self-heals on the next
 *  transcript write. */
export function isClaudeSubtreeIdle(pid: number): boolean {
  const procs = snapshotProcessTree();
  if (procs === null) return false;
  return hasNoDescendants(pid, procs);
}

/** Decide the state to publish for a trailing transient (`tool_use` /
 *  `thinking`), and when (if ever) to re-probe. Pure policy: the caller supplies
 *  how long the transcript has been quiet, a subtree-idle probe (invoked only
 *  once the quiet window has elapsed so the real `ps` spawn stays off the common
 *  path), and — for `thinking` — whether the trailing prompt is orphaned (it
 *  predates the current claude's `startedAt`, see the module note).
 *
 *   - not a decayable transient → unchanged, no recheck.
 *   - `thinking` whose prompt is NOT orphaned → unchanged, no recheck: this is a
 *     live turn (the prompt postdates the running claude), never cleared.
 *   - not yet stale → unchanged; arm a recheck at the moment it would go stale
 *     (a quiet transcript fires no fs event, so the watcher needs a timer).
 *   - stale + subtree idle → decay to `waiting` (the phantom is settled).
 *   - stale + subtree busy → genuine work; keep it and re-probe after another
 *     window (the work may yet end silently with no further write).
 */
export function decayTransientState(
  state: ClaudeCodeInfo["state"],
  quietMs: number,
  probes: { subtreeIdle: () => boolean; promptOrphaned: boolean },
  staleMs: number = TRANSIENT_STALE_MS,
  now: number = Date.now(),
): { state: ClaudeCodeInfo["state"]; recheckAt: number | null } {
  if (state !== "tool_use" && state !== "thinking") {
    return { state, recheckAt: null };
  }
  // A `thinking` turn is childless and quiet whether live or abandoned; only an
  // orphaned prompt (predating this resumed claude) proves abandonment.
  if (state === "thinking" && !probes.promptOrphaned) {
    return { state, recheckAt: null };
  }
  if (quietMs < staleMs) {
    return { state, recheckAt: now + (staleMs - quietMs) };
  }
  // Past the window, confirm abandonment with the signal appropriate to the
  // state. For `thinking`, `promptOrphaned` is already definitive — the prompt
  // predates this resumed claude, which `claude -c` never auto-continues — so
  // it settles directly. The subtree is deliberately NOT consulted here: a
  // resumed-idle claude often holds a long-lived helper child (e.g. a
  // persistent MCP server like `chrome-devtools-mcp`), so requiring an idle
  // subtree would wrongly keep the phantom spinning forever (observed on a live
  // session). For `tool_use` the subtree IS the discriminator — a live tool
  // keeps a child — so a busy subtree means real work; re-probe after another
  // window in case it ends silently.
  if (state === "thinking") {
    return { state: "waiting", recheckAt: null };
  }
  if (probes.subtreeIdle()) {
    return { state: "waiting", recheckAt: null };
  }
  return { state, recheckAt: now + staleMs };
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
