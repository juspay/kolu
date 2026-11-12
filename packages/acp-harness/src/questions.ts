/**
 * The questions on the wire, and the one rule about them: each ends exactly
 * once.
 *
 * A question the agent asked is a JSON-RPC request that has not been answered
 * yet, which is the same thing as a turn that has not moved. So what has to be
 * held is a promise per question, and what has to be got right is the race:
 * somebody answers in one tab while somebody dismisses in another, while the
 * agent withdraws the question because the turn was cancelled, while the
 * subprocess dies. Every one of those is a call to `settle`, the first wins and
 * the rest are no-ops — which is what makes the row on screen and the value on
 * the wire unable to disagree.
 *
 * Its own module because it is a state machine rather than a protocol fact:
 * nothing here knows what ACP is, and the whole of it is reachable without a
 * subprocess. Not a matter of taste — `withdrawAll` was once written to clear
 * the map and THEN settle what it had taken out, which settles nothing, because
 * settling is what removes an entry; inside the harness's closure that bug
 * needed an agent, a browser and a cancelled turn to see.
 */

import { contentOf, type Form, Refused } from "@kolu/acp";
import type { AskAnswer, AskField, AskOutcome } from "@kolu/acp/wire";

/** How a question ended: what the row records, and what goes back on the wire.
 *  Computed together and travelling together, so a row that says *answered*
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

/** An answer that does not FIT the question it was for — a number field given a
 *  word, a required field left empty, a key nothing asked for.
 *
 *  THROWN rather than returned, and the question stays up: settling the row and
 *  then sending something else would leave a transcript claiming an answer the
 *  agent never got. It is `@kolu/acp`'s own {@link Refused} translated at the
 *  seam, which is the whole of what the seam is for. */
export class AnswerRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "AnswerRefused";
  }
}

interface Pending {
  readonly fields: ReadonlyArray<AskField>;
  readonly settle: (settled: Settled) => void;
}

export class Questions {
  #pending = new Map<string, Pending>();
  readonly #instance = crypto.randomUUID();
  #asked = 0;
  readonly #onSettled: (id: string, outcome: AskOutcome) => void;

  /** Told whenever a question stops waiting, however it stopped. One channel
   *  for all four endings, so no path can move the wire without moving the
   *  row. */
  constructor(onSettled: (id: string, outcome: AskOutcome) => void) {
    this.#onSettled = onSettled;
  }

  /** Every question still waiting, by id — what the state's `openAsks` is. */
  open(): ReadonlyArray<string> {
    return [...this.#pending.keys()];
  }

  /**
   * Put a form up and wait for it. The promise IS the pending request.
   *
   * `announce` is called with the id this question is known by, once, before
   * anything can answer it — so a caller can put the row on screen without
   * having to be told the id by a second route.
   */
  ask(
    form: Form,
    signal: AbortSignal,
    announce: (id: string) => void,
  ): Promise<Settled> {
    // A browser answers this row by id. A restarted harness must never mint the
    // same id as the one before it: a delayed answer from a tab that was open
    // across the restart would settle a different question.
    const id = `ask:${this.#instance}:${++this.#asked}`;
    const { promise, resolve } = Promise.withResolvers<Settled>();
    const settle = (settled: Settled): void => {
      if (this.#pending.delete(id)) {
        this.#onSettled(id, settled.outcome);
        resolve(settled);
      }
    };
    this.#pending.set(id, { fields: form.fields, settle });
    // Checked as well as listened for: a signal that aborted before this ran
    // will never fire the event, and a question waiting on something that has
    // already happened waits forever.
    if (signal.aborted) {
      settle(WITHDRAWN);
      return promise;
    }
    signal.addEventListener("abort", () => settle(WITHDRAWN), { once: true });
    announce(id);
    return promise;
  }

  /**
   * Answer one, or — with `null` — decline it. `false` means that question is
   * no longer waiting: it was withdrawn, or a second tab got there first. Two
   * tabs watching one conversation is the ordinary case, so that is a state to
   * report rather than a fault.
   */
  answer(id: string, answers: ReadonlyArray<AskAnswer> | null): boolean {
    const waiting = this.#pending.get(id);
    if (waiting === undefined) return false;
    if (answers === null) {
      waiting.settle({
        outcome: { how: "declined", answers: [] },
        content: {},
      });
      return true;
    }
    // Typed against the schema that asked for it BEFORE the question stops
    // waiting — see {@link AnswerRefused}.
    const content = contentOf(waiting.fields, answers);
    if (content instanceof Refused) throw new AnswerRefused(content.reason);
    waiting.settle({ outcome: { how: "answered", answers }, content });
    return true;
  }

  /** Take back everything still waiting: the conversation these belonged to is
   *  over, so nobody is going to answer them. A SNAPSHOT, because `settle` is
   *  what removes an entry — clearing the map first would make every settle a
   *  no-op and leave every row hanging on a conversation that no longer
   *  exists. */
  withdrawAll(): void {
    for (const one of [...this.#pending.values()]) one.settle(WITHDRAWN);
  }
}
