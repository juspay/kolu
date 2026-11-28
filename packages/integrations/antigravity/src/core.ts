/**
 * Antigravity CLI core — which conversation a terminal's `agy` has, and what
 * its files say about it.
 *
 * `agy` keeps everything under its app data directory (`config.ts`):
 *
 *  - `presence/<id>.lock` — one per conversation. The `agy` process that has a
 *    conversation keeps that lock OPEN for as long as it has it: none before
 *    its first prompt, the new one at once after `/clear`, and of two `agy` in
 *    one folder, the one with a conversation holds its lock while the fresh one
 *    holds none. So the names of a process's open files say which conversation
 *    it runs (Linux: `/proc/<pid>/fd`).
 *  - `cache/last_conversations.json` — directory → the conversation last active
 *    there. One id per directory, rewritten only at some events, entries kept
 *    after exit. Read only where open files cannot be (macOS, a hidden
 *    `/proc`).
 *  - `brain/<id>/.system_generated/logs/transcript.jsonl` — one JSON object a
 *    line, appended, each line written whole. A user line lands at the submit;
 *    a model answer lands whole when it is finished; a tool-calling answer lands
 *    before its tool runs; nothing lands when a turn is interrupted.
 *  - `annotations/<id>.pbtxt` — the title, one line of protobuf text.
 *
 * kolu reads those and nothing else: never the credential file, a database,
 * `history.jsonl`, the logs, or a process's environment.
 *
 * Evidence: three captures of `agy` 1.5.19 on Linux, 2026-11-28.
 */

import fs from "node:fs";
import path from "node:path";
import { UUID_RE } from "anyagent";
import { readOpenFileNames, watchDirWhenReady } from "kolu-io";
import type { Logger } from "kolu-shared";
import { readTailLines } from "kolu-shared";
import {
  ANTIGRAVITY_DIR,
  annotationsPathFor,
  LAST_CONVERSATIONS_FILE,
  PRESENCE_DIR,
  transcriptPathFor,
} from "./config.ts";
import type { AntigravityInfo } from "./schemas.ts";

// --- Which conversation ---

export interface AntigravitySession {
  /** The conversation id (a UUID). */
  id: string;
  transcriptPath: string;
  annotationsPath: string;
}

function sessionFor(id: string): AntigravitySession {
  return {
    id,
    transcriptPath: transcriptPathFor(id),
    annotationsPath: annotationsPathFor(id),
  };
}

/** The presence directory as the kernel spells it. `/proc/<pid>/fd` links are
 *  resolved paths, so a home reached through a symlink must be compared in its
 *  resolved form too. */
function presenceDirSpellings(): readonly string[] {
  try {
    const real = fs.realpathSync(PRESENCE_DIR);
    return real === PRESENCE_DIR ? [PRESENCE_DIR] : [PRESENCE_DIR, real];
  } catch {
    return [PRESENCE_DIR];
  }
}

/** The conversation ids whose presence lock is among these open-file names. */
export function conversationsHeld(openFiles: readonly string[]): string[] {
  const dirs = presenceDirSpellings();
  const ids = new Set<string>();
  for (const name of openFiles) {
    if (!name.endsWith(".lock") || !dirs.includes(path.dirname(name))) continue;
    const id = path.basename(name, ".lock");
    if (UUID_RE.test(id)) ids.add(id);
  }
  return [...ids];
}

/** The conversation `last_conversations.json` names for this directory: `[]`
 *  when the file is absent or names none here, `null` when it cannot be read.
 *  Its limits are documented, not hidden: one id per directory (two `agy` in
 *  one folder share it), the old id until the first prompt after `/clear`,
 *  and entries that outlive the process. */
