import type { Form } from "@kolu/acp";
import type { AskField, AskOutcome } from "@kolu/acp/wire";
import { describe, expect, test } from "vitest";

import { AnswerRefused, make } from "./questions.ts";

const choice: AskField = {
  key: "question_0",
  label: null,
  hint: null,
  kind: "choice",
  choices: [{ value: "oak", label: "oak", hint: null }],
  required: false,
  attachedTo: null,
};

const form: Form = {
  message: "Which cabinets?",
  fields: [choice],
  toolCall: null,
  link: null,
};

const registry = () => {
  const settled: Array<readonly [string, AskOutcome]> = [];
  const questions = make((id, outcome) => settled.push([id, outcome]));
  return { questions, settled };
};

const asked = (
  questions: ReturnType<typeof make>,
  signal = new AbortController().signal,
) => {
  let id = "";
  const waiting = questions.ask(form, signal, (announced) => {
    id = announced;
  });
  return { id, waiting };
};

describe("answering", () => {
  test("an answer settles the question and types the content", async () => {
    const { questions, settled } = registry();
    const { id, waiting } = asked(questions);

    expect(questions.answer(id, [{ key: "question_0", values: ["oak"] }])).toBe(
      "settled",
    );
    expect(await waiting).toEqual({
      outcome: {
        how: "answered",
        answers: [{ key: "question_0", values: ["oak"] }],
      },
      content: { question_0: "oak" },
    });
    expect(settled).toEqual([
      [
        id,
        {
          how: "answered",
          answers: [{ key: "question_0", values: ["oak"] }],
        },
      ],
    ]);
  });

  test("a dismissal is a decline, and carries no answers", async () => {
    const { questions } = registry();
    const { id, waiting } = asked(questions);

    expect(questions.answer(id, null)).toBe("settled");
    expect(await waiting).toEqual({
      outcome: { how: "declined", answers: [] },
      content: {},
    });
  });

  test("an answer that does not fit leaves the question waiting", async () => {
    const { questions, settled } = registry();
    const { id, waiting } = asked(questions);

    expect(
      questions.answer(id, [{ key: "nothing-asked-this", values: ["x"] }]),
    ).toBeInstanceOf(AnswerRefused);
    expect(settled).toEqual([]);

    expect(questions.answer(id, [{ key: "question_0", values: ["oak"] }])).toBe(
      "settled",
    );
    expect((await waiting).outcome.how).toBe("answered");
  });

  test("the second answer is too late rather than a second settle", async () => {
    const { questions, settled } = registry();
    const { id, waiting } = asked(questions);

    expect(questions.answer(id, null)).toBe("settled");
    expect(questions.answer(id, [{ key: "question_0", values: ["oak"] }])).toBe(
      "gone",
    );
    expect((await waiting).outcome.how).toBe("declined");
    expect(settled).toHaveLength(1);
  });

  test("answering something nobody asked is `gone`, not a throw", () => {
    expect(registry().questions.answer("ask:404", null)).toBe("gone");
  });
});

describe("withdrawing", () => {
  test("every question waiting is settled, not just the map emptied", async () => {
    const { questions, settled } = registry();
    const one = asked(questions);
    const two = asked(questions);

    questions.withdrawAll();

    expect(await one.waiting).toEqual({
      outcome: { how: "withdrawn", answers: [] },
      content: {},
    });
    expect((await two.waiting).outcome.how).toBe("withdrawn");
    expect(settled.map(([id]) => id)).toEqual([one.id, two.id]);
  });

  test("the agent aborting takes its own question back", async () => {
    const { questions } = registry();
    const cancelling = new AbortController();
    const { waiting } = asked(questions, cancelling.signal);

    cancelling.abort();
    expect((await waiting).outcome.how).toBe("withdrawn");
  });

  test("a signal that aborted BEFORE the question settles it anyway", async () => {
    const { questions } = registry();
    const already = new AbortController();
    already.abort();

    expect((await asked(questions, already.signal).waiting).outcome.how).toBe(
      "withdrawn",
    );
  });

  test("withdrawing what is already settled says nothing twice", async () => {
    const { questions, settled } = registry();
    const { id, waiting } = asked(questions);

    questions.answer(id, null);
    questions.withdrawAll();

    expect((await waiting).outcome.how).toBe("declined");
    expect(settled).toHaveLength(1);
  });
});

test("question row ids belong to a distinct agent instance", () => {
  const { questions } = registry();
  const first = asked(questions).id;
  const second = asked(questions).id;
  expect(first).toMatch(/^ask:[0-9a-f-]{36}:1$/);
  expect(second).toBe(first.replace(/:1$/, ":2"));
  expect(asked(registry().questions).id).not.toBe(first);
});

test("an answer for another agent cannot settle this agent's pending question", async () => {
  const first = registry();
  const second = registry();
  const old = asked(first.questions);
  const current = asked(second.questions);
  expect(second.questions.answer(old.id, null)).toBe("gone");
  expect(second.settled).toHaveLength(0);
  expect(first.questions.answer(old.id, null)).toBe("settled");
  expect(second.questions.answer(current.id, null)).toBe("settled");
  expect((await old.waiting).outcome.how).toBe("declined");
  expect((await current.waiting).outcome.how).toBe("declined");
});
