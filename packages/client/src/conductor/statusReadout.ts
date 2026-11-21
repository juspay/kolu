/** THE ONE STATUS LINE's words — what the conversation is doing, what it is
 *  doing it to, and for how long.
 *
 *  TWO DERIVATIONS, not one. What it is doing is read off the TRANSCRIPT (the
 *  running call of the turn in flight, else what that turn last said); how
 *  long is counted from `busySince` against a ticking clock. They are
 *  separate functions because the clock ticks once a second and the
 *  transcript does not: a single fold would have every tick re-walk the rows
 *  and re-make the whole readout, for a number beside words that did not
 *  change.
 *
 *  They are derived here rather than in the component because both are
 *  judgements and not fields, and this line is the one place a person looks
 *  to answer "is it stuck?".
 *
 *  The STATE WORD is the cell's `phase` verbatim — `idle`, `working`,
 *  `asking`, `starting`, `offline` — because that word was the header chip's
 *  and a person who learned it there must not have to learn a second
 *  vocabulary when the chip moved above the composer. */

import type { ConductorRow, ConductorState } from "kolu-common/conductor";
import { elapsedSince } from "../time/duration";
import { COMPACTING } from "./compactionWords";
import { toolLabel } from "./toolCard";
import { chatTurns } from "./turnWorks";

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

/** WHAT IT IS DOING, from the turn in flight and nothing else: the newest
 *  tool call still out, else the newest thing the agent said IN THAT TURN.
 *  `null` when the turn has neither — a turn that has started and not yet
 *  spoken, which leaves the line reading `working · 34s`.
 *
 *  THE TURN IN FLIGHT is the newest turn whose message is not still waiting
 *  behind another (`queued`), read through `./turnWorks.ts`'s `chatTurns` —
 *  the one turn boundary every reading of the chat shares. A message sent
 *  while a reply is still being written waits LAST in the chat, so a walk up
 *  from the last row met it first and stopped there, and the line went blank
 *  while that reply went on. Nothing of an earlier turn is read: a turn whose
 *  rows are all settled calls and forms must not report an answer given two
 *  turns ago as the thing happening now. A DIVIDER inside the turn's rows
 *  ends the walk too — what is above it is a conversation the agent no longer
 *  has. A running call still outranks prose, because a sentence the agent
 *  finished saying before it made the call is not what it is doing.
 *
 *  THE QUESTION CALL IS NOT A CALL IN FLIGHT. The call behind an elicitation
 *  form sits `pending` for exactly as long as that form is on screen waiting
 *  for a person, so naming it here put the machinery's own name on the line
 *  (`asking · <the agent's question tool>`) while the thing actually happening
 *  was the form the reader was already looking at. The same row the transcript
 *  refuses to draw a card for, refused by the same fact the harness put on it
 *  (`asksThroughForm`): the form IS the question, and the line says what the
 *  turn said before it instead. */
export function conductorDoing(rows: readonly ConductorRow[]): string | null {
  const running = chatTurns(rows).findLast(
    ({ head }) =>
      !((head.kind === "user" || head.kind === "wake") && head.queued === true),
  );
  if (running === undefined) return null;
  /** The latest prose of this turn, held while the walk keeps looking for a
   *  call still out beneath it. */
  let said: string | null = null;
  for (let i = running.rows.length - 1; i >= 0; i--) {
    const row = running.rows[i];
    if (row === undefined) continue;
    if (row.kind === "divider") break;
    if (row.kind === "compaction" && row.state === "running") return COMPACTING;
    if (
      row.kind === "tool" &&
      row.asksThroughForm !== true &&
      (row.status === "pending" || row.status === "in_progress")
    ) {
      return toolLabel(row);
    }
    if (row.kind === "agent" && said === null) said = headline(row.text);
  }
  return said;
}

/** WHAT IT IS DOING, as the line draws it — `null` when there is nothing to
 *  name. Only a RUNNING turn has something in flight to name: an idle
 *  conversation's last sentence is still on screen above the composer, and
 *  repeating it in the status line would read as work still going on.
 *
 *  Depends on the rows and the phase, never on the clock. */
export function statusDetail(
  phase: ConductorState["phase"],
  rows: readonly ConductorRow[],
): string | null {
  return phase === "working" ? conductorDoing(rows) : null;
}

/** HOW LONG the turn in flight has been running (`2m 14s`), from `busySince`
 *  against `nowMs` — the ticking clock, passed in so this stays pure and a
 *  test can place the instant. `null` while nothing is running: there is no
 *  turn to age, and the line draws nothing at all.
 *
 *  A stamp that does not parse — or one in this browser's past-by-skew future
 *  — is the shared dash, not a hole: `elapsedSince` is the one reading of a
 *  wire stamp this app has, and a clock it cannot trust says so out loud
 *  rather than letting the line quietly lose its duration.
 *
 *  The one thing on this line the tick may move. */
export function statusSince(
  phase: ConductorState["phase"],
  busySince: string | null,
  nowMs: number,
): string | null {
  if (phase !== "working" && phase !== "asking") return null;
  return busySince === null ? null : elapsedSince(busySince, nowMs);
}
