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
 *  timeline. */

import {
  appendedText,
  type OrchestratorFrame,
  type OrchestratorRow,
  type OrchestratorSayingSchema,
} from "kolu-common/orchestrator";

type Saying = typeof OrchestratorSayingSchema.Type;

/** What the panel reads: the rows in conversation order, plus the `seq` of the
 *  last frame folded in (the writer's own ordering stamp, kept so a reader can
 *  tell a fresh stream's first frame from a continuation). */
export interface TranscriptState {
  readonly seq: number;
  readonly rows: readonly OrchestratorRow[];
}

export const EMPTY_TRANSCRIPT: TranscriptState = { seq: 0, rows: [] };

/** Splice one piece of streamed prose into the row it belongs to. The offset
 *  arithmetic is `appendedText`, shared with kolu-server's fold. The one case the data
 *  cannot repair is a piece that starts PAST the end — a frame went missing —
 *  so it is reported here rather than passed over in silence; the next snapshot
 *  is what actually fixes it. */
function appendSaying(
  rows: readonly OrchestratorRow[],
  saying: Saying,
): readonly OrchestratorRow[] {
  const index = rows.findIndex((row) => row.id === saying.of);
  if (index === -1) {
    console.warn(
      "orchestrator transcript: append for an unknown row",
      saying.of,
    );
    return rows;
  }
  const row = rows[index];
  if (row === undefined) return rows;
  // The plan row is the one kind with no `text` at all — it is replaced
  // wholesale on every update — so an append addressed to one is a producer bug,
  // and saying so beats silently growing a field the renderer never reads.
  if (row.kind === "plan") {
    console.warn(
      "orchestrator transcript: append addressed to a plan row",
      saying.of,
    );
    return rows;
  }
  const current = row.text;
  if (saying.at > current.length) {
    console.warn(
      "orchestrator transcript: append starts past the end of its row — a frame was lost",
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
  rows: readonly OrchestratorRow[],
  row: OrchestratorRow,
): readonly OrchestratorRow[] {
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
  frame: OrchestratorFrame,
): TranscriptState {
  if (frame.kind === "snapshot") {
    return {
      seq: frame.seq,
      rows: [...frame.rows].sort((a, b) => a.seq - b.seq),
    };
  }
  // REMOVES → UPSERTS → APPENDS, the order stated on `OrchestratorFrameSchema`
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
  readonly row: OrchestratorRow;
  readonly repeat: number;
}

/** Collapse every RUN of consecutive notices with identical text to the first
 *  of them, carrying the count.
 *
 *  The same rule kolu-server reads persisted dividers by (`oneDividerPerReset`,
 *  `server/src/orchestrator/persisted.ts`), and for the same reason: eight
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
  rows: readonly OrchestratorRow[],
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

/** ONE ROW as plain text — what the header menu's `Copy transcript` puts on
 *  the clipboard, per row.
 *
 *  The panel's own drawing is not reachable from a clipboard: a tool card is
 *  a component, a plan is a list of chips, an ask is a form. So each row is
 *  reduced to the sentence a person would have read out — who said it, and
 *  what it said — and the kinds that carry no prose say what KIND they were
 *  rather than disappearing, because a transcript with the tool calls
 *  silently removed reads as a conversation that never did anything. */
function rowText(row: OrchestratorRow): string {
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
export function transcriptText(rows: readonly OrchestratorRow[]): string {
  return rows.map(rowText).join("\n\n");
}
