/**
 * Claude Code metadata provider — detects Claude Code sessions in a terminal.
 *
 * Detection: each terminal asks "what's my pty's foreground process?" via
 * tcgetpgrp(fd) (exposed by node-pty's foregroundPid accessor). If a session
 * file exists at ~/.claude/sessions/{fgpid}.json, that terminal is running
 * claude-code. Cross-platform — works on both Linux and macOS.
 *
 * Event-driven — no polling. Trigger sources:
 *   - title event (subscribeForTerminal("title", ...)) — fires on shell
 *     preexec/precmd OSC 2, which is when foregroundPid is likely to change
 *   - fs.watch(SESSIONS_DIR) — fires when session files appear/disappear,
 *     catching the race where title fires before claude writes its session file
 *   - fs.watch(projectDir) — fires when the JSONL transcript is created
 *     (claude writes it lazily on first message, not at session start)
 *   - fs.watch(transcriptPath) — fires on each message, drives state updates
 *
 * States derived from last JSONL message:
 * - thinking:  last message is "user" (API call in flight) or "assistant" with null stop_reason
 * - tool_use:  last assistant message has stop_reason "tool_use" (executing tools / permission prompt)
 * - waiting:   last assistant message has stop_reason "end_turn" (idle, awaiting user input)
 *
 * Limitations:
 * - Cannot distinguish "waiting for permission" from "executing tool" (both are tool_use)
 * - JSONL updates are not perfectly real-time — batched when API calls complete
 * - progress/streaming messages during thinking are not tracked (only final state)
 * - Wrapper processes (e.g. `script -q out.log claude`) are not detected: the
 *   foreground pid is the wrapper, not claude-code itself
 *
 * Known fanout: each terminal provider holds its own fs.watch on SESSIONS_DIR.
 * At typical terminal counts this is fine; a shared registry would be cleaner.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { match } from "ts-pattern";
import { getSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentInfo,
  ClaudeCodeInfo,
  ClaudeStateChange,
  ClaudeTranscriptDebug,
  TaskProgress,
} from "kolu-common";
import type { TerminalProcess } from "../terminals.ts";
import { updateMetadata } from "./index.ts";
import { subscribeForTerminal } from "../publisher.ts";
import { log } from "../log.ts";

/** Configurable via env for testing. */
const SESSIONS_DIR =
  process.env.KOLU_CLAUDE_SESSIONS_DIR ??
  path.join(os.homedir(), ".claude", "sessions");
const PROJECTS_DIR =
  process.env.KOLU_CLAUDE_PROJECTS_DIR ??
  path.join(os.homedir(), ".claude", "projects");
/** True when the e2e harness has redirected the projects/sessions dirs at
 *  test fixtures. The Claude Agent SDK has no equivalent override and would
 *  silently scan the user's real ~/.claude/projects, adding fs.watch and
 *  inotify pressure that has been observed to race with the mock harness
 *  on Linux. Skip summary fetching entirely under test. */
const SUMMARY_FETCH_ENABLED =
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
const TAIL_BYTES = 256 * 1024;

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
function readSessionFile(pid: number): SessionFile | null {
  let raw: string;
  try {
    raw = fs.readFileSync(path.join(SESSIONS_DIR, `${pid}.json`), "utf8");
  } catch (err) {
    // ENOENT is expected — most pids are not claude-code sessions.
    // Other errors (EACCES, EIO, etc.) are surfaced at debug level so
    // they're discoverable without spamming the log.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.debug({ err, pid }, "claude session file unreadable");
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
      log.debug({ pid, parsed }, "claude session file shape unexpected");
      return null;
    }
    return parsed as SessionFile;
  } catch (err) {
    log.debug({ err, pid }, "claude session file parse failed");
    return null;
  }
}

/** Encode a CWD path to the Claude projects directory key (replace / and . with -). */
export function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[/.]/g, "-");
}

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
    // Best-effort: a debug RPC handler can't usefully recover from fs
    // errors here (file deleted between watcher attach and dialog open,
    // EACCES, EIO). Surface at debug level for diagnosis without
    // failing the RPC — empty rawEvents is rendered honestly by the
    // dialog header ("0 events").
    log.debug({ err, filePath, offset }, "readJsonlFromOffset failed");
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

/**
 * Scan JSONL lines for TaskCreate/TaskUpdate tool calls and accumulate into
 * the provided task map. Returns true if the map changed.
 *
 * The transcript format is an internal Claude Code implementation detail.
 * Warnings are logged when tool call inputs have unexpected shapes so that
 * format drift is visible rather than silently ignored.
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

/** Compare two TaskProgress values for equality. */
function taskProgressEqual(
  a: TaskProgress | null,
  b: TaskProgress | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.total === b.total && a.completed === b.completed;
}

