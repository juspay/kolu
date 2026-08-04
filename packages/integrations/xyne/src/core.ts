/**
 * Xyne core — pure functions and IO helpers for detecting Xyne CLI
 * sessions and deriving state from on-disk session files.
 *
 * Xyne stores (under `~/.xyne`, overridable via `KOLU_XYNE_DIR`):
 *  - `agent/sessions/<encoded-cwd>/<timestamp>_<session-id>.jsonl` — the
 *    session transcript (pi format): first line is the `{"type":"session"}`
 *    header with id / timestamp / cwd, then one entry per message; a
 *    `model_change` entry records the provider's model id.
 *  - `agent/sessions/<encoded-cwd>/<timestamp>_<session-id>_summary.json` —
 *    sidecar with the display title.
 *
 * The `<encoded-cwd>` directory name replaces every non-alphanumeric,
 * non-hyphen character with `-` (`/home/a/b` → `-home-a-b`).
 *
 * The JSONL is the PERSISTED history Xyne's own `--session <id>` resume —
 * and kolu's restore — already reads, so it is the detection anchor; it is
 * not a live phase stream, hence the honest-`waiting` state.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "kolu-shared";
import { SESSIONS_DIR } from "./config.ts";
import type { XyneInfo } from "./schemas.ts";

// --- Path helpers ---

/** Encode an absolute cwd the way Xyne does (`/home/a/b` → `-home-a-b`):
 *  every character that isn't alphanumeric or `-` becomes `-`. */
export function encodeCwd(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}

/** Filename shape Xyne's runtime persists
 *  (`2026-08-04T01-27-11-247Z_<uuid>.jsonl`); captures the timestamp and the
 *  session id. The timestamp runs right up to the `_` separator, and the id
 *  is anchored on `_[0-9a-f-]{36}` — not a hyphen, which the timestamp itself
 *  is full of. */
const TRANSCRIPT_RE =
  /^([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{3}Z)_([0-9a-fA-F-]{36})\.jsonl$/;

/** Pick the newest transcript out of candidate filenames by their parsed
 *  `(timestamp, id)` prefix — never by bytewise string order on the full
 *  name. A string-max over names whose timestamp *happens* to zero-pad
 *  chronologically is a sort that silently fails the first time the upstream
 *  naming shifts (unpadded segment, locale date); an unmatched shape is
 *  skipped, never ranked. */
export function newestTranscript(
  names: string[],
): { name: string; id: string } | null {
  let best: { name: string; ts: string; id: string } | null = null;
  for (const name of names) {
    const m = TRANSCRIPT_RE.exec(name);
    if (!m) continue; // sidecars (_summary/_modified_files/_review_baseline)
    const ts = m[1];
    const id = m[2];
    if (ts === undefined || id === undefined) continue;
    if (best === null || ts > best.ts || (ts === best.ts && id > best.id))
      best = { name, ts, id };
  }
  return best ? { name: best.name, id: best.id } : null;
}

// --- Transcript reads ---

export interface XyneTranscriptHeader {
  sessionId: string;
  /** Epoch-ms the session began, from the header's ISO `timestamp`. */
  startedAt: number | null;
}

/** Read the transcript's first line — the `{"type":"session"}` header —
 *  and verify it names `sessionId` (filename carries the fallback when the
 *  header is absent, so src/agent always produces one). Null when the file
 *  is missing or shape-unexpected. One small read: the header is line one,
 *  so the tail-window never applies. */
export function readTranscriptHeader(
  transcriptPath: string,
  expectedSessionId: string,
  log?: Logger,
): XyneTranscriptHeader | null {
  // The header is line one and short — read a bounded head window so a
  // multi-GB transcript is never buffered per re-derive.
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
    // Absent transcript (ENOENT) is the documented pre-first-turn case; a
    // real read/parse failure must surface at error, not hide behind
    // legitimate absence.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: transcriptPath }, "xyne transcript unreadable");
    }
    return null;
  }
}

/** Latest `model_change` entry's `"<provider>/<modelId>"` in the tail of
 *  the transcript, or null. The model can switch mid-session, so the NEWEST
 *  tail entry wins; a model set at the top of a very long transcript and
 *  never switched is intentionally not chased. Tail-bounded so a multi-GB
 *  transcript is never buffered per re-derive. */
export function readLatestModel(
  transcriptPath: string,
  log?: Logger,
): string | null {
  let tailText: string;
  try {
    tailText = fs.readFileSync(transcriptPath, "utf8").slice(-MODEL_TAIL_BYTES);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: transcriptPath }, "xyne transcript unreadable");
    }
    return null;
  }
  return lastModelChange(tailText);
}

/** Tail-window for the model scan: a `model_change` line is one short JSON
 *  entry; any session that switched models recently lands one here. */
const MODEL_TAIL_BYTES = 256 * 1024;

/** Newest `model_change` in already-read text, else null. The first line of
 *  the tail slice can be partial JSON — skipped by the parse guard. */
function lastModelChange(text: string): string | null {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line?.includes("model_change")) continue;
    try {
      const entry: unknown = JSON.parse(line);
      if (!entry || typeof entry !== "object") continue;
      const o = entry as Record<string, unknown>;
      if (o.type !== "model_change") continue;
      const provider = typeof o.provider === "string" ? o.provider : null;
      const modelId = typeof o.modelId === "string" ? o.modelId : null;
      return provider && modelId
        ? `${provider}/${modelId}`
        : (modelId ?? provider);
    } catch {
      /* partial tail line */
    }
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

// --- Session match ---

export interface XyneSession {
  id: string;
  cwd: string;
  transcriptPath: string;
  summaryPath: string;
}

/** Resolve the Xyne session for a terminal's cwd: the newest
 *  `<ts>_<uuid>.jsonl` under `sessions/<encode(cwd)>/`. Xyne publishes no
 *  live pid→session map, so the newest transcript for the cwd is the best
 *  available identity — the same session `xyne --continue` would reopen.
 *  Deterministic: filename sort is time-ordered by construction (the
 *  `<timestamp>_<id>` prefix), ties broken by the id. */
export function resolveXyneSession(
  cwd: string,
  log?: Logger,
): XyneSession | null {
  const dir = path.join(SESSIONS_DIR, encodeCwd(cwd));
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, dir }, "xyne sessions dir unreadable");
    }
    return null;
  }
  const newest = newestTranscript(names);
  if (!newest) return null;
  const transcriptPath = path.join(dir, newest.name);
  return {
    id: newest.id,
    cwd,
    transcriptPath,
    summaryPath: transcriptPath.replace(/\.jsonl$/, "_summary.json"),
  };
}

/** Assemble a full XyneInfo for a matched session. State is honest
 *  `waiting` (the persisted transcript carries no live phase), model is the
 *  tail's newest `model_change`, title the sidecar's — every field read
 *  fresh so a watching re-derive sees the latest turn. */
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

/** True when `~/.xyne/agent/sessions` (or the test override) exists —
 *  i.e. Xyne has run here before. `existsSync` never throws, so no catch —
 *  same bare call the other adapters use for home presence. */
export function xyneSessionsPresent(): boolean {
  return fs.existsSync(SESSIONS_DIR);
}
