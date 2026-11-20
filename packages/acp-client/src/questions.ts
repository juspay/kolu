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

export interface Settled {
  readonly outcome: AskOutcome;
  readonly content: Record<string, string | number | boolean | Array<string>>;
}

export const WITHDRAWN: Settled = {
  outcome: { how: "withdrawn", answers: [] },
  content: {},
};

export type Answered = "settled" | "gone" | AnswerRefused;

export interface Questions {
  readonly ask: (
    form: Form,
    signal: AbortSignal,
    announce: (id: string) => void,
  ) => Promise<Settled>;
  readonly answer: (
    id: string,
    answers: ReadonlyArray<AskAnswer> | null,
  ) => Answered;
  readonly withdrawAll: () => void;
}

interface Pending {
  readonly fields: ReadonlyArray<AskField>;
  readonly settle: (settled: Settled) => void;
}

export const make = (
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
    if (waiting === undefined) return "gone";
    if (answers === null) {
      waiting.settle({
        outcome: { how: "declined", answers: [] },
        content: {},
      });
      return "settled";
    }
    const content = contentOf(waiting.fields, answers);
    if (content instanceof Refused)
      return new AnswerRefused({ reason: content.reason });
    waiting.settle({ outcome: { how: "answered", answers }, content });
    return "settled";
  };

  const withdrawAll = (): void => {
    for (const one of [...pending.values()]) one.settle(WITHDRAWN);
  };

  return { ask, answer, withdrawAll };
};
