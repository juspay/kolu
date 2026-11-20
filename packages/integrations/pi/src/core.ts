import fs from "node:fs";
import path from "node:path";
import { promptTextOfParts } from "anyagent";
import { watchDirWhenReady } from "kolu-io";
import type { Logger } from "kolu-shared";
import { readTailLines } from "kolu-shared";
import { SESSIONS_DIR } from "./config.ts";
import type { PiInfo } from "./schemas.ts";

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

/** A pi session STORE: where the files live and in which of pi's two
 *  layouts — the default root keeps them under per-cwd keys (`tree`), a
 *  REDIRECTED store (`--session-dir` / `PI_CODING_AGENT_SESSION_DIR` /
 *  settings.json `sessionDir`) holds the session files FLAT, filtered by
 *  the header `cwd` field instead (pi 0.84.2: `SessionManager.list` does
 *  `listSessionsFromDir(dir)` + a header-cwd filter when a custom dir is
 *  passed, and writes land flat in it — verified against a live pi). */
export interface SessionStore {
  root: string;
  layout: "tree" | "flat";
}

/** The default store: config's root, tree layout. */
export function defaultSessionStore(): SessionStore {
  return { root: SESSIONS_DIR, layout: "tree" };
}

/** The session directory for a cwd under a given store root. `root`
 *  defaults to kolu's DEFAULT root (config `SESSIONS_DIR`) — per-terminal
 *  redirects (pi's `--session-dir` / `PI_CODING_AGENT_SESSION_DIR` chain,
 *  resolved in `session-root.ts`) pass theirs through the adapter. */
export function sessionDirFor(
  cwd: string,
  root: string = SESSIONS_DIR,
): string {
  return path.join(root, sessionDirNameFor(cwd));
}

const SESSION_FILE_RE = /^(\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d+Z)_(.+)\.jsonl$/i;
const FILE_STAMP_RE = /^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d+)Z$/;

