/** omp core — pure functions and IO helpers for folding an oh-my-pi session
 *  transcript into live state.
 *
 *  omp stores one append-only JSONL file per session:
 *
 *    `<agent dir>/sessions/<encoded cwd>/<timestamp>_<uuid>.jsonl`
 *
 *  The file's FIRST line is a fixed-width 256-byte **title slot**, rewritten in
 *  place (`{"type":"title","v":1,"title":…,"source":"auto"|"user",…,"pad":…}`);
 *  the `session` header follows on line 2. Every later line is an entry with
 *  `{ type, id, parentId, timestamp, … }` forming a tree (in-file branching).
 *  Types kolu reads:
 *
 *   - `message` — the conversation: roles `user`, `assistant`, `toolResult`
 *     (plus `bashExecution` / `pythonExecution` / `developer` / `fileMention` —
 *     interactive artifacts, not model turns, walked past like pi's).
 *   - `model_change` — the user switched models mid-session (its field is
 *     **`model`**, where pi's fork spells it `modelId`).
 *
 *  Everything else (`custom` tool-execution markers, `thinking_level_change`,
 *  `title_change`, `compaction`, …) is state-derivation or extension material
 *  and is skipped by the fold's `type === "message"` gate.
 *
 *  An assistant message is persisted only when it completes (a mid-turn tail
 *  ends on `user` or `toolResult`, never on a half-written assistant entry),
 *  which is what makes a tail fold honest.
 *
 *  Structure note: this file holds the leaf module. Peers `session-watcher.ts`
 *  and `agent-adapter.ts` import from here; `index.ts` is a pure barrel. */

import fs from "node:fs";
import { watchDirWhenReady } from "kolu-io";
import type { Logger } from "kolu-shared";
import { readTailLines } from "kolu-shared";
import type { OmpInfo } from "./schemas.ts";
import type { OmpSession } from "./breadcrumb.ts";

// --- State fold (pure) ---

/** The slice of an omp entry the fold reads. Entries carry far more; reading
 *  only these fields keeps upstream additions incapable of breaking the
 *  parse. */
interface OmpEntry {
  type?: string;
  /** `model_change` entries (`model`, not pi's `modelId`). */
  model?: string;
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
 *
 *  Pure — unit-testable without touching the filesystem. Returns null when the
 *  tail carries no turn entry at all (a file with only its title slot and
 *  header): "nothing to publish yet", never a fabricated state. */
export function deriveOmpState(lines: string[]): {
  state: OmpInfo["state"];
  model: string | null;
  contextTokens: number | null;
} | null {
  let state: OmpInfo["state"] | null = null;
  let model: string | null = null;
  let contextTokens: number | null = null;

  for (let i = lines.length - 1; i >= 0; i--) {
    const raw = lines[i];
    if (raw === undefined) continue;
    // The walk's terminal condition, stated once: every independent projection
    // has an answer. Below, each line is offered to whichever projection is
    // still unset — three "first unset slot wins" readers of one parsed line,
    // each verifiable without the others.
    if (state !== null && model !== null && contextTokens !== null) break;
    let entry: OmpEntry;
    try {
      entry = JSON.parse(raw) as OmpEntry;
    } catch {
      continue; // partial trailing write / malformed line — skip
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

    if (state === null && entry.type === "message") {
      const role = entry.message?.role;
      if (role === "assistant") {
        const stopReason = entry.message?.stopReason;
        // omp persists an assistant entry only on COMPLETION, so any recorded
        // stopReason means the turn ended and `toolUse` is the only WORKING
        // reason. No table to drift against: a vocabulary upstream adds still
        // classifies as the turn ended. NO reason is the torn write — a
        // completion record caught mid-append genuinely means in flight.
        state =
          stopReason === "toolUse"
            ? "tool_use"
            : stopReason === undefined
              ? "thinking"
              : "waiting";
      } else if (role === "user" || role === "toolResult") {
        // A human prompt just landed, or a tool returned and the model is
        // about to be re-invoked — omp persists assistant messages only on
        // completion, so both read as work in flight.
        state = "thinking";
      }
      // bashExecution / pythonExecution / developer / fileMention: interactive
      // artifacts — walk past to the genuine prior turn.
    }
  }

  if (state === null) return null;
  return { state, model, contextTokens };
}

// --- Tail reading ---

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
 *  object, is a fault and IS logged — the difference between "not titled yet"
 *  and "corrupt slot" must not be invisible. */
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
  // Clamp the window to the head: `readTailLines` starts at `size - maxBytes`,
  // so a size of at most one slot makes byte 0 the window's start and the FIRST
  // line the slot (the claude-code precedent for a head read). The shared helper
  // owns the FD lifetime — the hand-rolled open/read/close this replaces leaked
  // the descriptor on a throwing read.
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
): Pick<OmpInfo, "state" | "model" | "contextTokens" | "summary"> | null {
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

// --- Breadcrumb-directory watcher (externalChanges) ---

/** Watch a `terminal-sessions` directory and fire on any event in it.
 *
 *  Why a directory watch and not the transcript: omp writes its breadcrumb
 *  when a session is created or switched — including the rewrite that lands
 *  when `omp` starts in a tty that still carried an earlier session's crumb
 *  (`omp -c`'s own anchor). The foreground preexec hint fires BEFORE that
 *  rewrite, so without this signal a terminal would stay bound to the previous
 *  session until some other event arrived. The ONLY writes into this directory
 *  are breadcrumbs (one small file per tty), so every event is a match-relevant
 *  change — unlike a session store, where content appends are the per-session
 *  traffic `externalChanges` must not report.
 *
 *  `watchDirWhenReady` carries the ancestor-wait, so a directory that does not
 *  exist yet re-arms all the way up instead of dying at install time —
 *  `externalChanges.install` runs at most once per process, so a failed install
 *  would blind detection for the daemon's lifetime. */
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
