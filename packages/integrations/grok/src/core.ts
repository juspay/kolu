/**
 * Grok core — pure functions and IO helpers for detecting Grok Build
 * sessions and deriving state from on-disk session files.
 *
 * Grok stores (under `~/.grok`, overridable via `KOLU_GROK_DIR`):
 *  - `active_sessions.json` — live map of `{ session_id, pid, cwd, opened_at }`
 *  - `sessions/<urlencode(cwd)>/<uuid>/events.jsonl` — phase + turn stream
 *  - `sessions/<urlencode(cwd)>/<uuid>/summary.json` — model, title, timestamps
 *
 * No SQLite: watchers are plain fs.watch on JSON / JSONL files.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { readTailLines } from "kolu-shared";
import { ACTIVE_SESSIONS_PATH, GROK_DIR, SESSIONS_DIR } from "./config.ts";
import type { GrokInfo } from "./schemas.ts";

// --- Path helpers ---

/** URL-encode an absolute cwd the way Grok Build does
 *  (`/home/a/b` → `%2Fhome%2Fa%2Fb`). `encodeURIComponent` matches the
 *  observed session-dir names under `~/.grok/sessions/`. */
export function encodeCwd(cwd: string): string {
  return encodeURIComponent(cwd);
}

export function sessionDirFor(cwd: string, sessionId: string): string {
  return path.join(SESSIONS_DIR, encodeCwd(cwd), sessionId);
}

export function eventsPathFor(cwd: string, sessionId: string): string {
  return path.join(sessionDirFor(cwd, sessionId), "events.jsonl");
}

export function summaryPathFor(cwd: string, sessionId: string): string {
  return path.join(sessionDirFor(cwd, sessionId), "summary.json");
}

// --- Active sessions ---

export interface ActiveSessionEntry {
  session_id: string;
  pid: number;
  cwd: string;
  opened_at?: string;
}

/** Read and parse `active_sessions.json`. Returns [] when the file is
 *  missing or unreadable — the common case before the user has ever run
 *  Grok on this machine. */
export function readActiveSessions(log?: Logger): ActiveSessionEntry[] {
  try {
    const raw = fs.readFileSync(ACTIVE_SESSIONS_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      log?.debug(
        { path: ACTIVE_SESSIONS_PATH },
        "grok active_sessions.json is not an array",
      );
      return [];
    }
    const out: ActiveSessionEntry[] = [];
    for (const item of parsed) {
      if (
        item &&
        typeof item === "object" &&
        typeof (item as ActiveSessionEntry).session_id === "string" &&
        typeof (item as ActiveSessionEntry).pid === "number" &&
        typeof (item as ActiveSessionEntry).cwd === "string"
      ) {
        out.push(item as ActiveSessionEntry);
      }
    }
    return out;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.debug(
        { err, path: ACTIVE_SESSIONS_PATH },
        "grok active_sessions unreadable",
      );
    }
    return [];
  }
}

// --- Summary ---

export interface GrokSummary {
  sessionId: string;
  cwd: string;
  model: string | null;
  title: string | null;
  startedAt: number | null;
  updatedAtMs: number | null;
}

/** Parse `summary.json` into the fields we surface. Null when missing
 *  or shape-unexpected. */
export function readSummary(
  summaryPath: string,
  log?: Logger,
): GrokSummary | null {
  try {
    const raw = fs.readFileSync(summaryPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    const info = o.info as Record<string, unknown> | undefined;
    const sessionId =
      typeof info?.id === "string"
        ? info.id
        : typeof o.id === "string"
          ? o.id
          : null;
    if (!sessionId) return null;
    const cwd =
      typeof info?.cwd === "string"
        ? info.cwd
        : typeof o.cwd === "string"
          ? o.cwd
          : "";
    const model =
      typeof o.current_model_id === "string" ? o.current_model_id : null;
    const title =
      (typeof o.generated_title === "string" && o.generated_title) ||
      (typeof o.session_summary === "string" && o.session_summary) ||
      null;
    const startedAt = parseIsoMs(
      typeof o.created_at === "string" ? o.created_at : null,
    );
    const updatedAtMs = parseIsoMs(
      typeof o.updated_at === "string"
        ? o.updated_at
        : typeof o.last_active_at === "string"
          ? o.last_active_at
          : null,
    );
    return { sessionId, cwd, model, title, startedAt, updatedAtMs };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.debug({ err, path: summaryPath }, "grok summary unreadable");
    }
    return null;
  }
}

function parseIsoMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

// --- Session match ---

export interface GrokSession {
  id: string;
  cwd: string;
  eventsPath: string;
  summaryPath: string;
  /** Epoch-ms from summary.created_at, or null until summary is readable. */
  startedAt: number | null;
}

/** Resolve the Grok session for a terminal. Prefers an
 *  `active_sessions.json` entry whose `pid` matches `foregroundPid`;
 *  falls back to the most-recently-updated session directory under the
 *  cwd-encoded path. Returns null when Grok has no session for this
 *  terminal. */
