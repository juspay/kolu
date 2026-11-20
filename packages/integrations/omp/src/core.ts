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
 *  One backward walk tracking three independent signals with different
 *  stopping conditions —
 *
 *   - state: first `message` entry that participates in a model turn.
 *     `assistant stopReason toolUse` → `tool_use`; ANY other recorded reason →
 *     `waiting` (omp persists an assistant entry only on completion, so the
 *     record's existence IS the answer); an assistant entry with no reason
 *     recorded (a torn write) or a `user` / `toolResult` tail → `thinking`
 *     (the model is running or about to be re-invoked). Interactive roles are
 *     walked past, so a trailing compaction or extension entry while omp sits
 *     idle reads the prior turn rather than fabricating work.
 *   - model: newest of a `model_change` entry's `model` (the user's explicit
 *     switch, which is also written at an idle prompt) and the newest assistant
 *     entry's own `message.model`. Read on every entry, independent of the
 *     state gate, so an in-flight thinking tail still carries the badge.
 *   - contextTokens: newest assistant entry's usage
 *     (`input + cacheRead + cacheWrite`). Read on every entry, so the turn's own
 *     assistant record accounts rather than one hop back.
 *   - lastPromptId / lastPromptText: the newest `user` message entry's `id`
 *     and its text. omp writes a steer as a user entry only when the running
 *     turn TAKES it, so a new id whose text is the words said is the proof a
 *     steer landed — `agent_say` reads both.
 *
 *  Pure — unit-testable without touching the filesystem. Returns null when the
 *  tail carries no turn entry at all (a file with only its title slot and
 *  header): "nothing to publish yet", never a fabricated state. */
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
  let lastPromptId: string | null = null;
  let lastPromptText: string | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw === undefined) continue;
    if (
      state !== null &&
      model !== null &&
      contextTokens !== null &&
      lastPromptId !== null
    )
      break;
    let entry: OmpEntry;
    try {
      entry = JSON.parse(raw) as OmpEntry;
    } catch {
      continue;
    }

    if (model === null) {
      if (entry.type === "model_change" && typeof entry.model === "string") {
        model = entry.model;
      } else if (
        entry.type === "message" &&
        entry.message?.role === "assistant" &&
        typeof entry.message.model === "string"
      ) {
        model = entry.message.model;
      }
    }

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

    if (
      lastPromptId === null &&
      entry.type === "message" &&
      entry.message?.role === "user" &&
      typeof entry.id === "string"
    ) {
      lastPromptId = entry.id;
      lastPromptText = promptTextOfParts(entry.message.content);
    }

    if (state === null && entry.type === "message") {
      const role = entry.message?.role;
      if (role === "assistant") {
        const stopReason = entry.message?.stopReason;
        state =
          stopReason === "toolUse"
            ? "tool_use"
            : stopReason === undefined
              ? "thinking"
              : "waiting";
      } else if (role === "user" || role === "toolResult") {
        state = "thinking";
      }
    }
  }

  if (state === null) return null;
  return { state, model, contextTokens, lastPromptId, lastPromptText };
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
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log?.error({ err, path: file }, "omp: title slot unreadable");
    }
    return null;
  }
  const lines = readTailLines({
    path: file,
    size: Math.min(size, TITLE_SLOT_BYTES),
    maxBytes: TITLE_SLOT_BYTES,
    onError: (err) =>
      log?.error({ err, path: file }, "omp: title slot unreadable"),
  });
  const line = lines?.[0];
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