function isoFromFileStamp(stamp: string): number | null {
  const m = FILE_STAMP_RE.exec(stamp);
  if (!m) return null;
  const [, date, hh, mm, ss, frac] = m;
  if (!date || !hh || !mm || !ss || !frac) return null;
  const ms = Date.parse(`${date}T${hh}:${mm}:${ss}.${frac}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Parse a session filename into its timestamp (epoch-ms) and session id,
 *  or null when the name doesn't carry both. Exported for tests. */
export function parseSessionFileName(
  name: string,
): { id: string; startedAt: number } | null {
  const m = SESSION_FILE_RE.exec(name);
  if (!m?.[1] || !m[2]) return null;
  const startedAt = isoFromFileStamp(m[1]);
  return startedAt === null ? null : { id: m[2], startedAt };
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

const MAX_CANDIDATES = 64;

function readSessionHeaderCwd(file: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const line = buf.slice(0, n).toString("utf8").split("\n", 1)[0];
    if (!line) return null;
    const header: unknown = JSON.parse(line);
    if (
      typeof header === "object" &&
      header !== null &&
      "cwd" in header &&
      typeof (header as { cwd: unknown }).cwd === "string"
    ) {
      return (header as { cwd: string }).cwd;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Every pi session in a terminal's cwd, most recently modified FIRST.
 *
 *  `store` is the session store to scan — the default (`SESSIONS_DIR`,
 *  `tree` layout) or a per-terminal redirect the adapter resolved from the
 *  foreground pi process (`session-root.ts`). cwd keying differs by layout:
 *  a `tree` store is keyed by directory NAME (`sessionDirNameFor`); a
 *  `flat` store holds all cwds' files side by side and is filtered by the
 *  header `cwd` field — pi's own two layouts (`SessionManager.list`).
 *
 *  Three-valued, per the `AgentAdapter.resolveSessions` contract: `[]` is
 *  evidence the terminal runs nothing (an absent sessions directory is the
 *  documented "pi has never run here" answer — NOT an error), `null` is "the
 *  store could not be read" (the arbiter must not release a session on it). */
export function findSessionsByDirectory(
  cwd: string,
  store: SessionStore = defaultSessionStore(),
  log?: Logger,
): PiSession[] | null {
  const dir =
    store.layout === "tree" ? sessionDirFor(cwd, store.root) : store.root;
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
  let realCwd: string | null | undefined;
  const cwdMatches = (headerCwd: string): boolean => {
    if (headerCwd === cwd) return true;
    if (realCwd === undefined) {
      try {
        realCwd = fs.realpathSync(cwd);
      } catch {
        realCwd = null;
      }
    }
    return realCwd !== null && headerCwd === realCwd;
  };
  const candidates: { session: PiSession; mtimeMs: number }[] = [];
  for (const name of names) {
    const parsed = parseSessionFileName(name);
    if (!parsed) continue;
    const file = path.join(dir, name);
    if (store.layout === "flat") {
      const headerCwd = readSessionHeaderCwd(file);
      if (headerCwd === null || !cwdMatches(headerCwd)) continue;
    }
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(file).mtimeMs;
    } catch {
      continue;
    }
    candidates.push({
      session: {
        id: parsed.id,
        transcriptPath: file,
        startedAt: parsed.startedAt,
      },
      mtimeMs,
    });
  }
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

interface PiEntry {
  type?: string;
  id?: string;
  timestamp?: string;
  modelId?: string;
  name?: string;
  message?: {
    role?: string;
    model?: string;
    stopReason?: string;
    content?: unknown;
    usage?: {
      input?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
  };
}

const TURN_ENDED = new Set(["stop", "length", "error", "aborted"]);

export type SessionName =
  | { kind: "unknown" }
  | { kind: "cleared" }
  | { kind: "named"; name: string };

export interface PiFold {
  state: PiInfo["state"];
  model: string | null;
  contextTokens: number | null;
  summary: SessionName;
  lastPromptId: string | null;
  lastPromptText: string | null;
}

interface SignalFold {
  readonly witness: string | null;
  settled(): boolean;
  step(entry: PiEntry): void;
}

interface ValueFold<T> extends SignalFold {
  value(): T;
}

function foldState(): ValueFold<PiInfo["state"] | null> {
  let state: PiInfo["state"] | null = null;
  return {
    witness: null,
    settled: () => state !== null,
    step(entry) {
      if (entry.type !== "message") return;
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
        state = "thinking";
      }
    },
    value: () => state,
  };
}

function foldUsage(): ValueFold<number | null> {
  let contextTokens: number | null = null;
  return {
    witness: null,
    settled: () => contextTokens !== null,
    step(entry) {
      if (entry.type !== "message" || entry.message?.role !== "assistant") {
        return;
      }
      const usage = entry.message.usage;
      if (!usage) return;
      contextTokens =
        (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    },
    value: () => contextTokens,
  };
}

function foldModel(): ValueFold<string | null> {
  let model: string | null = null;
  return {
    witness: '"model_change"',
    settled: () => model !== null,
    step(entry) {
      if (entry.type === "model_change" && typeof entry.modelId === "string") {
        model = entry.modelId;
      } else if (
        entry.type === "message" &&
        entry.message?.role === "assistant" &&
        typeof entry.message.model === "string"
      ) {
        model = entry.message.model;
      }
    },
    value: () => model,
  };
}

function foldName(): ValueFold<SessionName> {
  let name: SessionName = { kind: "unknown" };
  return {
    witness: '"session_info"',
    settled: () => name.kind !== "unknown",
    step(entry) {
      if (entry.type !== "session_info") return;
      name =
        typeof entry.name === "string" && entry.name.length > 0
          ? { kind: "named", name: entry.name }
          : { kind: "cleared" };
    },
    value: () => name,
  };
}

function foldPrompt(): ValueFold<{ id: string | null; text: string | null }> {
  let id: string | null = null;
  let text: string | null = null;
  return {
    witness: '"role":"user"',
    settled: () => id !== null,
    step(entry) {
      if (
        entry.type !== "message" ||
        entry.message?.role !== "user" ||
        typeof entry.id !== "string"
      ) {
        return;
      }
      id = entry.id;
      text = promptTextOfParts(entry.message.content);
    },
    value: () => ({ id, text }),
  };
}

/** Derive pi state + telemetry from a transcript's tail lines (oldest
 *  first): one backward walk feeding five independent signals, each with its
 *  own stopping condition — state, model, context usage, session name and the
 *  newest prompt (id + text). Null when no entry in the window carries a turn
 *  signal. Pure — unit-testable without touching the filesystem. */
export function derivePiState(lines: string[]): PiFold | null {
  const state = foldState();
  const usage = foldUsage();
  const model = foldModel();
  const name = foldName();
  const prompt = foldPrompt();
  const folds: readonly SignalFold[] = [state, usage, model, name, prompt];

  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw === undefined) continue;
    let pending = false;
    let worthParsing = false;
    for (const fold of folds) {
      if (fold.settled()) continue;
      pending = true;
      if (fold.witness === null || raw.includes(fold.witness)) {
        worthParsing = true;
        break;
      }
    }
    if (!pending) break;
    if (!worthParsing) continue;
    let entry: PiEntry;
    try {
      entry = JSON.parse(raw) as PiEntry;
    } catch {
      continue;
    }
    for (const fold of folds) {
      if (!fold.settled()) fold.step(entry);
    }
  }

  const derivedState = state.value();
  if (derivedState === null) return null;
  const { id, text } = prompt.value();
  return {
    state: derivedState,
    model: model.value(),
    contextTokens: usage.value(),
    summary: name.value(),
    lastPromptId: id,
    lastPromptText: text,
  };
}

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
export function derivePiInfo(session: PiSession, log?: Logger): PiFold | null {
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

/** Watch a session STORE and fire on any session-file event. Process-wide:
 *  the orchestrator's `externalChanges.install` contract is at-most-once, and
 *  the returned unsubscribe tears the whole watch set down. */
export function subscribeSessionsTree(
  store: SessionStore,
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  return store.layout === "flat"
    ? watchFlatStore(store.root, onChange, onError, log)
    : watchTreeStore(store.root, onChange, onError, log);
}

function guardedFanOut(
  onChange: () => void,
  onError: (err: unknown) => void,
  isClosed: () => boolean,
): () => void {
  return () => {
    if (isClosed()) return;
    try {
      onChange();
    } catch (err) {
      onError(err);
    }
  };
}

function watchFlatStore(
  root: string,
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  let closed = false;
  const stopRoot = watchDirWhenReady(
    root,
    guardedFanOut(onChange, onError, () => closed),
    log,
  );

  log?.info({ dir: root }, "pi: sessions tree watcher installed");

  return () => {
    if (closed) return;
    closed = true;
    stopRoot();
    log?.info({ dir: root }, "pi: sessions tree watcher retired");
  };
}

function watchTreeStore(
  root: string,
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  const childWatchers = new Map<string, fs.FSWatcher>();
  let closed = false;
  const fanOut = guardedFanOut(onChange, onError, () => closed);

  /** Reconcile child watches with the on-disk per-cwd dirs: arm a watch for
   *  every present dir, retire watches whose dir went away (fs.watch stops
   *  delivering for a deleted dir but keeps the handle, so without pruning a
   *  recreated dir would stay watched by a dead handle and never re-arm). */
  function syncChildDirs(): void {
    if (closed) return;
    let names: string[];
    try {
      names = fs.readdirSync(root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        log?.error({ err, dir: root }, "pi: sessions readdir failed");
        return;
      }
      names = [];
    }
    const live = new Set(names.map((n) => path.join(root, n)));
    for (const [dir, watcher] of childWatchers) {
      if (!live.has(dir)) {
        watcher.close();
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

  const stopRoot = watchDirWhenReady(
    root,
    () => {
      syncChildDirs();
      fanOut();
    },
    log,
  );

  log?.info({ dir: root }, "pi: sessions tree watcher installed");

  return () => {
    if (closed) return;
    closed = true;
    stopRoot();
    for (const watcher of childWatchers.values()) watcher.close();
    childWatchers.clear();
    log?.info({ dir: root }, "pi: sessions tree watcher retired");
  };
}