export function conversationForDirectory(
  cwd: string,
  log?: Logger,
): AntigravitySession[] | null {
  let raw: string;
  try {
    raw = fs.readFileSync(LAST_CONVERSATIONS_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    log?.error(
      { err, path: LAST_CONVERSATIONS_FILE },
      "antigravity: directory cache unreadable",
    );
    return null;
  }
  let map: unknown;
  try {
    map = JSON.parse(raw);
  } catch (err) {
    log?.error(
      { err, path: LAST_CONVERSATIONS_FILE },
      "antigravity: directory cache is not JSON",
    );
    return null;
  }
  if (map === null || typeof map !== "object" || Array.isArray(map)) {
    log?.error(
      { path: LAST_CONVERSATIONS_FILE },
      "antigravity: directory cache is not a JSON object",
    );
    return null;
  }
  const entries = map as Record<string, unknown>;
  let id = entries[cwd];
  if (id === undefined) {
    try {
      id = entries[fs.realpathSync(cwd)];
    } catch {
      /* a cwd that no longer resolves names nothing */
    }
  }
  return typeof id === "string" && UUID_RE.test(id) ? [sessionFor(id)] : [];
}

/** The conversation a terminal's `agy` process has — at most one candidate.
 *
 *  Where its open files can be read, the presence lock among them IS the
 *  answer: none for a fresh `agy` (`[]`), one otherwise. Where they cannot
 *  (`readOpenFileNames` answers unknown), the directory cache stands in.
 *  `null` when neither can be read — the orchestrator then leaves the terminal
 *  as it was. */
export function resolveAntigravitySessions(
  pid: number | undefined,
  cwd: string,
  log?: Logger,
): readonly AntigravitySession[] | null {
  const openFiles = pid === undefined ? null : readOpenFileNames(pid, log);
  if (openFiles === null) return conversationForDirectory(cwd, log);
  const held = conversationsHeld(openFiles);
  if (held.length > 1) {
    // Never seen: every `agy` listed held exactly its own lock. Two would mean
    // kolu cannot say which conversation is live, so it does not guess.
    log?.warn(
      { pid, held: held.length },
      "antigravity: process holds more than one conversation lock",
    );
    return null;
  }
  return held.map(sessionFor);
}

/** True when `agy` has run on this machine (or the test override exists). */
export function antigravityHomePresent(): boolean {
  return fs.existsSync(ANTIGRAVITY_DIR);
}

// --- State fold (pure) ---

/** The slice of a transcript line the fold reads. */
interface TranscriptLine {
  type?: unknown;
  model?: unknown;
  input_tokens?: unknown;
  cache_read_tokens?: unknown;
  tool_calls?: unknown;
}

/** The state each kind of last line means. `GENERIC` is a tool's result, of
 *  any status: an `ERROR` result (a refused file write leaves one) is not read
 *  as the end of a turn, because the model is told to carry on after one. A
 *  system line can sit inside a turn. */
function stateOf(line: TranscriptLine): AntigravityInfo["state"] | null {
  switch (line.type) {
    case "USER_INPUT":
    case "SYSTEM_MESSAGE":
    case "GENERIC":
      return "thinking";
    case "PLANNER_RESPONSE":
      return Array.isArray(line.tool_calls) && line.tool_calls.length > 0
        ? "tool_use"
        : "waiting";
    default:
      return null;
  }
}

export interface AntigravityFold {
  state: AntigravityInfo["state"];
  model: string | null;
  contextTokens: number | null;
}

/** Fold a transcript's tail (oldest first) into state, model and context
 *  size. State is the newest line's; model and context size are the newest
 *  model answer's that carries them. `null` when the newest line is of a kind
 *  this fold does not know — kolu does not guess a state for it, and
 *  `onUnknownKind` hears its `type` — or there is no line at all. Pure. */
export function deriveAntigravityState(
  lines: readonly string[],
  onUnknownKind?: (type: unknown) => void,
): AntigravityFold | null {
  let state: AntigravityInfo["state"] | null | undefined;
  let model: string | null = null;
  let contextTokens: number | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(lines[i] ?? "");
    } catch {
      continue; // never seen: lines are written whole
    }
    if (parsed === null || typeof parsed !== "object") continue;
    // Every field of `TranscriptLine` is `unknown`, so each read below is
    // checked before use.
    const line: TranscriptLine = parsed;
    if (state === undefined) {
      state = stateOf(line);
      if (state === null) {
        onUnknownKind?.(line.type);
        return null;
      }
    }
    if (line.type === "PLANNER_RESPONSE") {
      if (model === null && typeof line.model === "string") model = line.model;
      if (contextTokens === null && typeof line.input_tokens === "number") {
        contextTokens =
          line.input_tokens +
          (typeof line.cache_read_tokens === "number"
            ? line.cache_read_tokens
            : 0);
      }
    }
    if (model !== null && contextTokens !== null) break;
  }
  if (state === undefined || state === null) return null;
  return { state, model, contextTokens };
}

// --- Reads ---

/** Tail window for the fold. A tool's result can be long; 256 KB holds the
 *  last few turns, as for the other agents. */
export const TAIL_BYTES = 256 * 1024;

/** The transcript's tail folded, or null — absent (no prompt yet), unreadable
 *  (logged), or nothing to fold. A null is "no publish this tick", never a
 *  state. */
export function readAntigravityFold(
  session: AntigravitySession,
  log?: Logger,
): AntigravityFold | null {
  let size: number;
  try {
    size = fs.statSync(session.transcriptPath).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error(
        { err, path: session.transcriptPath, session: session.id },
        "antigravity: transcript stat failed",
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
        "antigravity: transcript read failed",
      ),
  });
  return lines === null
    ? null
    : deriveAntigravityState(lines, (type) => {
        const kind = String(type);
        if (unknownKindsLogged.has(kind)) return;
        unknownKindsLogged.add(kind);
        log?.debug(
          { type: kind, session: session.id },
          "antigravity: transcript line of a kind kolu does not read",
        );
      });
}

/** Each unknown line kind is logged once per process: a new `agy` release
 *  leaves one trace, not one per reconcile. */
const unknownKindsLogged = new Set<string>();

