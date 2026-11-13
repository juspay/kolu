/** THE ONE STATUS LINE's words — what the conversation is doing, what it is
 *  doing it to, and for how long.
 *
 *  It is derived here rather than in the component because all three are
 *  judgements and not fields: the phase is on the cell, but "what it is doing"
 *  is read off the TRANSCRIPT (the newest call still out, else the last thing
 *  it said) and the duration is counted from `busySince` against a ticking
 *  clock. A component that did this inline would be a component nothing could
 *  pin, and this line is the one place a person looks to answer "is it stuck?".
 *
 *  The STATE WORD is the cell's `phase` verbatim — `idle`, `working`,
 *  `asking`, `starting`, `offline` — because that word was the header chip's
 *  and a person who learned it there must not have to learn a second
 *  vocabulary when the chip moved above the composer. */

import type { ConductorRow, ConductorState } from "kolu-common/conductor";
import { formatElapsedShort } from "../time/duration";
import { toolLabel } from "./toolCard";

/** How much of a spoken line the status row carries. Past this the line is
 *  a paragraph, and the status row is one line beside two buttons — on a
 *  390px phone it is barely that. The cut is here, not in CSS, so the string
 *  a test reads is the string a person reads. */
const DETAIL_LIMIT = 72;

/** The first line of a block of prose, trimmed and cut to {@link DETAIL_LIMIT}.
 *  `null` when there is nothing left after the trim — a row whose text has not
 *  started streaming yet says nothing rather than drawing an empty `·`. */
function headline(text: string): string | null {
  const first = text.split("\n")[0]?.trim() ?? "";
  if (first === "") return null;
  return first.length <= DETAIL_LIMIT
    ? first
    : `${first.slice(0, DETAIL_LIMIT - 1).trimEnd()}…`;
}

/** WHAT IT IS DOING, from the transcript as it stands: the newest tool call
 *  still out, else the newest thing the agent said. The walk is backwards and
 *  stops at the first of either, so a settled call does not hide the words
 *  under it and a sentence from five minutes ago never outranks a call that is
 *  running now. `null` when the conversation has neither — a turn that has
 *  started and not yet spoken. */
export function conductorDoing(rows: readonly ConductorRow[]): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row === undefined) continue;
    if (
      row.kind === "tool" &&
      (row.status === "pending" || row.status === "in_progress")
    ) {
      return toolLabel(row);
    }
    if (row.kind === "agent") return headline(row.text);
  }
  return null;
}

/** The status line, as it is drawn. */
export interface StatusReadout {
  /** The phase word itself — the chip's vocabulary, unchanged. */
  readonly state: ConductorState["phase"];
  /** What it is doing, when it is doing something nameable. */
  readonly detail: string | null;
  /** How long the turn in flight has been running (`2m 14s`), from
   *  `busySince`. `null` while nothing is running, and `null` for a stamp that
   *  does not parse — an invented duration is worse than none. */
  readonly since: string | null;
}

/** Fold the cell and the transcript into the line. `nowMs` is the ticking
 *  clock the caller reads, passed in so this stays pure and a test can place
 *  the instant. */
export function statusReadout(
  state: Pick<ConductorState, "phase" | "busySince">,
  rows: readonly ConductorRow[],
  nowMs: number,
): StatusReadout {
  const running = state.phase === "working" || state.phase === "asking";
  const at =
    state.busySince === null ? Number.NaN : Date.parse(state.busySince);
  return {
    state: state.phase,
    // Only a RUNNING turn has something in flight to name. An idle
    // conversation's last sentence is still on screen above the composer;
    // repeating it in the status line would read as work still going on.
    detail: state.phase === "working" ? conductorDoing(rows) : null,
    since:
      running && !Number.isNaN(at)
        ? formatElapsedShort(Math.max(0, nowMs - at))
        : null,
  };
}
