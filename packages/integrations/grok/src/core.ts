/**
 * Grok core — pure functions and IO helpers for detecting Grok Build
 * sessions and deriving state from on-disk session files.
 *
 * Grok stores (under `~/.grok`, overridable via `KOLU_GROK_DIR`):
 *  - `active_sessions.json` — live map of `{ session_id, pid, cwd, opened_at }`
 *  - `sessions/<urlencode(cwd)>/<uuid>/events.jsonl` — phase + turn stream
 *  - `sessions/<urlencode(cwd)>/<uuid>/summary.json` — model, title, timestamps
 *  - `sessions/<urlencode(cwd)>/<uuid>/signals.json` — contextTokensUsed, etc.
 *  - `sessions/<urlencode(cwd)>/<uuid>/chat_history.jsonl` — export transcript
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

export function signalsPathFor(cwd: string, sessionId: string): string {
  return path.join(sessionDirFor(cwd, sessionId), "signals.json");
}

export function chatHistoryPathFor(cwd: string, sessionId: string): string {
  return path.join(sessionDirFor(cwd, sessionId), "chat_history.jsonl");
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
      log?.warn(
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
    // ENOENT is the documented pre-first-run absence; anything else
    // (EACCES, ENOTDIR, JSON.parse SyntaxError) is a real fault that must
    // surface at error, not hide at debug behind legitimate absence.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error(
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
    const sessionId = firstString(info?.id, o.id);
    if (!sessionId) return null;
    const cwd = firstString(info?.cwd, o.cwd) ?? "";
    const model = firstString(o.current_model_id);
    const title = firstString(o.generated_title, o.session_summary);
    const startedAt = parseIsoMs(firstString(o.created_at));
    const updatedAtMs = parseIsoMs(firstString(o.updated_at, o.last_active_at));
    return { sessionId, cwd, model, title, startedAt, updatedAtMs };
  } catch (err) {
    // Absent summary (ENOENT) is normal for a just-created session; a real
    // read/parse failure must surface at error rather than vanish.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: summaryPath }, "grok summary unreadable");
    }
    return null;
  }
}

/** First `string`-typed value among candidates, else null. One idiom for
 *  the "pick the first present string field" pull-outs in `readSummary`,
 *  which Grok writes under either `info.*` or the top level. */
function firstString(...vals: unknown[]): string | null {
  for (const v of vals) if (typeof v === "string") return v;
  return null;
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
  /** Live context-window counters (`contextTokensUsed`, …). */
  signalsPath: string;
  /** Epoch-ms from summary.created_at, or null until summary is readable. */
  startedAt: number | null;
}

/** Pid → the session that pid was last seen owning in `active_sessions.json`.
 *
 *  Grok rewrites that file WHOLESALE from a process-local snapshot, so a
 *  *concurrent* grok starting or exiting erases the rows of every other live
 *  grok — observed in the 2026-08-07 incident as `[]` on disk while a grok was
 *  mid-turn. The map is therefore how a pid ACQUIRES its session, never how it
 *  loses it; the release signal is the process itself dying (swept below) or the
 *  foreground moving off it (the caller stops asking).
 *
 *  Without this binding, a clobbered row read as "the session ended": padi tore
 *  down the session watcher under a still-foreground grok and — because the
 *  foreground was a defined non-shell pid, the deliberate keep-last `unknown`
 *  arm — held the last published state for the life of the process. A finished
 *  agent read as still working, and `padi-tui wait --until waiting` hung. */
const sessionByPid = new Map<number, GrokSession>();

/** Drop bindings whose process is gone. Runs on every pid resolve, which is
 *  cheap (one `kill(pid, 0)` over a handful of entries) and keeps the window
 *  where a recycled pid could inherit a stale session down to nothing: grok's
 *  own exit rewrites `active_sessions.json`, which wakes a reconcile, so a dead
 *  pid is swept within milliseconds of the death that ended it. `EPERM` means
 *  the pid exists under another user — alive for our purposes. */
function sweepDeadBindings(): void {
  for (const pid of sessionByPid.keys()) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EPERM") {
        sessionByPid.delete(pid);
      }
    }
  }
}

/** Resolve the Grok session for a terminal. Prefers an
 *  `active_sessions.json` entry whose `pid` matches `foregroundPid`, and
 *  remembers that binding: once a pid has been matched, a later rewrite of the
 *  map that drops its row does NOT unmatch it (see {@link sessionByPid}).
 *  A pid that was never in the map still resolves to null — wait for the
 *  external active_sessions rewake rather than attaching a previous cwd
 *  session. When pid is unknown (preexec-only match), falls back to the
 *  most-recently-updated session under the cwd-encoded path. */
