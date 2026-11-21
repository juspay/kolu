/** THE REPLY TO A MESSAGE A PERSON TYPED, once it is finished — what
 *  attention rings for when they have left the conversation.
 *
 *  Read off the chat this page already holds and the one fact it cannot
 *  say for itself: whether a turn is running. Nothing is asked of the
 *  server for it. */

import type { ConductorRow } from "kolu-common/conductor";
import type { WorkId } from "kolu-work";
import { type Accessor, createSignal, onCleanup } from "solid-js";
import { type ChatTurn, chatTurns, ran } from "./turnWorks";

/** A finished reply: the row that started its turn, and its words. */
export interface FinishedReply {
  readonly turn: string;
  readonly text: string;
}

/** ...and the one piece of work the message was about, when it was about
 *  exactly one. */
export interface TypedReply extends FinishedReply {
  readonly work: WorkId | null;
}

/** A turn the agent actually took up, started by a message — `./turnWorks.ts`'s
 *  {@link ran}, the rule the status line and a turn's window use, over the
 *  turns a message started. */
const tookUp = (turn: ChatTurn): boolean =>
  (turn.head.kind === "user" || turn.head.kind === "wake") && ran(turn);

/** THE NEWEST FINISHED TURN'S REPLY, when a person started that turn.
 *
 *  While a turn is running (`busy`) the newest turn that ran is the one
 *  still running, so a finished reply is the one before it — and that one is
 *  read only when the running turn is kolu's own wake-up. When the running
 *  turn is a person's, nothing rings: whether the reply to their earlier
 *  message should ring while their next one is being answered is not decided
 *  here. A message waiting behind a running turn (`queued`) has not run, so
 *  it is not the newest turn that ran; a message steered INTO a running turn
 *  is part of that turn and starts none (`./turnWorks.ts`'s `chatTurns`). In
 *  a chat saved before rows said which message they answer, a steered message
 *  still reads as a turn of its own with the rest of the reply under it.
 *
 *  `null` when that turn was not started by a person, when it said nothing,
 *  when its last words are still streaming, and when it put a question: the
 *  question rings for itself. */
export function finishedReplyOf(
  rows: readonly ConductorRow[],
  busy: boolean,
): FinishedReply | null {
  const turns = chatTurns(rows).filter(tookUp);
  const newest = turns.at(-1);
  // WHILE A TURN RUNS, the turn before the newest is over for certain only
  // when kolu started the newest: kolu's own turns are never put into a
  // running one, and a person's turn rings nothing here (see above).
  const done = !busy
    ? newest
    : newest?.head.kind === "wake"
      ? turns.at(-2)
      : undefined;
  if (done === undefined || done.head.kind !== "user") return null;
  let said: Extract<ConductorRow, { kind: "agent" }> | undefined;
  for (const row of done.rows) {
    if (row.kind === "ask" || row.kind === "work-ask") return null;
    if (row.kind === "agent" && row.text.trim() !== "") said = row;
  }
  if (said === undefined || said.streaming === true) return null;
  return { turn: done.head.id, text: said.text };
}

const [source, setSource] =
  createSignal<Accessor<TypedReply | null | undefined>>();

/** The open conversation's reading — `undefined` while no conversation is
 *  open in this page, or its chat has not arrived yet. */
export const typedReply = (): TypedReply | null | undefined => source()?.();

/** The pane hands in its reading, for as long as it lives. */
export function provideTypedReply(
  read: Accessor<TypedReply | null | undefined>,
): void {
  setSource(() => read);
  onCleanup(() => setSource(undefined));
}
