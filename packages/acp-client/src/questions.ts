/**
 * The questions on the wire, and the one rule about them: each ends exactly
 * once.
 *
 * A question the agent asked is a JSON-RPC request that has not been answered
 * yet, which is the same thing as a turn that has not moved. So what has to be
 * held is a promise per question, and what has to be got right is the race:
 * somebody answers in one tab while somebody dismisses in another, while the
 * agent withdraws the question because the turn was cancelled, while the
 * subprocess dies. Every one of those is a call to `settle`, the first one wins
 * and the rest are no-ops — which is what makes the row on screen and the value
 * on the wire unable to disagree.
 *
 * It is its own module because it is a state machine rather than a protocol
 * fact: nothing in here knows what ACP is, and the whole of it is reachable
 * without a subprocess. That is not a matter of taste. `withdrawAll` was
 * written to clear the map and then settle what it had taken out — which
 * settles nothing, because settling is what removes an entry — and every
 * question would have hung on a conversation that had already ended. Inside the
 * client's closure that bug needed an agent, a browser and a cancelled turn to
 * see; here it is four lines of test.
 */

import { contentOf, type Form, Refused } from "@kolu/acp";
import type { AskAnswer, AskField, AskOutcome } from "@kolu/acp/wire";
import { Data } from "effect";

/** An answer that does not fit the question it was for, with the sentence that
 *  says why. The client's own refusal: a caller that renders refusals in its
 *  product's vocabulary maps this one at the place it calls `answer`. */
export class AnswerRefused extends Data.TaggedError("AnswerRefused")<{
  readonly reason: string;
}> {
  override get message(): string {
    return this.reason;
  }
}

/** How a question ended: what the row records, and what goes on the wire. The
 *  two are computed together and travel together, so a row that says "answered"
 *  cannot belong to a response that says anything else. */
export interface Settled {
  readonly outcome: AskOutcome;
  readonly content: Record<string, string | number | boolean | Array<string>>;
}

/** Nobody answered, and nobody is going to. */
export const WITHDRAWN: Settled = {
  outcome: { how: "withdrawn", answers: [] },
  content: {},
};

/** What happened to an answer somebody sent: it landed, it was too late, or it
 *  did not fit the question it was for. Three outcomes rather than a boolean
 *  and an exception, because the caller says something different about each. */
export type Answered = "settled" | "gone" | AnswerRefused;

export interface Questions {
  /**
   * Put a form up and wait for it. The promise IS the pending request.
   *
   * `announce` is called with the id this question is known by, once, before
   * anything can answer it — so a caller can put the row on screen without
   * having to be told the id by a second route.
   */
  readonly ask: (
    form: Form,
    signal: AbortSignal,
    announce: (id: string) => void,
  ) => Promise<Settled>;
  /** Answer one, or — with `null` — decline it. */
  readonly answer: (
    id: string,
    answers: ReadonlyArray<AskAnswer> | null,
  ) => Answered;
  /** Take back everything still waiting: the conversation these belonged to is
   *  over, so nobody is going to answer them. */
  readonly withdrawAll: () => void;
}

interface Pending {
  readonly fields: ReadonlyArray<AskField>;
  readonly settle: (settled: Settled) => void;
}

export const make = (
  /** Told whenever a question stops waiting, however it stopped. One channel
   *  for all four endings, so no path can move the wire without moving the row.
   */
  onSettled: (id: string, outcome: AskOutcome) => void,
): Questions => {
  const pending = new Map<string, Pending>();
  const instance = crypto.randomUUID();
  let asked = 0;

  const ask = (
    form: Form,
    signal: AbortSignal,
    announce: (id: string) => void,
  ): Promise<Settled> => {
    // A browser answers this row by id. Independent node agents and restarted
    // harnesses must never mint the same id: their drafts share one tab, and
    // a delayed answer must not settle a different foreground question.
    const id = `ask:${instance}:${++asked}`;
    return new Promise<Settled>((resolve) => {
      const settle = (settled: Settled): void => {
        if (pending.delete(id)) {
          onSettled(id, settled.outcome);
          resolve(settled);
        }
      };
      pending.set(id, { fields: form.fields, settle });
      // Checked as well as listened for: a signal that aborted before this ran
      // will never fire the event, and a question waiting on something that has
      // already happened waits forever.
      if (signal.aborted) return settle(WITHDRAWN);
      signal.addEventListener("abort", () => settle(WITHDRAWN), { once: true });
      announce(id);
    });
  };

  const answer = (
    id: string,
    answers: ReadonlyArray<AskAnswer> | null,
  ): Answered => {
    const waiting = pending.get(id);
    // Not a fault: two tabs watch one conversation, so "somebody else got there
    // first" is an ordinary thing to have happened and a thing to report.
    if (waiting === undefined) return "gone";
    if (answers === null) {
      waiting.settle({
        outcome: { how: "declined", answers: [] },
        content: {},
      });
      return "settled";
    }
    // Typed against the schema that asked for it BEFORE the question stops
    // waiting, so an answer that does not fit leaves it up rather than
    // recording one the agent was never sent.
    //
    // THE SEAM: the protocol package refuses in its own one word (`Refused`),
    // because the domain's vocabulary must not enter a leaf that speaks ACP —
    // and this caller renders refusals in the domain's, so the translation
    // happens here, once, with nothing lost but the class.
    const content = contentOf(waiting.fields, answers);
    if (content instanceof Refused)
      return new AnswerRefused({ reason: content.reason });
    waiting.settle({ outcome: { how: "answered", answers }, content });
    return "settled";
  };

  const withdrawAll = (): void => {
    // A snapshot, because `settle` is what removes an entry — clearing the map
    // first would make every settle a no-op and leave the promises (and
    // therefore the rows) hanging on a conversation that no longer exists.
    for (const one of [...pending.values()]) one.settle(WITHDRAWN);
  };

  return { ask, answer, withdrawAll };
};
