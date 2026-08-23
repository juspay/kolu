/**
 * Pi core — pure functions and IO helpers for detecting pi sessions and
 * deriving state from their JSONL transcripts.
 *
 * Pi stores one append-only JSONL file per session:
 *
 *   `<~/.pi/agent>/sessions/--<cwd with "/"→"-">--/<timestamp>_<uuid>.jsonl`
 *
 * The file's first line is a `session` header; every later line is an entry
 * with `{ type, id, parentId, timestamp, … }` forming a tree (in-place
 * branching without a new file). Types kolu reads:
 *
 *  - `message` — the conversation: roles `user`, `assistant`, `toolResult`
 *    (plus `bashExecution`, `custom`, `summary` — interactive artifacts,
 *    not model turns; compaction/branch-summaries arrive as their own
 *    `compaction` / `branch_summary` entry TYPES, which the fold skips
 *    for the same signal absence).
 *  - `model_change` — user switched models mid-session.
 *  - `session_info` — the user-facing display name (`--name` / `/name`).
 *
 * No SQLite, no pid map: detection is directory-keyed like codex/opencode —
 * the terminal's cwd names the session directory, and pi names the file at
 * creation, so the newest `.jsonl` in it is the live session (the
 * orchestrator's ownership arbiter assigns when several terminals share a
 * directory, juspay/kolu#2057). An assistant message is persisted only when
 * it completes (pi-ai's `pending` stopReason never reaches disk), which is
 * what makes a tail fold honest: a mid-turn tail ends on `user` or
 * `toolResult`, never on a half-written assistant entry.
 *
 * Structure note: this file holds the leaf module. Peers `session-watcher.ts`
 * and `agent-adapter.ts` import from here; `index.ts` is a pure barrel.
 */

import fs from "node:fs";
import path from "node:path";
import { watchDirWhenReady } from "kolu-io";
import type { Logger } from "kolu-shared";
import { readTailLines } from "kolu-shared";
import { SESSIONS_DIR } from "./config.ts";
import type { PiInfo } from "./schemas.ts";

// --- Session discovery (directory-keyed) ---

/** Encode a cwd to pi's session-directory key: the LEADING `/` dropped,
 *  remaining `/` → `-`, wrapped in `--`.
 *
 *  Verified against a live pi 0.84 session tree: cwd
 *  `/home/u/code/kolu/.worktrees/x` → `--home-u-code-kolu-.worktrees-x--`
 *  (dots kept literal — unlike Claude's key, which also flattens `.`). Pi's
 *  docs phrase it as "<path> with / replaced by -", but a literal reading of
 *  that triples the leading dash; the observed tree wins. */
export function sessionDirNameFor(cwd: string): string {
  return `--${cwd.replace(/^\//, "").replace(/\//g, "-")}--`;
}

export function sessionDirFor(cwd: string): string {
  return path.join(SESSIONS_DIR, sessionDirNameFor(cwd));
}

/** `<timestamp>_<uuid>.jsonl`. The timestamp is the file's creation instant,
 *  rendered with `-` for `:` and `.` (filesystem-safe ISO), e.g.
 *  `2026-08-23T19-48-21-451Z`. The id is a UUID today; kept unpinned in
 *  shape (any non-empty token) so an upstream id-format change degrades to
 *  a different id, not a lost session — the shell-splice gate
 *  (`AGENT_RESUME.idPattern`) refuses a shape it can't splice, so no unsafe
 *  id ever crosses into a command line. */
const SESSION_FILE_RE = /^(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d+Z)_(.+)\.jsonl$/i;

/** Parse a session filename into its timestamp (epoch-ms) and session id,
 *  or null when the name doesn't carry both. Exported for tests. */
export function parseSessionFileName(
  name: string,
): { id: string; startedAt: number } | null {
  const m = SESSION_FILE_RE.exec(name);
  if (!m?.[1] || !m[2]) return null;
  // The filename timestamp is ISO with the `:`/`.` delimiters of a normal
  // ISO string rendered as `-` for filesystem safety — restore them by
  // pattern, not by blind replacement (a blind replace would also hit the
  // date's dashes).
  const ms = Date.parse(
    m[1].replace(/T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/, "T$1:$2:$3.$4Z"),
  );
  return Number.isFinite(ms) ? { id: m[2], startedAt: ms } : null;
}

export interface PiSession {
  /** Session UUID from the filename. */
  id: string;
  /** Absolute path to the session's JSONL transcript. */
  transcriptPath: string;
  /** Epoch-ms the session file was created, from its filename timestamp.
   *  Null when the name carried no parseable timestamp. */
  startedAt: number | null;
}

