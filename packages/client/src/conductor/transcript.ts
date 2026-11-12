/** The transcript REDUCER — the one place a wire frame becomes the row list the
 *  panel draws.
 *
 *  The member is explicitly discriminated (`{kind:"snapshot"|"delta"}`) for a
 *  reason this file has to honour: the framework's retry fence re-runs a dropped
 *  stream from the top, so the first frame after a reconnect is a FULL
 *  replacement. A snapshot therefore ASSIGNS — it never merges — and only a
 *  delta upserts, removes and appends. Merging a replayed snapshot into a
 *  populated map is how every row comes to exist twice.
 *
 *  Rows are kept in `seq` order rather than arrival order: a delta may refine a
 *  row minted long ago (a tool call completing, a plan replaced), and a reader
 *  that appended refinements would scatter one conversation across its own
 *  timeline.
 *
 *  The READER RULES live here too, beside the rows they read: a run of
 *  identical notices draws as one (`foldNoticeRuns`), and the tool calls the
 *  Conductor's prose closes fold into one "Details"
 *  (`foldToolRuns`). Both are pure, so what the panel draws is decided in a
 *  unit test, and neither rewrites a row — `Copy transcript` still reads them
 *  all. */

import {
  appendedText,
  type ConductorFrame,
  type ConductorRow,
  type ConductorSayingSchema,
  type ConductorToolRow,
} from "kolu-common/conductor";
import { agentLineSubject } from "./toolCard";

type Saying = typeof ConductorSayingSchema.Type;

/** What the panel reads: the rows in conversation order, plus the `seq` of the
 *  last frame folded in (the writer's own ordering stamp, kept so a reader can
 *  tell a fresh stream's first frame from a continuation). */
export interface TranscriptState {
  readonly seq: number;
  readonly rows: readonly ConductorRow[];
}

export const EMPTY_TRANSCRIPT: TranscriptState = { seq: 0, rows: [] };

/** Splice one piece of streamed prose into the row it belongs to. The offset
 *  arithmetic is `appendedText`, shared with kolu-server's fold. The one case the data
 *  cannot repair is a piece that starts PAST the end — a frame went missing —
 *  so it is reported here rather than passed over in silence; the next snapshot
 *  is what actually fixes it. */
function appendSaying(
  rows: readonly ConductorRow[],
  saying: Saying,
): readonly ConductorRow[] {
  const index = rows.findIndex((row) => row.id === saying.of);
  if (index === -1) {
    console.warn("conductor transcript: append for an unknown row", saying.of);
    return rows;
  }
  const row = rows[index];
  if (row === undefined) return rows;
  // The plan row is the one kind with no `text` at all — it is replaced
  // wholesale on every update — so an append addressed to one is a producer bug,
  // and saying so beats silently growing a field the renderer never reads.
  if (row.kind === "plan") {
    console.warn(
      "conductor transcript: append addressed to a plan row",
      saying.of,
    );
    return rows;
  }
  const current = row.text;
  if (saying.at > current.length) {
    console.warn(
      "conductor transcript: append starts past the end of its row — a frame was lost",
      { row: saying.of, at: saying.at, have: current.length },
    );
  }
  const next = rows.slice();
  next[index] = {
    ...row,
    text: appendedText(current, saying.at, saying.text),
  };
  return next;
}

/** Insert or replace one row, keeping the list ordered by `seq`. A row's `seq`
 *  is stable for its lifetime, so a refinement lands exactly where the original
 *  did: the scan below finds the row by id first, and only a genuinely new row
 *  walks for its `seq` position. A linear walk, not a bisection — a transcript
 *  is a few hundred rows and a new row almost always belongs at the end, which
 *  the walk reaches in one pass over a list the renderer iterates anyway. */
function upsert(
  rows: readonly ConductorRow[],
  row: ConductorRow,
): readonly ConductorRow[] {
  const at = rows.findIndex((existing) => existing.id === row.id);
  if (at !== -1) {
    const next = rows.slice();
    next[at] = row;
    return next;
  }
  const before = rows.findIndex((existing) => existing.seq > row.seq);
  const next = rows.slice();
  next.splice(before === -1 ? next.length : before, 0, row);
  return next;
}

