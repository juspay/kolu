import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { SESSIONS_DIR } from "./config.ts";
import type { XyneInfo } from "./schemas.ts";

/** Encode an absolute cwd the way Xyne does (`/home/a/b` → `-home-a-b`):
 *  every character that isn't alphanumeric or `-` becomes `-`. */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}

const TRANSCRIPT_RE =
  /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z)_([0-9a-fA-F-]{36})\.jsonl$/;

export interface TranscriptName {
  readonly name: string;
  readonly ts: string;
  readonly id: string;
}

function parseTranscriptName(name: string): TranscriptName | null {
  const m = TRANSCRIPT_RE.exec(name);
  const ts = m?.[1];
  const id = m?.[2];
  return ts === undefined || id === undefined ? null : { name, ts, id };
}

export function newestTranscript(names: string[]): TranscriptName | null {
  let best: TranscriptName | null = null;
  for (const name of names) {
    const cur = parseTranscriptName(name);
    if (cur === null) continue;
    if (
      best === null ||
      cur.ts > best.ts ||
      (cur.ts === best.ts && cur.id > best.id)
    )
      best = cur;
  }
  return best;
}

export interface XyneTranscriptHeader {
  sessionId: string;
  /** Epoch-ms the session began, from the header's ISO `timestamp`. */
  startedAt: number | null;
}

/** Read the transcript's first line — the `{"type":"session"}` header — and
 *  verify it names `expectedSessionId`. Null when the file is missing, the
 *  first line is not a session header, or its id disagrees. */
export function readTranscriptHeader(
  transcriptPath: string,
  expectedSessionId: string,
  log?: Logger,
): XyneTranscriptHeader | null {
  let raw: string;
  try {
    const fd = fs.openSync(transcriptPath, "r");
    try {
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      raw = buf.subarray(0, n).toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
    const firstNl = raw.indexOf("\n");
    const firstLine = (firstNl === -1 ? raw : raw.slice(0, firstNl)).trim();
    if (!firstLine) return null;
    const entry: unknown = JSON.parse(firstLine);
    if (!entry || typeof entry !== "object") return null;
    const o = entry as Record<string, unknown>;
    if (o.type !== "session") return null;
    if (o.id !== expectedSessionId) {
      log?.warn(
        { path: transcriptPath, id: o.id, expectedSessionId },
        "xyne transcript header id does not match filename id",
      );
      return null;
    }
    const ms = typeof o.timestamp === "string" ? Date.parse(o.timestamp) : NaN;
    return {
      sessionId: expectedSessionId,
      startedAt: Number.isFinite(ms) ? ms : null,
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: transcriptPath }, "xyne transcript unreadable");
    }
    return null;
  }
}

/** Latest `model_change` entry's `"<provider>/<modelId>"`, or null. The
 *  model can switch mid-session and the NEWEST entry wins; only the last
 *  `MODEL_TAIL_BYTES` of the transcript are read, so a model set at the top
 *  of a very long transcript and never switched is not reported. */
export function readLatestModel(
  transcriptPath: string,
  log?: Logger,
): string | null {
  try {
    return lastModelChange(readTail(transcriptPath, MODEL_TAIL_BYTES));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: transcriptPath }, "xyne transcript unreadable");
    }
    return null;
  }
}

const MODEL_TAIL_BYTES = 256 * 1024;

function readTail(filePath: string, maxBytes: number): string {
  const fd = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = size > maxBytes ? size - maxBytes : 0;
    const buf = Buffer.alloc(size - start);
    const n = fs.readSync(fd, buf, 0, buf.length, start);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  return parsed !== null && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : null;
}

function lastModelChange(text: string): string | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.includes("model_change")) continue;
    const o = parseJsonObject(line);
    if (o === null || o.type !== "model_change") continue;
    const provider = typeof o.provider === "string" ? o.provider : null;
    const modelId = typeof o.modelId === "string" ? o.modelId : null;
    return provider && modelId
      ? `${provider}/${modelId}`
      : (modelId ?? provider);
  }
  return null;
}

/** Title + summary string from the `<base>_summary.json` sidecar. Null when
 *  missing or shape-unexpected — the sidecar only lands after the first
 *  summarized turn. */
export function readSummary(summaryPath: string, log?: Logger): string | null {
  try {
    const raw = fs.readFileSync(summaryPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const title = (parsed as Record<string, unknown>).title;
    return typeof title === "string" && title.trim() !== "" ? title : null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: summaryPath }, "xyne summary unreadable");
    }
    return null;
  }
}

export interface XyneSession {
  id: string;
  cwd: string;
  transcriptPath: string;
  summaryPath: string;
}

/** Resolve the Xyne session for a terminal's cwd: the newest
 *  `<timestamp>_<uuid>.jsonl` under `sessions/<encode(cwd)>/`, at most one.
 *
 *  `AgentAdapter.resolveSessions` contract: an empty list is evidence the
 *  terminal runs nothing, while NULL means the store could not be READ at
 *  all — the orchestrator releases a held session on the first and leaves
 *  everything alone on the second. */
export function resolveXyneSessions(
  cwd: string,
  log?: Logger,
): readonly XyneSession[] | null {
  const dir = path.join(SESSIONS_DIR, encodeCwd(cwd));
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    log?.error({ err, dir }, "xyne sessions dir unreadable");
    return null;
  }
  const newest = newestTranscript(names);
  if (!newest) return [];
  const transcriptPath = path.join(dir, newest.name);
  return [
    {
      id: newest.id,
      cwd,
      transcriptPath,
      summaryPath: transcriptPath.replace(/\.jsonl$/, "_summary.json"),
    },
  ];
}

/** Singular form of `resolveXyneSessions`: both the empty-list and the
 *  unreadable-store cases fold into null. */
export function resolveXyneSession(
  cwd: string,
  log?: Logger,
): XyneSession | null {
  return resolveXyneSessions(cwd, log)?.[0] ?? null;
}

/** Epoch-ms an Xyne session began, parsed from the transcript filename's
 *  timestamp prefix (`2026-08-04T01-27-11-247Z` — dashes where ISO wants
 *  colons). Null for a name that does not parse, never zero. */
export function xyneSessionStartedAt(session: XyneSession): number | null {
  const base = path.basename(session.transcriptPath);
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/.exec(base);
  if (!m) return null;
  const ms = Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
  return Number.isFinite(ms) ? ms : null;
}

/** Assemble a full XyneInfo for a matched session: state `waiting` (the
 *  persisted transcript carries no live phase), model from the transcript
 *  tail's newest `model_change`, title from the sidecar. Null when the
 *  header is unreadable or names a different session id. */
export function deriveXyneInfo(
  session: XyneSession,
  log?: Logger,
): XyneInfo | null {
  const header = readTranscriptHeader(session.transcriptPath, session.id, log);
  if (!header) return null;
  return {
    kind: "xyne",
    state: "waiting",
    sessionId: header.sessionId,
    model: readLatestModel(session.transcriptPath, log),
    summary: readSummary(session.summaryPath, log),
    taskProgress: null,
    contextTokens: null,
    startedAt: header.startedAt,
  };
}

/** True when Xyne's sessions directory exists — i.e. Xyne has run here
 *  before. */
export function xyneSessionsPresent(): boolean {
  return fs.existsSync(SESSIONS_DIR);
}