/** Cap on the candidate list, mirroring codex's `MAX_CANDIDATES`: the arbiter
 *  needs at most one distinct candidate per terminal sharing the directory,
 *  and this scan re-runs per terminal on every reconcile — so a directory
 *  with years of pi history must not re-sort all of it each time. Newest
 *  first, so the cap only ever drops sessions older than 64 others. */
const MAX_CANDIDATES = 64;

/** Every pi session in a terminal's cwd, most recently modified FIRST.
 *
 *  Three-valued, per the `AgentAdapter.resolveSessions` contract: `[]` is
 *  evidence the terminal runs nothing (an absent sessions directory is the
 *  documented "pi has never run here" answer — NOT an error), `null` is "the
 *  store could not be read" (the arbiter must not release a session on it). */
export function findSessionsByDirectory(
  cwd: string,
  log?: Logger,
): PiSession[] | null {
  const dir = sessionDirFor(cwd);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, dir }, "pi sessions dir unreadable");
      return null;
    }
    return [];
  }
  const candidates: { session: PiSession; mtimeMs: number }[] = [];
  for (const name of names) {
    const parsed = parseSessionFileName(name);
    if (!parsed) continue;
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(path.join(dir, name)).mtimeMs;
    } catch {
      continue; // vanished between readdir and stat — skip
    }
    candidates.push({
      session: {
        id: parsed.id,
        transcriptPath: path.join(dir, name),
        startedAt: parsed.startedAt,
      },
      mtimeMs,
    });
  }
  // Deterministic: strictly-newer first; exact ties break by name so the
  // answer is a pure function of the on-disk set, not readdir order.
  candidates.sort(
    (a, b) =>
      b.mtimeMs - a.mtimeMs ||
      a.session.transcriptPath.localeCompare(b.session.transcriptPath),
  );
  return candidates.slice(0, MAX_CANDIDATES).map((c) => c.session);
}

/** True when `~/.pi/agent` (or the test override) exists on disk.
 *  `existsSync` never throws, so no catch — the same bare call the
 *  claude-code / grok adapters use. */
export function piHomePresent(): boolean {
  return fs.existsSync(SESSIONS_DIR);
}

// --- State fold (pure) ---

/** The slice of a pi entry the fold reads. Entries carry far more; reading
 *  only these fields keeps upstream additions incapable of breaking the
 *  parse. */
interface PiEntry {
  type?: string;
  timestamp?: string;
  /** `model_change` entries. */
  modelId?: string;
  /** `session_info` entries — the user-set display name. */
  name?: string;
  message?: {
    role?: string;
    model?: string;
    stopReason?: string;
    usage?: {
      input?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
  };
}

/** Assistant stop reasons that end the turn: the agent yielded and sits at
 *  its prompt. `toolUse` is the only *working* terminal reason; pi-ai's
 *  `pending` is a streaming placeholder that per pi's own spec never reaches
 *  disk. */
const TURN_ENDED = new Set(["stop", "length", "error", "aborted"]);

/** Derive pi state + telemetry from a transcript's tail lines (oldest
 *  first). Mirrors claude-code's `deriveState` shape: one backward walk
 *  tracking two independent signals with different stopping conditions —
 *
 *   - state + model: first `message` entry that participates in a model
 *     turn. `assistant stopReason toolUse` → `tool_use`; any other terminal
 *     reason → `waiting`; a `user` or `toolResult` tail → `thinking` (the
 *     model is running or about to be re-invoked). `bashExecution` /
 *     `custom` / `branchSummary` / `compactionSummary` roles are
 *     interactive artifacts and are walked past — a trailing `/compact`
 *     summary while pi sits idle must read the prior turn (`waiting`), not
 *     fabricate work (the same trap claude's non-prompt walk-past solves).
 *   - contextTokens: newest assistant entry carrying `usage`
 *     (`input + cacheRead + cacheWrite`). Tracked separately because the
 *     newest turn entry (a fresh `user` prompt) carries no usage, while the
 *     meaningful running total lives one hop back.
 *
 *  Pure — unit-testable without touching the filesystem. */
export function derivePiState(lines: string[]): {
  state: PiInfo["state"];
  model: string | null;
  contextTokens: number | null;
  summary: string | null;
} | null {
  let state: PiInfo["state"] | null = null;
  let model: string | null = null;
  let contextTokens: number | null = null;
  let summary: string | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw === undefined) continue;
    // Once the turn signals are settled the walk only hunts the display
    // signals (session name, model) — a cheap substring pre-filter means an
    // UNNAMED session on a known model (the common case) skips JSON.parse
    // for the rest of the window entirely, and the rare candidate lines get
    // fully parsed.
    if (state !== null && contextTokens !== null) {
      const wantName = summary === null;
      const wantModel = model === null;
      if (!wantName && !wantModel) break;
      const isCandidate =
        (wantName && raw.includes('"session_info"')) ||
        (wantModel && raw.includes('"model_change"'));
      if (!isCandidate) continue;
    }
    let entry: PiEntry;
    try {
      entry = JSON.parse(raw) as PiEntry;
    } catch {
      continue; // partial trailing write / malformed line — skip
    }

