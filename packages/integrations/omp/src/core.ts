import fs from "node:fs";
import { watchDirWhenReady } from "kolu-io";
import type { Logger } from "kolu-shared";
import { readTailLines } from "kolu-shared";
import { promptTextOfParts } from "anyagent";
import type { OmpInfo } from "./schemas.ts";
import type { OmpSession } from "./breadcrumb.ts";

interface OmpEntry {
  type?: string;
  id?: string;
  model?: string;
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

/** Derive omp state + telemetry from a transcript's tail lines (oldest first).
 *
 *  Each field is an independent projection of the newest entry that answers
 *  it, read by the reducer of the same name below. `null` means no entry in
 *  the tail answered that projection; `null` for the whole result means no
 *  entry carried a turn at all (a file with only its title slot and header),
 *  which is "nothing to publish yet" rather than a fabricated state.
 *
 *  Pure — unit-testable without touching the filesystem. */
export function deriveOmpState(lines: string[]): {
  state: OmpInfo["state"];
  model: string | null;
  contextTokens: number | null;
  lastPromptId: string | null;
  lastPromptText: string | null;
} | null {
  let state: OmpInfo["state"] | null = null;
  let model: string | null = null;
  let contextTokens: number | null = null;
  let prompt: OmpPrompt | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    if (
      state !== null &&
      model !== null &&
      contextTokens !== null &&
      prompt !== null
    )
      break;
    const entry = parseEntry(lines[i]);
    if (entry === null) continue;
    state ??= stateOf(entry);
    model ??= modelOf(entry);
    contextTokens ??= contextTokensOf(entry);
    prompt ??= promptOf(entry);
  }

  if (state === null) return null;
  return {
    state,
    model,
    contextTokens,
    lastPromptId: prompt?.id ?? null,
    lastPromptText: prompt?.text ?? null,
  };
}

function parseEntry(raw: string | undefined): OmpEntry | null {
  if (raw === undefined) return null;
  try {
    return JSON.parse(raw) as OmpEntry;
  } catch {
    return null;
  }
}

/** omp persists an assistant entry only once it completes, so a recorded
 *  `stopReason` means the turn ended and `toolUse` is its only working one; an
 *  assistant entry with no reason at all is a shape omp's writer cannot
 *  produce, and reads as in flight rather than a falsely completed turn.
 *  Interactive roles (`bashExecution`, `developer`, …) answer nothing, so the
 *  walk continues to the genuine prior turn. */
function stateOf(entry: OmpEntry): OmpInfo["state"] | null {
  if (entry.type !== "message") return null;
  const role = entry.message?.role;
  if (role === "assistant") {
    const stopReason = entry.message?.stopReason;
    if (stopReason === "toolUse") return "tool_use";
    return stopReason === undefined ? "thinking" : "waiting";
  }
  return role === "user" || role === "toolResult" ? "thinking" : null;
}

function modelOf(entry: OmpEntry): string | null {
  if (entry.type === "model_change" && typeof entry.model === "string") {
    return entry.model;
  }
  if (
    entry.type === "message" &&
    entry.message?.role === "assistant" &&
    typeof entry.message.model === "string"
  ) {
    return entry.message.model;
  }
  return null;
}

function contextTokensOf(entry: OmpEntry): number | null {
  if (entry.type !== "message" || entry.message?.role !== "assistant") {
    return null;
  }
  const usage = entry.message.usage;
  if (!usage) return null;
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
}

interface OmpPrompt {
  id: string;
  text: string | null;
}

/** omp writes a steer as a user entry only when the running turn takes it, so
 *  a new id whose text is the words said is the proof a steer landed —
 *  `agent_say` reads both, which is why they move together. */
function promptOf(entry: OmpEntry): OmpPrompt | null {
  if (
    entry.type !== "message" ||
    entry.message?.role !== "user" ||
    typeof entry.id !== "string"
  ) {
    return null;
  }
  return { id: entry.id, text: promptTextOfParts(entry.message.content) };
}

/** Tail window for the state fold. omp entries are many small lines, but a
 *  toolResult can carry a large output payload — 256 KB comfortably holds the
 *  last few turns and matches the other integrations' windows. */
export const TAIL_BYTES = 256 * 1024;

/** The title slot's fixed width. omp pads the line to exactly this many bytes,
 *  so reading it is a complete read of the slot — no line scan of a
 *  potentially huge transcript. */
export const TITLE_SLOT_BYTES = 256;

/** The session's display title, from the line-1 title slot.
 *
 *  Three answers, and the caller publishes only the first: a non-empty title,
 *  `null` when the slot carries none (a session omp has not titled yet, or one
 *  launched with `--no-title`), and `null` when the file is absent — the lazy
 *  session whose breadcrumb says `fresh`, which is why absence is not an error
 *  here. A slot that cannot be parsed, or that parses to something other than an
 *  object, is a fault and IS logged. */
export function readTitleSlot(file: string, log?: Logger): string | null {
  let head: string;
  try {
    const fd = fs.openSync(file, "r");
    try {
      const buf = Buffer.alloc(TITLE_SLOT_BYTES);
      const read = fs.readSync(fd, buf, 0, TITLE_SLOT_BYTES, 0);
      head = buf.toString("utf8", 0, read);
    } finally {
      fs.closeSync(fd);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: file }, "omp: title slot unreadable");
    }
    return null;
  }
  const line = head.split("\n")[0];
  if (!line) return null;
  let slot: unknown;
  try {
    slot = JSON.parse(line);
  } catch (err) {
    log?.error({ err, path: file }, "omp: title slot is not JSON");
    return null;
  }
  if (typeof slot !== "object" || slot === null) {
    log?.error({ path: file, slot }, "omp: title slot is not an object");
    return null;
  }
  const title = (slot as { title?: unknown }).title;
  return typeof title === "string" && title.length > 0 ? title : null;
}

/** Read the transcript tail, fold it, and read the title slot. Returns null
 *  when the file is absent (a lazy session whose JSONL has not materialized —
 *  the watcher's absent→present floor re-fires when it lands) or carries no
 *  turn entry yet. Hard read failures are logged and also yield null: the
 *  caller treats every null uniformly as "no publish this tick", never a state
 *  lie — the previously published info stands. */
export function deriveOmpInfo(
  session: OmpSession,
  log?: Logger,
): Pick<
  OmpInfo,
  | "state"
  | "model"
  | "contextTokens"
  | "summary"
  | "lastPromptId"
  | "lastPromptText"
> | null {
  let size: number;
  try {
    size = fs.statSync(session.transcriptPath).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error(
        { err, path: session.transcriptPath, session: session.id },
        "omp transcript stat failed",
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
        "omp transcript read failed",
      ),
  });
  if (!lines) return null;
  const folded = deriveOmpState(lines);
  if (folded === null) return null;
  return { ...folded, summary: readTitleSlot(session.transcriptPath, log) };
}

/** Watch a `terminal-sessions` directory and fire on any event in it. */
export function subscribeBreadcrumbDir(
  dir: string,
  onChange: () => void,
  onError: (err: unknown) => void,
  log?: Logger,
): () => void {
  return watchDirWhenReady(
    dir,
    () => {
      try {
        onChange();
      } catch (err) {
        onError(err);
      }
    },
    log,
  );
}
