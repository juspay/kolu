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
 *  identical notices draws as one (`foldNoticeRuns`), the settled tool calls
 *  between two boundaries fold into one "Details" as they settle
 *  (`foldToolRuns`), and the same failure in a row draws as one line with its
 *  count (`foldFailureRuns`). All three are pure, so what the panel draws is
 *  decided in a unit test, and none rewrites a row — `Copy transcript` still
 *  reads them all. */

import {
  appendedText,
  type ConductorFrame,
  type ConductorRow,
  type ConductorSayingSchema,
  type ConductorToolRow,
} from "kolu-common/conductor";
import {
  agentLineSubject,
  callSubject,
  failureReason,
  toolLabel,
} from "./toolCard";

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
 *  already folded to one), a FOLD — a closed "Details" holding the settled
 *  tool calls of one stretch of the Conductor's work — or a FAILURE RUN, the
 *  same failure several times in a row, drawn as one line with its count.
 *  `key` is what the list is keyed by: a row's own id; for a fold the id of the
 *  boundary that OPENS its run ({@link FOLD_AT_TOP} for the top of the
 *  transcript) — which exists from the run's first call on and never changes
 *  after, however many calls settle into it and whatever closes it later; and
 *  for a failure run the id of its first failure. */
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
    }
  | {
      readonly kind: "failures";
      readonly key: string;
      /** The tool, as its cards name it. */
      readonly tool: string;
      /** The reason they share, with the terminal each one was about taken
       *  out — the one thing that differs between them. */
      readonly reason: string;
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

/** The key of a fold whose run opens the transcript: no row precedes it. */
const FOLD_AT_TOP = "fold:top";

/** Fold the machinery out of the way AS IT GOES: the settled calls of a RUN of
 *  tool rows are ONE closed "Details" carrying its count, so the conversation
 *  reads as the sentences it is — while the Conductor is still working, too.
 *  The count grows as more calls settle.
 *
 *  A run is everything between two BOUNDARIES — an `agent`, `user`, `wake` or
 *  `divider` row, or the top of the transcript — and nothing folds across
 *  one, so a fold never swallows a message of yours or outlives a session.
 *  Rows inside a run that are not plain tool calls (a question, the plan card,
 *  a notice) and calls that {@link staysInFlow} keep their own place in the
 *  flow; the fold takes the place of the FIRST call it holds. */
export function foldToolRuns(
  entries: readonly TranscriptEntry[],
): readonly TranscriptItem[] {
  const items: TranscriptItem[] = [];
  const asItem = (entry: TranscriptEntry): TranscriptItem => ({
    kind: "entry",
    key: entry.row.id,
    entry,
  });
  const foldable = (row: ConductorRow): row is ConductorToolRow =>
    row.kind === "tool" && !staysInFlow(row);
  let run: TranscriptEntry[] = [];
  let key = FOLD_AT_TOP;

  const flush = () => {
    const folded = run.map((one) => one.row).filter(foldable);
    let placed = folded.length === 0;
    for (const one of run) {
      if (!foldable(one.row)) items.push(asItem(one));
      else if (!placed) {
        items.push({ kind: "fold", key, rows: folded });
        placed = true;
      }
    }
    run = [];
  };

  for (const entry of entries) {
    const kind = entry.row.kind;
    // A WAKE is a boundary like a message of yours, and for the same reason:
    // it STARTS a turn. The calls before it belong to the work that was
    // running when the terminal rang, and a fold that reached across it would
    // put the Conductor's answer to the wake in the same closed "Details" as
    // whatever it had been doing beforehand.
    if (
      kind !== "agent" &&
      kind !== "user" &&
      kind !== "divider" &&
      kind !== "wake"
    ) {
      run.push(entry);
      continue;
    }
    flush();
    items.push(asItem(entry));
    key = `fold:${entry.row.id}`;
  }
  flush();
  return items;
}

/** One failed call that said why, as the run rule compares it. */
interface Failure {
  readonly tool: string;
  readonly reason: string;
  readonly row: ConductorToolRow;
}

/** What makes two failures THE SAME failure: the tool, and its reason with
 *  the terminal it was about taken out — so "Terminal A not found" and
 *  "Terminal B not found" match. `null` for anything that is not a failed call
 *  that said why. */
function failureOf(item: TranscriptItem): Failure | null {
  if (item.kind !== "entry" || item.entry.row.kind !== "tool") return null;
  const row = item.entry.row;
  const said = failureReason(row);
  if (said === null) return null;
  const subject = callSubject(row.kolu);
  const reason = (
    subject === null
      ? said
      : said
          .replaceAll(`${subject.host}/${subject.id}`, "")
          .replaceAll(subject.id, "")
  )
    .replace(/\s+/g, " ")
    .trim();
  return { tool: toolLabel(row), reason, row };
}

/** The same failure IN A ROW draws as one line carrying its count —
 *  "screen_text failed 6 times: …" — that opens to the individual cards. The
 *  notice rule's idea (`foldNoticeRuns`) applied to failed calls: a failure is
 *  still news, so this is not the Details fold and it stays in the flow; it
 *  only stops saying the same thing six times. "In a row" is as DRAWN:
 *  anything drawn between two failures — the Details fold, a boundary, a
 *  running call, a different failure — separates them, and a settled call
 *  that joined a fold drawn earlier does not. One failure on its own is drawn
 *  as it was. */
export function foldFailureRuns(
  items: readonly TranscriptItem[],
): readonly TranscriptItem[] {
  const out: TranscriptItem[] = [];
  /** The failures drawn in a row so far, all THE SAME one. */
  let run: { item: TranscriptItem; failure: Failure }[] = [];

  const flush = () => {
    const [first] = run;
    if (first !== undefined && run.length === 1) out.push(first.item);
    if (first !== undefined && run.length > 1) {
      out.push({
        kind: "failures",
        key: `failures:${first.failure.row.id}`,
        tool: first.failure.tool,
        reason: first.failure.reason,
        rows: run.map((one) => one.failure.row),
      });
    }
    run = [];
  };

  for (const item of items) {
    const failure = failureOf(item);
    const last = run.at(-1)?.failure;
    if (
      failure === null ||
      last === undefined ||
      failure.tool !== last.tool ||
      failure.reason !== last.reason
    ) {
      flush();
    }
    if (failure === null) out.push(item);
    else run.push({ item, failure });
  }
  flush();
  return out;
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
    case "wake":
      // The ACCOUNT, not the headline: a transcript pasted into an issue is
      // read by somebody reconstructing what the agent was told, and the
      // headline is this browser's summary of it.
      return `${row.from}: ${row.text}`;
  }
}

/** The whole conversation as text, in the order it is drawn in. A blank line
 *  between rows, because two rows run together are one paragraph to whoever
 *  pastes this into an issue. */
export function transcriptText(rows: readonly ConductorRow[]): string {
  return rows.map(rowText).join("\n\n");
}