    // The newest `session_info` — a display property, independent of the
    // walk's other signals. Three truths, not two: no entry in the window
    // (`null` = "unknown — the name may simply have scrolled out", and the
    // watcher merges its last-known name over this), a name (published), or
    // an entry WITHOUT a name (pi's `/name`-clear writes exactly this —
    // extensions.md's `session_info_changed: event.name … or undefined if
    // cleared`); that is an explicit CLEAR, encoded as `""` for the watcher
    // to map to `null` AND drop its cache — never paint a deleted name
    // back on.
    if (summary === null && entry.type === "session_info") {
      summary =
        typeof entry.name === "string" && entry.name.length > 0
          ? entry.name
          : "";
    }

    // Model is a third signal, INDEPENDENT of the state gate: a
    // `model_change` is also written at an idle prompt (startup, `/model`
    // cycling), which must never read as work in flight, and an in-flight
    // thinking tail still deserves the badge — so both sources are read on
    // EVERY entry, not only while `state` is unset. The winner is strict
    // newest-first across both sources: a `model_change` newer than the
    // latest turn record wins (the user's explicit switch); otherwise the
    // newest assistant entry's own `model` carries the run between
    // switches. `thinking_level_change` is orthogonal display state,
    // skipped entirely.
    if (model === null) {
      if (entry.type === "model_change" && typeof entry.modelId === "string") {
        model = entry.modelId;
      } else if (
        entry.type === "message" &&
        entry.message?.role === "assistant" &&
        typeof entry.message.model === "string"
      ) {
        model = entry.message.model;
      }
    }

    // Newest assistant `usage` — read on EVERY entry (before the state gate)
    // so the turn's own assistant entry accounts, not one hop back. Mirrors
    // claude-code's two-signal walk. The Three usage buckets (input /
    // cacheRead / cacheWrite) are disjoint per pi's custom-provider docs, so
    // summing never double-counts. A usage OBJECT is terminal evidence: an
    // errored turn with all-zero usage is the answer (0), not a reason to
    // borrow an older turn's number.
    if (
      contextTokens === null &&
      entry.type === "message" &&
      entry.message?.role === "assistant"
    ) {
      const usage = entry.message.usage;
      if (usage) {
        contextTokens =
          (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      }
    }

    if (state === null && entry.type === "message") {
      const role = entry.message?.role;
      if (role === "assistant") {
        const stopReason = entry.message?.stopReason;
        state =
          stopReason === "toolUse"
            ? "tool_use"
            : stopReason !== undefined && TURN_ENDED.has(stopReason)
              ? "waiting"
              : "thinking";
      } else if (role === "user" || role === "toolResult") {
        // A human prompt just landed, or a tool returned and the model is
        // about to be re-invoked — pi persists assistant messages only on
        // completion, so both read as work in flight.
        state = "thinking";
      }
      // bashExecution / custom / summary roles: interactive artifacts —
      // walk past to the genuine prior turn.
    }
  }

  if (state === null) return null;
  return { state, model, contextTokens, summary };
}

// --- Tail reading ---

/** Tail window for the state fold. Pi entries are many small lines rather
 *  than claude-code's monolithic assistant records, but a toolResult can
 *  carry a capped-but-large output payload — 256 KB comfortably holds the
 *  last few turns and matches the other integrations' windows. */
export const TAIL_BYTES = 256 * 1024;

/** Read the transcript tail and fold. Returns null when the file is absent
 *  (a just-matched session pi hasn't flushed yet — the watcher's absent→
 *  present floor re-fires when it lands) or carries no turn entries yet.
 *  Hard read failures are logged and also yield null — the caller treats
 *  every null uniformly as "no publish this tick" (never a state lie: the
 *  previously published info stands). */