/** Fold one wire frame into the current state. Pure — the panel's store wraps
 *  it, and the unit tests drive it with hand-built frames. */
export function applyFrame(
  prev: TranscriptState,
  frame: ConductorFrame,
): TranscriptState {
  if (frame.kind === "snapshot") {
    return {
      seq: frame.seq,
      rows: [...frame.rows].sort((a, b) => a.seq - b.seq),
    };
  }
  // REMOVES → UPSERTS → APPENDS, the order stated on `ConductorFrameSchema`
  // and obeyed by kolu-server's own fold of the same frame. It is the only order that
  // reads a frame as "this is what the conversation is now": a row the producer
  // retired and re-minted in one frame (an ask settled and re-asked) survives,
  // and a piece of prose can address a row the same frame just created.
  let rows = prev.rows;
  if (frame.removes.length > 0) {
    const gone = new Set(frame.removes);
    rows = rows.filter((row) => !gone.has(row.id));
  }
  for (const row of frame.upserts) rows = upsert(rows, row);
  for (const saying of frame.appends) rows = appendSaying(rows, saying);
  return { seq: frame.seq, rows };
}

/** One row as the panel DRAWS it: the row, and how many identical ones in a
 *  row it stands for. `repeat` is 1 for everything that is not a run. */
export interface TranscriptEntry {
  readonly row: ConductorRow;
  readonly repeat: number;
}

/** Collapse every RUN of consecutive notices with identical text to the first
 *  of them, carrying the count.
 *
 *  The same rule kolu-server reads persisted dividers by (`oneDividerPerReset`,
 *  `server/src/conductor/persisted.ts`), and for the same reason: eight
 *  `the agent exited (code 0, signal none)` rows in a row are one fact written
 *  eight times by a loop, and a transcript that already carries them must stop
 *  showing eight of them — a reader rule, so nothing is re-minted and nothing
 *  on disk is rewritten. ADJACENT only: the same sentence an hour later is a
 *  second event and keeps its own row, because what makes a run one fact is
 *  that nothing happened between them.
 *
 *  The first is kept, because that is when it happened — and because its id is
 *  the one the list is keyed by, so a run that grows does not re-create the
 *  subtree it is drawn in. */
export function foldNoticeRuns(
  rows: readonly ConductorRow[],
): readonly TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const row of rows) {
    const last = entries[entries.length - 1];
    if (
      last !== undefined &&
      row.kind === "notice" &&
      last.row.kind === "notice" &&
      last.row.text === row.text
    ) {
      entries[entries.length - 1] = { row: last.row, repeat: last.repeat + 1 };
      continue;
    }
    entries.push({ row, repeat: 1 });
  }
  return entries;
}

/** One thing the transcript DRAWS, in order: an entry (a row, a notice run
 *  already folded to one), or a FOLD — a closed "Details" holding the tool
 *  calls a stretch of the Conductor's work made before it next spoke. `key`
 *  is what the list is keyed by: a row's own id, and for a fold the id of the
 *  prose that CLOSES it — which exists exactly when the fold does and never
 *  changes after, however many calls settle into it. */
export type TranscriptItem =
  | {
      readonly kind: "entry";
      readonly key: string;
      readonly entry: TranscriptEntry;
    }
  | {
      readonly kind: "fold";
      readonly key: string;
      readonly rows: readonly ConductorToolRow[];
    };

/** Does this tool call stay IN THE FLOW rather than joining a fold? Each arm
 *  is something a reader would lose by having to open a disclosure for it:
 *   - a call still RUNNING keeps its clock where it can be seen, and joins the
 *     fold the moment it settles;
 *   - a FAILED or STRANDED call is news, never machinery;
 *   - a BACKGROUND TASK still out is live work, and the strip's reveal points
 *     at its row;
 *   - a create card that names its terminal is the agent line — its status
 *     and its Look are the point of drawing it. */