export function resolveGrokSession(
  foregroundPid: number | undefined,
  cwd: string,
  log?: Logger,
): GrokSession | null {
  if (foregroundPid !== undefined) {
    sweepDeadBindings();
    const active = readActiveSessions(log).find((e) => e.pid === foregroundPid);
    if (active) {
      // A present row is still authoritative — it re-binds, so a pid moved to a
      // different session follows the map rather than the memory.
      const session = sessionFromIds(active.cwd, active.session_id, log);
      sessionByPid.set(foregroundPid, session);
      return session;
    }
    // Known process, no row. Either the map was clobbered out from under a
    // session we already hold (keep it), or this pid was never in the map —
    // the arrival race, where the TUI is foreground and its row lands later.
    // The latter stays null: guessing a previous cwd session would flash the
    // wrong state, and externalChanges rewakes us when the row appears.
    return sessionByPid.get(foregroundPid) ?? null;
  }
  // No pid sample yet: recency under cwd is the only signal.
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
    signalsPath: signalsPathFor(cwd, sessionId),
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
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, dir }, "grok sessions dir unreadable");
    }
    return null;
  }
  let best: GrokSession | null = null;
  let bestMs = -1;
  for (const ent of entries) {
    // Session ids are directories; skip stray files (`prompt_history.jsonl`
    // and any sibling Grok adds later) structurally, not by name — otherwise
    // their absent `summary.json` reads as an ENOTDIR fault.
    if (!ent.isDirectory()) continue;
    const name = ent.name;
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
    // Deterministic pick: strictly-newer wins; on an exact tie break by
    // sessionId so the "latest" is a pure function of the on-disk set, not
    // of readdir iteration order.
    if (
      best === null ||
      score > bestMs ||
      (score === bestMs && summary.sessionId > best.id)
    ) {
      bestMs = score;
      best = {
        id: summary.sessionId,
        cwd: summary.cwd || cwd,
        eventsPath: path.join(dir, name, "events.jsonl"),
        summaryPath,
        signalsPath: path.join(dir, name, "signals.json"),
        startedAt: summary.startedAt,
      };
    }
  }
  return best;
}

// --- State fold ---

/** One table for Grok phase → AgentInfo.state. Unknown phases fold to
 *  `thinking` so an upstream rename degrades to a spinner rather than a
 *  crash. `KNOWN_PHASES` is derived so the list cannot drift from the map. */
export const PHASE_TO_STATE = {
  permission_prompt: "awaiting_user",
  tool_execution: "tool_use",
  waiting_for_model: "thinking",
  streaming_reasoning: "thinking",
  streaming_text: "thinking",
} as const satisfies Record<string, GrokInfo["state"]>;

export const KNOWN_PHASES = Object.keys(PHASE_TO_STATE) as Array<
  keyof typeof PHASE_TO_STATE
>;

/**
 * Tool basenames that block the user until they answer (multiple-choice
 * / freeform prompts). Grok leaves these open under `phase:
 * tool_execution` after auto-allowing the tool permission — so a pure
 * phase fold reads `tool_use` while the UI is blocked on the user.
 * Verified live: `tool_started ask_user_question` with no
 * `tool_completed` until the answer is submitted.
 */
export const USER_BLOCKING_TOOLS: ReadonlySet<string> = new Set([
  "ask_user_question",
]);

/** Event shape the fold consumes — phases plus tool start/complete so
 *  open user-blocking tools can promote to `awaiting_user`. */
export type GrokFoldEvent = {
  type?: string;
  phase?: string;
  tool_name?: string;
};

/** Pure fold: last meaningful turn/phase/tool signal → AgentInfo.state.
 *
 *  Order of precedence:
 *   1. An open user-blocking tool (`ask_user_question` started, not
 *      completed) **within the current turn** → `awaiting_user` — wins
 *      over a trailing `tool_execution` phase (the real ask-user wait).
 *      Scoped to the current turn on purpose: a `turn_ended` (user
 *      escaped the prompt / the turn was interrupted) or a newer
 *      `turn_started` supersedes a dangling `ask_user_question`, so the
 *      session can't stick in `awaiting_user` forever after the turn that
 *      opened the prompt is over.
 *   2. Newest turn boundary / phase_changed / open `goal_planner_fired`
 *      (existing phase map). `goal_planner_completed` is not an active
 *      state — it stack-matches a preceding fire so a hang between
 *      completed and `turn_started` falls through to the last real
 *      boundary (stale `turn_ended` → waiting) instead of stranding the
 *      tile on thinking. In the happy path `turn_started` lands in the
 *      same append flush and wins on its own.
 */