export function derivePiInfo(
  session: PiSession,
  log?: Logger,
): Pick<PiInfo, "state" | "model" | "contextTokens" | "summary"> | null {
  let size: number;
  try {
    size = fs.statSync(session.transcriptPath).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error(
        { err, path: session.transcriptPath, session: session.id },
        "pi transcript stat failed",
      );
    }
    return null;
  }
  const lines = readTailLines({
    path: session.transcriptPath,
    size,
    maxBytes: TAIL_BYTES,
    onError: (err) =>
      log?.error(
        { err, path: session.transcriptPath, session: session.id },
        "pi transcript read failed",
      ),
  });
  if (!lines) return null;
  return derivePiState(lines);
}

// --- Sessions-tree watcher (externalChanges) ---

/** Watch the two-level sessions tree and fire on any session-file event:
 *  `sessions/` itself (per-cwd directories appearing or going away), plus one
 *  watch per existing per-cwd directory (files created inside them). A new
 *  per-cwd directory gets its child watch armed from the root event — the
 *  exact moment a first-ever pi run in that cwd becomes discoverable.
 *
 *  Why the tree and not the transcript: a pi session file exists before any
 *  title event can name it (the shell's preexec hint fires BEFORE pi writes
 *  the file), so the filesystem is the only signal that a session appeared —
 *  the same race claude's SESSIONS_DIR watcher covers for claude's pid-keyed
 *  files. `fs.watch` is not recursive on Linux, hence the two levels.
 *  `watchDirWhenReady` (kolu-io) carries the ancestor-wait so a missing
 *  `~/.pi/agent` on a fresh machine re-arms all the way up instead of dying
 *  at install time — `externalChanges.install` runs at most once per process,
 *  so a failed install would blind detection for the daemon's lifetime.
 *
 *  Process-wide: the orchestrator's `externalChanges.install` contract is
 *  at-most-once; the returned unsubscribe tears the whole tree down. */
export function subscribeSessionsTree(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  const childWatchers = new Map<string, fs.FSWatcher>();
  let closed = false;

  const fanOut = (): void => {
    if (closed) return;
    try {
      onChange();
    } catch (err) {
      onError(err);
    }
  };

  /** Reconcile child watches with the on-disk per-cwd dirs: arm a watch for
   *  every present dir, retire watches whose dir went away (fs.watch stops
   *  delivering for a deleted dir but keeps the handle, so without pruning a
   *  recreated dir would stay watched by a dead handle and never re-arm). */
  function syncChildDirs(): void {
    if (closed) return;
    let names: string[];
    try {
      names = fs.readdirSync(SESSIONS_DIR);
    } catch (err) {
      // ENOENT = the root genuinely went away — prune everything below it.
      // Any other failure is transient (EMFILE/EACCES): keep the existing
      // watch set, log loudly, and take another pass on the next root event
      // rather than silently disarming the whole tree.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log?.error({ err, dir: SESSIONS_DIR }, "pi: sessions readdir failed");
        return;
      }
      names = [];
    }
    const live = new Set(names.map((n) => path.join(SESSIONS_DIR, n)));
    for (const [dir, watcher] of childWatchers) {
      if (!live.has(dir)) {
        try {
          watcher.close();
        } catch {
          /* already-closing race */
        }
        childWatchers.delete(dir);
      }
    }
    for (const dir of live) {
      if (childWatchers.has(dir)) continue;
      try {
        // `rename` events only: membership changes (session files created
        // or deleted) are renames on both inotify and FSEvents, while
        // content appends (`change`) are exactly the per-session traffic
        // the AgentAdapter contract forbids externalChanges from reporting
        // — the candidate watcher already coalesces those.
        childWatchers.set(
          dir,
          fs.watch(dir, (eventType) => {
            if (eventType === "rename") fanOut();
          }),
        );
      } catch (err) {
        log?.error({ err, dir }, "pi: failed to watch sessions dir");
      }
    }
  }

  // Root events: child-dir membership changed (any create/delete in `sessions/`
  // fires here on both inotify and FSEvents) — re-sync, then report.
  const stopRoot = watchDirWhenReady(
    SESSIONS_DIR,
    () => {
      syncChildDirs();
      fanOut();
    },
    log,
  );

  log?.info({ dir: SESSIONS_DIR }, "pi: sessions tree watcher installed");

  return () => {
    if (closed) return;
    closed = true;
    stopRoot();
    for (const watcher of childWatchers.values()) {
      try {
        watcher.close();
      } catch {
        /* ignore teardown races */
      }
    }
    childWatchers.clear();
  };
}