export function resolveGrokSession(
  foregroundPid: number | undefined,
  cwd: string,
  log?: Logger,
): GrokSession | null {
  if (foregroundPid !== undefined) {
    const active = readActiveSessions(log).find((e) => e.pid === foregroundPid);
    if (active) {
      return sessionFromIds(active.cwd, active.session_id, log);
    }
  }
  return findLatestSessionByCwd(cwd, log);
}

function sessionFromIds(
  cwd: string,
  sessionId: string,
  log?: Logger,
): GrokSession {
  const summary = readSummary(summaryPathFor(cwd, sessionId), log);
  return {
    id: sessionId,
    cwd,
    eventsPath: eventsPathFor(cwd, sessionId),
    summaryPath: summaryPathFor(cwd, sessionId),
    startedAt: summary?.startedAt ?? null,
  };
}

/** Pick the session directory under `sessions/<enc-cwd>/` with the
 *  newest `summary.updated_at` (or mtime). */
export function findLatestSessionByCwd(
  cwd: string,
  log?: Logger,
): GrokSession | null {
  const dir = path.join(SESSIONS_DIR, encodeCwd(cwd));
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return null;
  }
  let best: GrokSession | null = null;
  let bestMs = -1;
  for (const name of entries) {
    if (name === "prompt_history.jsonl") continue;
    const summaryPath = path.join(dir, name, "summary.json");
    const summary = readSummary(summaryPath, log);
    if (!summary) continue;
    let score = summary.updatedAtMs ?? summary.startedAt ?? 0;
    if (score === 0) {
      try {
        score = fs.statSync(summaryPath).mtimeMs;
      } catch {
        /* keep 0 */
      }
    }
    if (score >= bestMs) {
      bestMs = score;
      best = {
        id: summary.sessionId,
        cwd: summary.cwd || cwd,
        eventsPath: path.join(dir, name, "events.jsonl"),
        summaryPath,
        startedAt: summary.startedAt,
      };
    }
  }
  return best;
}

// --- State fold ---

/** Known `phase_changed.phase` values observed in live Grok sessions.
 *  Unknown phases fold to `thinking` so an upstream rename degrades to
 *  a spinner rather than a crash. Exported for the tripwire unit test. */
export const KNOWN_PHASES = [
  "waiting_for_model",
  "streaming_reasoning",
  "streaming_text",
  "tool_execution",
  "permission_prompt",
] as const;

export type GrokPhase = (typeof KNOWN_PHASES)[number] | string;

/** Pure fold: last meaningful turn/phase signal → AgentInfo.state.
 *  Walks events newest-first so a single tail pass is enough. */
export function foldEventsState(
  events: ReadonlyArray<{ type?: string; phase?: string }>,
): GrokInfo["state"] {
  // Scan newest → oldest for the most recent turn boundary or phase.
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e) continue;
    if (e.type === "turn_ended") return "waiting";
    if (e.type === "turn_started") return "thinking"; // open turn, no phase yet
    if (e.type === "phase_changed" && typeof e.phase === "string") {
      return phaseToState(e.phase);
    }
  }
  return "thinking";
}

function phaseToState(phase: string): GrokInfo["state"] {
  switch (phase) {
    case "permission_prompt":
      return "awaiting_user";
    case "tool_execution":
      return "tool_use";
    case "waiting_for_model":
    case "streaming_reasoning":
    case "streaming_text":
      return "thinking";
    default:
      return "thinking";
  }
}

/** Tail-window for events.jsonl. Phases are tiny; 128 KB holds many
 *  thousands of events — more than enough for the latest turn. */
const EVENTS_TAIL_BYTES = 128 * 1024;

/** Read the events file and fold state. Returns `thinking` when the
 *  file is absent (session just created) so the indicator lights up. */
export function deriveStateFromEvents(
  eventsPath: string,
  log?: Logger,
): GrokInfo["state"] {
  let size: number;
  try {
    size = fs.statSync(eventsPath).size;
  } catch {
    return "thinking";
  }
  const lines = readTailLines({
    path: eventsPath,
    size,
    maxBytes: EVENTS_TAIL_BYTES,
    onError: (err) =>
      log?.debug({ err, path: eventsPath }, "grok events tail failed"),
  });
  if (!lines || lines.length === 0) return "thinking";
  const events: { type?: string; phase?: string }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as { type?: string; phase?: string });
    } catch {
      /* drop partial / corrupt line */
    }
  }
  return foldEventsState(events);
}

/** Assemble a full GrokInfo for a matched session. */
export function deriveGrokInfo(session: GrokSession, log?: Logger): GrokInfo {
  const summary = readSummary(session.summaryPath, log);
  return {
    kind: "grok",
    state: deriveStateFromEvents(session.eventsPath, log),
    sessionId: session.id,
    model: summary?.model ?? null,
    summary: summary?.title ?? null,
    taskProgress: null,
    contextTokens: null,
    startedAt: summary?.startedAt ?? session.startedAt,
  };
}

/** True when `~/.grok` (or the test override) exists on disk. */
export function grokHomePresent(): boolean {
  try {
    return fs.existsSync(GROK_DIR);
  } catch {
    return false;
  }
}