export function foldEventsState(
  events: ReadonlyArray<GrokFoldEvent>,
): GrokInfo["state"] {
  // Locate the latest turn boundary. The open-tool promotion only applies
  // while the current turn is still open (last boundary is a `turn_started`
  // or there is no boundary at all); a trailing `turn_ended` means the turn
  // — and any prompt it opened — is done.
  let lastBoundary = -1;
  let lastBoundaryType: "turn_started" | "turn_ended" | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i]?.type;
    if (t === "turn_started" || t === "turn_ended") {
      lastBoundary = i;
      lastBoundaryType = t;
      break;
    }
  }

  if (
    lastBoundaryType !== "turn_ended" &&
    hasOpenUserBlockingTool(events.slice(lastBoundary >= 0 ? lastBoundary : 0))
  ) {
    return "awaiting_user";
  }

  // Scan newest → oldest for the most recent turn boundary, phase, or
  // open /goal planner fire. A completed planner is not itself a state
  // signal — it stack-matches a preceding fire (count of unmatched
  // completes, same idea as hasOpenUserBlockingTool) so death between
  // completed and turn_started self-corrects via the stale turn_ended.
  let plannerCloses = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (!e) continue;
    if (e.type === "goal_planner_completed") {
      plannerCloses++;
      continue;
    }
    if (e.type === "goal_planner_fired") {
      if (plannerCloses > 0) {
        plannerCloses--;
        continue;
      }
      return "thinking";
    }
    if (e.type === "turn_ended") return "waiting";
    if (e.type === "turn_started") return "thinking"; // open turn, no phase yet
    if (e.type === "phase_changed" && typeof e.phase === "string") {
      return phaseToState(e.phase);
    }
  }
  return "thinking";
}

/** True when some user-blocking tool has more starts than completes in
 *  the event window (still open, waiting on the human). */
export function hasOpenUserBlockingTool(
  events: ReadonlyArray<GrokFoldEvent>,
): boolean {
  const open = new Map<string, number>();
  for (const e of events) {
    const name = e.tool_name;
    if (!name || !USER_BLOCKING_TOOLS.has(name)) continue;
    if (e.type === "tool_started") {
      open.set(name, (open.get(name) ?? 0) + 1);
    } else if (e.type === "tool_completed") {
      const n = (open.get(name) ?? 0) - 1;
      if (n <= 0) open.delete(name);
      else open.set(name, n);
    }
  }
  for (const n of open.values()) {
    if (n > 0) return true;
  }
  return false;
}

function phaseToState(phase: string): GrokInfo["state"] {
  return PHASE_TO_STATE[phase as keyof typeof PHASE_TO_STATE] ?? "thinking";
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
  } catch (err) {
    // Absent file (ENOENT) is the documented session-just-created case; a
    // real read failure (EACCES/ENOTDIR) must still surface, not vanish —
    // same convention as readActiveSessions/readSummary above.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: eventsPath }, "grok events stat failed");
    }
    return "thinking";
  }
  const lines = readTailLines({
    path: eventsPath,
    size,
    maxBytes: EVENTS_TAIL_BYTES,
    onError: (err) =>
      // stat already succeeded above, so a tail failure here is a real read
      // fault (permissions, truncation race) — surface it at error.
      log?.error({ err, path: eventsPath }, "grok events tail failed"),
  });
  if (!lines || lines.length === 0) return "thinking";
  const events: GrokFoldEvent[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as GrokFoldEvent);
    } catch {
      /* drop partial / corrupt line */
    }
  }
  return foldEventsState(events);
}

/** Read live context-window usage from `signals.json`.
 *  Grok writes `contextTokensUsed` (absolute count) and
 *  `contextWindowTokens` (cap) — we surface the used count to match
 *  Claude/Codex/OpenCode's `contextTokens` field. Null when the file is
 *  missing or the field is absent/non-numeric. */
export function readContextTokens(
  signalsPath: string,
  log?: Logger,
): number | null {
  try {
    const raw = fs.readFileSync(signalsPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const used = (parsed as Record<string, unknown>).contextTokensUsed;
    return typeof used === "number" && Number.isFinite(used) ? used : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: signalsPath }, "grok signals unreadable");
    }
    return null;
  }
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
    contextTokens: readContextTokens(session.signalsPath, log),
    startedAt: summary?.startedAt ?? session.startedAt,
  };
}

/** True when `~/.grok` (or the test override) exists on disk. `existsSync`
 *  never throws (it resolves access failures to `false`), so no catch —
 *  same bare call the claude-code / codex adapters use. */
export function grokHomePresent(): boolean {
  return fs.existsSync(GROK_DIR);
}