function staysInFlow(row: ConductorToolRow): boolean {
  if (row.status === "pending" || row.status === "in_progress") return true;
  if (row.status === "failed" || row.stranded === true) return true;
  if (row.armed !== undefined && row.armed.ended === null) return true;
  return agentLineSubject(row) !== null;
}

/** Fold the machinery out of the way: a RUN of tool rows that the Conductor's
 *  prose CLOSES becomes ONE closed "Details" carrying its count, so the
 *  conversation reads as the sentences it is.
 *
 *  A run is everything since the last `agent`, `user` or `divider` row (or the
 *  top of the transcript) — so a turn that STARTS with tool calls, right after
 *  the human's message, folds too, once the Conductor says something. What
 *  opened the run does not matter; what a person typed and a session divider
 *  still END one, so nothing is ever folded across a message of yours. Rows
 *  inside a run that are not plain tool calls (a question, the plan card, a
 *  notice) and calls that {@link staysInFlow} keep their own place in the
 *  flow; the fold takes the place of the FIRST call it holds.
 *
 *  A run with no closing prose yet does not fold: the turn is still going, or
 *  ended without a word, and in either case those calls are the latest thing
 *  on screen. They fold the moment the Conductor speaks. */
export function foldToolRuns(
  entries: readonly TranscriptEntry[],
): readonly TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const asItem = (entry: TranscriptEntry): TranscriptItem => ({
    kind: "entry",
    key: entry.row.id,
    entry,
  });
  let run: TranscriptEntry[] = [];

  for (const entry of entries) {
    const kind = entry.row.kind;
    if (kind !== "agent" && kind !== "user" && kind !== "divider") {
      run.push(entry);
      continue;
    }
    // The ONE question, asked of each row of the run: does it go into the fold
    // this row closes? Only prose closes a fold, so after a message or a
    // divider the answer is no for every row.
    const foldable = (row: ConductorRow): row is ConductorToolRow =>
      kind === "agent" && row.kind === "tool" && !staysInFlow(row);
    const folded = run.map((one) => one.row).filter(foldable);
    let placed = folded.length === 0;
    for (const one of run) {
      if (foldable(one.row)) {
        if (!placed) {
          items.push({
            kind: "fold",
            key: `fold:${entry.row.id}`,
            rows: folded,
          });
          placed = true;
        }
        continue;
      }
      items.push(asItem(one));
    }
    items.push(asItem(entry));
    run = [];
  }
  items.push(...run.map(asItem));
  return items;
}

/** ONE ROW as plain text — what the header menu's `Copy transcript` puts on
 *  the clipboard, per row.
 *
 *  The panel's own drawing is not reachable from a clipboard: a tool card is
 *  a component, a plan is a list of chips, an ask is a form. So each row is
 *  reduced to the sentence a person would have read out — who said it, and
 *  what it said — and the kinds that carry no prose say what KIND they were
 *  rather than disappearing, because a transcript with the tool calls
 *  silently removed reads as a conversation that never did anything. */
function rowText(row: ConductorRow): string {
  switch (row.kind) {
    case "user":
      return `you: ${row.text}`;
    case "agent":
      return `agent: ${row.text}`;
    case "plan":
      return [
        "plan:",
        ...row.steps.map((step) => `  [${step.status}] ${step.content}`),
      ].join("\n");
    case "tool":
      return `tool: ${row.text} [${row.status}]`;
    case "ask":
      return `ask: ${row.text}`;
    case "notice":
      return `note: ${row.text}`;
    case "divider":
      return `— ${row.text} —`;
  }
}

/** The whole conversation as text, in the order it is drawn in. A blank line
 *  between rows, because two rows run together are one paragraph to whoever
 *  pastes this into an issue. */
export function transcriptText(rows: readonly ConductorRow[]): string {
  return rows.map(rowText).join("\n\n");
}