/** Compare two AgentInfo values for equality. */
export function infoEqual(a: AgentInfo | null, b: AgentInfo | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind !== b.kind) return false;
  if (a.state !== b.state || a.sessionId !== b.sessionId) return false;
  if (a.kind === "claude-code" && b.kind === "claude-code") {
    return (
      a.model === b.model &&
      a.summary === b.summary &&
      taskProgressEqual(a.taskProgress, b.taskProgress)
    );
  }
  return true;
}

/**
 * Try to watch a directory. Returns a cleanup function on success, null
 * if watch failed. ENOENT (directory doesn't exist yet) is expected and
 * silent; other errors (EACCES, EMFILE, etc.) surface at debug so they're
 * discoverable without spamming the log.
 */
function tryWatchDir(dir: string, onChange: () => void): (() => void) | null {
  try {
    const w = fs.watch(dir, () => onChange());
    return () => w.close();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.debug({ err, dir }, "fs.watch failed");
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
function watchOrWaitForDir(dir: string, onChange: () => void): () => void {
  const direct = tryWatchDir(dir, onChange);
  if (direct) return direct;

  let child: (() => void) | null = null;
  let parentWatcher: fs.FSWatcher | null = null;
  try {
    parentWatcher = fs.watch(path.dirname(dir), () => {
      if (child) return;
      const attached = tryWatchDir(dir, onChange);
      if (!attached) return;
      child = attached;
      parentWatcher?.close();
      parentWatcher = null;
      // Kick — dir may already contain files (race: created between our
      // first attempt and the parent event).
      onChange();
    });
  } catch (err) {
    // Parent also missing — give up. Logged so fresh-system diagnosis
    // is possible.
    log.debug({ err, dir }, "fs.watch parent fallback failed");
  }
  return () => {
    parentWatcher?.close();
    child?.();
  };
}

/**
 * Transcript-watching lifecycle as a sum type — mutually exclusive states,
 * checked exhaustively via ts-pattern on every transition.
 *
 * The `watching` variant carries the diagnostic state used by the Debug
 * transcript command: `startOffset` anchors "events since kolu attached"
 * for the on-demand disk read, and `stateChanges` is an in-memory log of
 * every transition the server believed happened. Both vanish naturally
 * when the watcher tears down — no separate cleanup path to forget.
 */
type TranscriptWatching =
  | { kind: "none" }
  | { kind: "waiting"; dirWatcher: () => void }
  | {
      kind: "watching";
      path: string;
      fileWatcher: fs.FSWatcher;
      /** File size at watcher-attach time. Always at a JSONL line boundary. */
      startOffset: number;
      /** epoch ms when the watcher attached — start of monitoring. */
      startedAt: number;
      /** Mutated in place; defensive-copied on read by the accessor. */
      stateChanges: ClaudeStateChange[];
    };

/**
 * Start the Claude Code metadata provider for a terminal entry.
 * Wakes on title events + SESSIONS_DIR changes + transcript file changes.
 */
export function startClaudeCodeProvider(
  entry: TerminalProcess,
  terminalId: string,
): () => void {
  const plog = log.child({ provider: "claude-code", terminal: terminalId });

  let matchedSession: SessionFile | null = null;
  let transcriptWatching: TranscriptWatching = { kind: "none" };
  /** Latest known display summary from the Claude Agent SDK. Refreshed
   *  best-effort on each transcript change; null between session matches
   *  and until the first lookup resolves. Survives across transcript
   *  events so deduped state updates can carry it forward. */
  let lastSummary: string | null = null;
  /** Accumulated task state from TaskCreate/TaskUpdate tool calls.
   *  Incrementally scanned from a tracked byte offset. Reset on session change. */
  let taskMap = new Map<string, "pending" | "in_progress" | "completed">();
  /** Byte offset up to which the transcript has been scanned for tasks. */
  let taskScanOffset = 0;

  plog.info("started");

  function teardownTranscriptWatching() {
    match(transcriptWatching)
      .with({ kind: "none" }, () => {})
      .with({ kind: "waiting" }, ({ dirWatcher }) => dirWatcher())
      .with({ kind: "watching" }, ({ fileWatcher }) => fileWatcher.close())
      .exhaustive();
    transcriptWatching = { kind: "none" };
  }

  function attachTranscriptWatcher(tp: string) {
    try {
      // Attach the watcher BEFORE measuring the offset. Any write that lands
      // between the watch attach and the stat fires the watcher (so it shows
      // up in stateChanges) AND is included in the disk read via the offset
      // we capture next — both columns of the debug view stay aligned. The
      // reverse order would let bytes slip into rawEvents without a matching
      // stateChange entry, producing a false "server missed an event" report.
      const fileWatcher = fs.watch(tp, () => onTranscriptMaybeChanged());
      const startOffset = fs.statSync(tp).size;
      transcriptWatching = {
        kind: "watching",
        path: tp,
        fileWatcher,
        startOffset,
        startedAt: Date.now(),
        stateChanges: [],
      };
    } catch (err) {
      plog.warn({ err, path: tp }, "failed to watch transcript");
      transcriptWatching = { kind: "none" };
    }
  }

  function setupTranscriptWatching(session: SessionFile) {
    const tp = findTranscriptPath(session);
    if (tp) {
      plog.info({ path: tp }, "transcript found");
      attachTranscriptWatcher(tp);
      onTranscriptMaybeChanged();
      return;
    }
    // JSONL not yet created — watch the project dir for its appearance.
    plog.debug(
      { session: session.sessionId, cwd: session.cwd },
      "transcript not found yet (JSONL created after first message)",
    );
    const projectDir = path.join(PROJECTS_DIR, encodeProjectPath(session.cwd));
    const dirWatcher = watchOrWaitForDir(projectDir, () =>
      onProjectDirChanged(),
    );
    transcriptWatching = { kind: "waiting", dirWatcher };
  }

  function onProjectDirChanged() {
    if (!matchedSession) return;
    if (transcriptWatching.kind !== "waiting") return;
    const tp = findTranscriptPath(matchedSession);
    if (!tp) return;
    plog.info({ path: tp }, "transcript appeared");
    transcriptWatching.dirWatcher();
    attachTranscriptWatcher(tp);
    onTranscriptMaybeChanged();
  }

  function onTranscriptMaybeChanged() {
    if (transcriptWatching.kind !== "watching") return;
    if (!matchedSession) return;

    const lines = tailJsonlLines(transcriptWatching.path, TAIL_BYTES);
    const derived = deriveState(lines);
    if (!derived) {
      plog.debug(
        { path: transcriptWatching.path },
        "no user/assistant message in transcript tail",
      );
      return;
    }

    // Incrementally scan new transcript bytes for task tool calls.
    scanTasksIncremental(transcriptWatching.path);

    const info: ClaudeCodeInfo = {
      kind: "claude-code",
      state: derived.state,
      sessionId: matchedSession.sessionId,
      model: derived.model,
      summary: lastSummary,
      taskProgress: deriveTaskProgress(taskMap),
    };

    if (!infoEqual(info, entry.info.meta.agent)) {
      plog.info(
        { state: info.state, model: info.model, session: info.sessionId },
        "claude code state updated",
      );
      transcriptWatching.stateChanges.push({ ts: Date.now(), info });
      updateMetadata(entry, terminalId, (m) => {
        m.agent = info;
      });
    }

    // Refresh the SDK-derived summary off the critical path. Failure or
    // latency here never blocks state updates — `infoEqual` dedupes the
    // follow-up emit if the summary turns out unchanged.
    refreshSummary(matchedSession);
  }

  /** Read new bytes from the transcript and extract TaskCreate/TaskUpdate calls. */
  function scanTasksIncremental(filePath: string) {
    try {
      const size = fs.statSync(filePath).size;
      if (taskScanOffset >= size) return;
      const length = size - taskScanOffset;
      const fd = fs.openSync(filePath, "r");
      let buf: Buffer;
      try {
        buf = Buffer.alloc(length);
        fs.readSync(fd, buf, 0, length, taskScanOffset);
      } finally {
        fs.closeSync(fd);
      }
      const newLines = buf
        .toString("utf8")
        .split("\n")
        .filter((l) => l.length > 0);
      // First line may be partial if taskScanOffset landed mid-line.
      // This can only happen on the very first scan (offset 0 is always a
      // line boundary; subsequent offsets are at EOF which is also a boundary).
      // Drop a partial first line only when resuming mid-file.
      if (taskScanOffset > 0 && newLines.length > 0) {
        try {
          JSON.parse(newLines[0]!);
        } catch {
          newLines.shift();
        }
      }
      const prevOffset = taskScanOffset;
      taskScanOffset = size;
      const changed = extractTasks(newLines, taskMap, plog);
      if (changed) {
        const progress = deriveTaskProgress(taskMap);
        plog.info(
          {
            tasks: taskMap.size,
            progress,
            bytesScanned: length,
            from: prevOffset,
          },
          "task progress updated",
        );
      }
    } catch (err) {
      plog.warn({ err, filePath, taskScanOffset }, "task scan failed");
    }
  }

  /**
   * Best-effort fetch of the current session's display summary from the
   * Claude Agent SDK. Fire-and-forget — caller does not await. The SDK
   * stays current with claude-code's on-disk format (custom titles,
   * auto-generated summaries, first prompts), so this insulates us from
   * having to parse those entries ourselves.
   */
  function refreshSummary(session: SessionFile) {
    if (!SUMMARY_FETCH_ENABLED) return;
    // Wrap in try/catch in case the SDK throws synchronously before
    // returning a Promise (e.g. argument validation). The .catch on the
    // chain only catches async rejections.
    let p: Promise<unknown>;
    try {
      p = getSessionInfo(session.sessionId, { dir: session.cwd });
    } catch (err) {
      plog.debug({ err, session: session.sessionId }, "getSessionInfo threw");
      return;
    }
    (p as ReturnType<typeof getSessionInfo>)
      .then((sdkInfo) => {
        // Bail if the session changed under us while the lookup was in flight.
        if (matchedSession?.sessionId !== session.sessionId) return;
        const summary = sdkInfo?.summary ?? null;
        if (summary === lastSummary) return;
        lastSummary = summary;
        const current = entry.info.meta.agent;
        if (!current || current.kind !== "claude-code") return;
        plog.info(
          { summary, session: session.sessionId },
          "claude summary updated",
        );
        updateMetadata(entry, terminalId, (m) => {
          m.agent = { ...current, summary };
        });
      })
      .catch((err) => {
        plog.debug(
          { err, session: session.sessionId },
          "getSessionInfo failed",
        );
      });
  }

  /**
   * Re-check whether the foreground pid has a matching claude session.
   * Called on: startup, title events, SESSIONS_DIR changes.
   */
  function onSessionMaybeChanged() {
    const fgPid = entry.handle.foregroundPid;
    const newSession = fgPid !== undefined ? readSessionFile(fgPid) : null;

    // Same session — nothing to do. Transcript updates flow via the
    // transcript file watcher, not this path.
    if (
      (matchedSession?.sessionId ?? null) === (newSession?.sessionId ?? null)
    ) {
      return;
    }

    // Session identity changed — tear down old watchers first.
    teardownTranscriptWatching();
    matchedSession = newSession;
    lastSummary = null;
    taskMap = new Map();
    taskScanOffset = 0;

    if (!newSession) {
      plog.info("claude code session ended");
      if (entry.info.meta.agent !== null) {
        updateMetadata(entry, terminalId, (m) => {
          m.agent = null;
        });
      }
      return;
    }

    plog.info(
      { session: newSession.sessionId, pid: newSession.pid },
      "claude code session matched",
    );
    setupTranscriptWatching(newSession);
  }

  // Expose a debug accessor for the `claude.getTranscript` RPC. Reads
  // closure-local state on demand and defensive-copies the state-change log.
  // Raw events are pulled from disk by the caller (we hand them the path +
  // start offset).
  entry.getClaudeDebug = (): ClaudeTranscriptDebug | null => {
    if (transcriptWatching.kind !== "watching") return null;
    const {
      path: tp,
      startOffset,
      startedAt,
      stateChanges,
    } = transcriptWatching;
    return {
      transcriptPath: tp,
      startedAt,
      stateChanges: [...stateChanges],
      rawEvents: readJsonlFromOffset(tp, startOffset),
    };
  };

  // Subscribe to title events — each shell preexec/precmd OSC 2 fires here.
  const abort = new AbortController();
  subscribeForTerminal("title", terminalId, abort.signal, () =>
    onSessionMaybeChanged(),
  );

  // Watch the sessions dir so session file appearance/disappearance drives
  // reconciliation. On fresh systems (~/.claude/ missing), this walks up
  // one level to watch the parent; if the parent is also missing it no-ops
  // and kolu will detect claude only after a server restart.
  const sessionsDirWatcher = watchOrWaitForDir(SESSIONS_DIR, () =>
    onSessionMaybeChanged(),
  );

  // Initial reconcile for a terminal that already hosts a claude session
  // (e.g. across kolu restarts).
  onSessionMaybeChanged();

  return () => {
    abort.abort();
    sessionsDirWatcher();
    teardownTranscriptWatching();
    delete entry.getClaudeDebug;
    plog.info("stopped");
  };
}
