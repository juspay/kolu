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
import type { ClaudeCodeInfo } from "kolu-common";
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
const TAIL_BYTES = 16_384;

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

/** Compare two ClaudeCodeInfo values for equality. */
export function infoEqual(
  a: ClaudeCodeInfo | null,
  b: ClaudeCodeInfo | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.state === b.state &&
    a.sessionId === b.sessionId &&
    a.model === b.model &&
    a.summary === b.summary
  );
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
 */
type TranscriptWatching =
  | { kind: "none" }
  | { kind: "waiting"; dirWatcher: () => void }
  | { kind: "watching"; path: string; fileWatcher: fs.FSWatcher };

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
      const fileWatcher = fs.watch(tp, () => onTranscriptMaybeChanged());
      transcriptWatching = { kind: "watching", path: tp, fileWatcher };
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

    const info: ClaudeCodeInfo = {
      state: derived.state,
      sessionId: matchedSession.sessionId,
      model: derived.model,
      summary: lastSummary,
    };

    if (!infoEqual(info, entry.info.meta.claude)) {
      plog.info(
        { state: info.state, model: info.model, session: info.sessionId },
        "claude code state updated",
      );
      updateMetadata(entry, terminalId, (m) => {
        m.claude = info;
      });
    }

    // Refresh the SDK-derived summary off the critical path. Failure or
    // latency here never blocks state updates — `infoEqual` dedupes the
    // follow-up emit if the summary turns out unchanged.
    refreshSummary(matchedSession);
  }

  /**
   * Best-effort fetch of the current session's display summary from the
   * Claude Agent SDK. Fire-and-forget — caller does not await. The SDK
   * stays current with claude-code's on-disk format (custom titles,
   * auto-generated summaries, first prompts), so this insulates us from
   * having to parse those entries ourselves.
   */
  function refreshSummary(session: SessionFile) {
    getSessionInfo(session.sessionId, { dir: session.cwd })
      .then((sdkInfo) => {
        // Bail if the session changed under us while the lookup was in flight.
        if (matchedSession?.sessionId !== session.sessionId) return;
        const summary = sdkInfo?.summary ?? null;
        if (summary === lastSummary) return;
        lastSummary = summary;
        const current = entry.info.meta.claude;
        if (!current) return;
        plog.info(
          { summary, session: session.sessionId },
          "claude summary updated",
        );
        updateMetadata(entry, terminalId, (m) => {
          m.claude = { ...current, summary };
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

    if (!newSession) {
      plog.info("claude code session ended");
      if (entry.info.meta.claude !== null) {
        updateMetadata(entry, terminalId, (m) => {
          m.claude = null;
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
    plog.info("stopped");
  };
}
