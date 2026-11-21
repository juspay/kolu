/** THE REPLY TO A MESSAGE A PERSON TYPED, once it is finished — what
 *  attention rings for when they have left the conversation.
 *
 *  Read off the chat this page already holds and the one fact it cannot
 *  say for itself: whether a turn is running. Nothing is asked of the
 *  server for it. */

import type { ConductorRow } from "kolu-common/conductor";
import type { WorkId } from "kolu-work";
import { type Accessor, createSignal, onCleanup } from "solid-js";
import { type ChatTurn, chatTurns } from "./turnWorks";

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

/** A turn the agent actually took up: not one still waiting behind another,
 *  and not one that was refused or went unanswered. */
const ran = (turn: ChatTurn): boolean => {
  const head = turn.head;
  return (
    (head.kind === "user" || head.kind === "wake") &&
    head.queued !== true &&
    head.delivery === undefined
  );
};

/** THE NEWEST FINISHED TURN'S REPLY, when a person started that turn.
 *
 *  While a turn is running (`busy`) the newest turn that ran is the one
 *  still running, so the newest FINISHED one is the turn before it.
 *
 *  `null` when that turn was not started by a person, when it said nothing,
 *  when its last words are still streaming, and when it put a question: the
 *  question rings for itself. */
export function finishedReplyOf(
  rows: readonly ConductorRow[],
  busy: boolean,
): FinishedReply | null {
  const turns = chatTurns(rows).filter(ran);
  const done = busy ? turns.at(-2) : turns.at(-1);
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