/** How far the first-line read goes before it gives up: a first line is the
 *  first prompt, which can be a long paste. */
const FIRST_LINE_MAX_BYTES = 4 * 1024 * 1024;
const FIRST_LINE_CHUNK = 64 * 1024;

function readFirstLine(file: string): string | null {
  const fd = fs.openSync(file, "r");
  try {
    const chunks: Buffer[] = [];
    let total = 0;
    while (total < FIRST_LINE_MAX_BYTES) {
      const buf = Buffer.alloc(FIRST_LINE_CHUNK);
      const n = fs.readSync(fd, buf, 0, buf.length, total);
      if (n === 0) return null; // no complete line yet
      const nl = buf.subarray(0, n).indexOf(0x0a);
      if (nl !== -1) {
        chunks.push(buf.subarray(0, nl));
        return Buffer.concat(chunks).toString("utf8");
      }
      chunks.push(buf.subarray(0, n));
      total += n;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

/** Epoch-ms of the transcript's first line, or null — no transcript yet, or a
 *  first line without a readable `created_at`. */
export function readStartedAt(
  session: AntigravitySession,
  log?: Logger,
): number | null {
  let first: string | null;
  try {
    first = readFirstLine(session.transcriptPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error(
        { err, path: session.transcriptPath, session: session.id },
        "antigravity: transcript head unreadable",
      );
    }
    return null;
  }
  if (first === null) return null;
  let line: unknown;
  try {
    line = JSON.parse(first);
  } catch {
    return null;
  }
  if (line === null || typeof line !== "object" || !("created_at" in line))
    return null;
  const createdAt = line.created_at;
  const ms = typeof createdAt === "string" ? Date.parse(createdAt) : NaN;
  return Number.isFinite(ms) ? ms : null;
}

/** Single-character escapes of protobuf text format, as bytes. */
const SIMPLE_ESCAPES: Record<string, number> = {
  n: 0x0a,
  r: 0x0d,
  t: 0x09,
  a: 0x07,
  b: 0x08,
  f: 0x0c,
  v: 0x0b,
  "\\": 0x5c,
  "'": 0x27,
  '"': 0x22,
  "?": 0x3f,
};

/** Decode the body of a protobuf text-format string literal: the escapes the
 *  format defines (simple, octal, `\x` hex), bytes then read as UTF-8. Null
 *  for an escape the format does not define, or bytes that are not UTF-8. */
export function decodeProtoTextString(body: string): string | null {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (ch !== "\\") {
      const code = body.codePointAt(i) as number;
      const char = String.fromCodePoint(code);
      bytes.push(...encoder.encode(char));
      i += char.length - 1;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) return null;
    const simple = SIMPLE_ESCAPES[next];
    if (simple !== undefined) {
      bytes.push(simple);
      i += 1;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      const value = Number.parseInt(octal[0], 8);
      if (value > 0xff) return null;
      bytes.push(value);
      i += octal[0].length;
      continue;
    }
    const hex = /^x([0-9a-fA-F]{1,2})/.exec(body.slice(i + 1, i + 4));
    if (hex?.[1]) {
      bytes.push(Number.parseInt(hex[1], 16));
      i += hex[0].length;
      continue;
    }
    return null;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(bytes),
    );
  } catch {
    return null;
  }
}

/** The whole file, one `title:"…"` line and nothing else. */
const TITLE_RE = /^title:\s*"((?:[^"\\\n]|\\.)*)"$/;

/** The conversation's own title, or null — the file is absent, unreadable
 *  (logged), or anything but the one `title:"…"` line. kolu makes none up. */
export function readTitle(
  session: AntigravitySession,
  log?: Logger,
): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(session.annotationsPath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error(
        { err, path: session.annotationsPath, session: session.id },
        "antigravity: title unreadable",
      );
    }
    return null;
  }
  const m = TITLE_RE.exec(raw.trimEnd());
  if (!m || m[1] === undefined) return null;
  const title = decodeProtoTextString(m[1]);
  return title !== null && title.trim() !== "" ? title : null;
}

// --- Wake-ups (externalChanges) ---

/** Watch where a conversation's arrival shows: `presence/`, where a lock file
 *  appears whenever a conversation starts (first prompt, `/clear`, `/fork`),
 *  and `cache/`, for the directory cache the fallback reads. Each waits for its
 *  directory to appear, so a machine that never ran `agy` pays one ancestor
 *  watch and nothing else. */
export function subscribeConversationStarts(
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  const fanOut = (): void => {
    try {
      onChange();
    } catch (err) {
      onError(err);
    }
  };
  const stops = [
    watchDirWhenReady(PRESENCE_DIR, fanOut, log),
    watchDirWhenReady(path.dirname(LAST_CONVERSATIONS_FILE), fanOut, log),
  ];
  log?.info(
    { dir: ANTIGRAVITY_DIR },
    "antigravity: conversation watch installed",
  );
  return () => {
    for (const stop of stops) stop();
  };
}
