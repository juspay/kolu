/**
 * The model picker's MACHINERY, over values — finding the entry, reading what
 * it offers, and crossing the two vocabularies in both directions.
 *
 * WHAT IS NOT HERE is any one adapter's arithmetic. Which entry is the model and
 * what its rows are called are the LEG's (`@kolu/acp/engine`'s
 * `ModelReading`), so the cases below hand in a reading of their own: a picker
 * whose values are aliases and a two-line resolver for them. That is enough to
 * state what this module does — a value the picker offers is its own word, a
 * live id is asked for as the row that names it, two rows that could both be it
 * answer for neither — without borrowing the Claude Code CLI's table, which is
 * `olai-plugin-claude`'s and is asserted there.
 *
 * What this file adds over a scenario is the near misses, cheap as values and
 * expensive to stage: a model nobody offers, two rows sharing a name, an entry
 * that is not a select.
 */

import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { ModelReading } from "@kolu/acp/engine";
import { describe, expect, test } from "vitest";

import { modelPickerIn, pickerValueFor, sameModel } from "./models.ts";

/**
 * A READING TO TEST AGAINST — one that is honestly an example rather than a
 * copy of anybody's.
 *
 * Its picker offers ALIASES (`sonnet`) where a turn reports concrete ids
 * (`claude-sonnet-5`), because that is the shape that makes the bridge do any
 * work at all; an agent whose picker values are the ids it reports is
 * `namedExactly` and exercises the first line of every function here.
 */
const RESOLVES = new Map([
  ["sonnet", "claude-sonnet-5"],
  ["haiku", "claude-haiku-4-5"],
  ["claude-fable-5[1m]", "claude-fable-5"],
]);

const READING: ModelReading = {
  config: "model",
  nameIn: (labels, id) =>
    labels.get(id) ??
    // `default` names no model — it is the row for "whichever one is
    // recommended today" — so nothing ever resolves onto it.
    [...labels].find(
      ([value]) => value !== "default" && RESOLVES.get(value) === id,
    )?.[1] ??
    null,
};

describe("which config option is the model, and what it calls its values", () => {
  const picker = (
    options: Extract<SessionConfigOption, { type: "select" }>["options"],
  ): ReadonlyArray<SessionConfigOption> => [
    {
      id: "mode",
      name: "Mode",
      type: "select",
      currentValue: "plan",
      options: [],
    },
    {
      id: "model",
      name: "Model",
      type: "select",
      currentValue: "claude-opus-4-5",
      options,
    },
  ];

  const labelsIn = (
    options: Extract<SessionConfigOption, { type: "select" }>["options"],
  ) => {
    const read = modelPickerIn(READING, picker(options));
    if (read === null) throw new Error("no model picker");
    return read.labels;
  };

  test("the picked value is what the session says it is picking", () => {
    expect(
      modelPickerIn(
        READING,
        picker([{ value: "claude-opus-4-5", name: "Opus" }]),
      ),
    ).toMatchObject({ picked: "claude-opus-4-5" });
  });

  test("a flat picker is value → label", () => {
    const labels = labelsIn([
      { value: "claude-opus-4-5", name: "Opus" },
      { value: "claude-sonnet-4-5", name: "Sonnet" },
    ]);
    expect(labels.get("claude-opus-4-5")).toBe("Opus");
    expect(labels.get("claude-sonnet-4-5")).toBe("Sonnet");
    expect(labels.size).toBe(2);
  });

  test("a grouped picker is read through its groups", () => {
    // The protocol tells a group from an option by SHAPE rather than by a tag,
    // and an adapter that groups its models by tier sends the second shape.
    const labels = labelsIn([
      {
        group: "latest",
        name: "Latest",
        options: [
          { value: "claude-opus-4-5", name: "Opus" },
          { value: "claude-fable-5", name: "Fable" },
        ],
      },
      {
        group: "legacy",
        name: "Legacy",
        options: [{ value: "claude-sonnet-4-0", name: "Sonnet 4" }],
      },
    ]);
    expect([...labels]).toEqual([
      ["claude-opus-4-5", "Opus"],
      ["claude-fable-5", "Fable"],
      ["claude-sonnet-4-0", "Sonnet 4"],
    ]);
  });

  test("a live id the picker does not offer is absent rather than approximated", () => {
    // Which is what lets the caller keep the raw id and say so: a nearest match
    // onto a nearby row would be a model name nobody reported.
    expect(
      labelsIn([{ value: "claude-opus-4-5", name: "Opus" }]).get(
        "claude-opus-4-5-20260101",
      ),
    ).toBeUndefined();
    expect(labelsIn([]).size).toBe(0);
  });

  test("the entry is the LEG's to name, and anything else leaves the model alone", () => {
    // `id === "model"` is the engine's own spelling — ACP's only reserved hint
    // is `category`, and it says itself that it is UX-only. A session with no
    // entry of that id, or one that is not a select, costs the header a name and
    // nothing else.
    expect(modelPickerIn(READING, undefined)).toBeNull();
    expect(modelPickerIn(READING, [])).toBeNull();
    expect(
      modelPickerIn(READING, [
        {
          id: "model_id",
          name: "Model",
          type: "select",
          currentValue: "x",
          options: [],
        },
      ]),
    ).toBeNull();
    expect(
      modelPickerIn(READING, [
        { id: "model", name: "Model", type: "boolean", currentValue: true },
      ]),
    ).toBeNull();
    // ...and an engine that DOES spell it `model_id` finds it, which is the half
    // that proves the id is read off the reading rather than assumed.
    expect(
      modelPickerIn({ ...READING, config: "model_id" }, [
        {
          id: "model_id",
          name: "Model",
          type: "select",
          currentValue: "x",
          options: [],
        },
      ]),
    ).toMatchObject({ picked: "x" });
  });
});

describe("whether two model strings are the same model", () => {
  // The question a restored conversation turns on: the panel remembers what
  // this conversation was RUNNING and the load reports what the agent put it
  // on, and the model is set back only when those two disagree
  // (`chat-model-reverts-on-restart`). Answering "disagree" too readily costs a
  // round trip and a picker moved for nothing; answering it too rarely is the
  // bug still there.
  const OFFERED = new Map([
    ["default", "Default (recommended)"],
    ["claude-fable-5[1m]", "Fable"],
    ["sonnet", "Sonnet"],
    ["haiku", "Haiku"],
  ]);

  test("the same string is the same model, whatever anybody offers", () => {
    expect(sameModel(READING, OFFERED, "sonnet", "sonnet")).toBe(true);
    // Including one nothing here has a name for: two strings that are the same
    // string are the same model without a picker's help.
    expect(sameModel(READING, new Map(), "gpt-5", "gpt-5")).toBe(true);
  });

  test("a picker value and the live id it resolves to are one model", () => {
    // The case that matters: what we remembered is a `/model`, which arrives as
    // a concrete API id, and what the load reports is the picker's own alias.
    // Read as strings these disagree, and the panel would set a model the
    // session is already on at every single boot.
    expect(sameModel(READING, OFFERED, "sonnet", "claude-sonnet-5")).toBe(true);
    expect(
      sameModel(READING, OFFERED, "claude-fable-5[1m]", "claude-fable-5"),
    ).toBe(true);
  });

  test("two different models disagree, which is what makes it worth asking", () => {
    expect(sameModel(READING, OFFERED, "sonnet", "haiku")).toBe(false);
    expect(sameModel(READING, OFFERED, "sonnet", "claude-haiku-4-5")).toBe(
      false,
    );
  });

  test("`default` is not the model it resolves to, because nothing here can know", () => {
    // An adapter's word for "whichever one is recommended today" resolves to a
    // concrete model, and the picker's `configOptions` never say which — so a
    // session on `default` and a note saying `claude-sonnet-5` are two different
    // answers as far as anything on this wire goes. Erring this way costs one
    // round trip; erring the other way is a `/model` silently lost.
    expect(sameModel(READING, OFFERED, "default", "claude-sonnet-5")).toBe(
      false,
    );
  });

  test("a model the picker cannot name answers only for itself", () => {
    // Both unnameable: the reading gives up on each, each stands for itself, and
    // two different ids stay two different models rather than collapsing into
    // one `null`.
    expect(
      sameModel(READING, OFFERED, "gpt-5", "claude-opus-4-5-20260101"),
    ).toBe(false);
    expect(sameModel(READING, OFFERED, "sonnet", "gpt-5")).toBe(false);
  });
});

describe("the picker's own word for a model", () => {
  // The other direction of the same bridge, and the one a REQUEST crosses: what
  // the panel remembers is what the agent reported (`claude-sonnet-5`), and a
  // `session/set_config_option` takes a value the picker offers (`sonnet`).
  const OFFERED = new Map([
    ["default", "Default (recommended)"],
    ["opus[1m]", "Opus (1M context)"],
    ["claude-fable-5[1m]", "Fable"],
    ["sonnet", "Sonnet"],
    ["haiku", "Haiku"],
  ]);

  test("a live id is asked for as the row that names it", () => {
    expect(pickerValueFor(READING, OFFERED, "claude-sonnet-5")).toBe("sonnet");
    expect(pickerValueFor(READING, OFFERED, "claude-haiku-4-5")).toBe("haiku");
    // Two spellings of one id are one row, so the row is found for the spelling
    // a turn reports as well as the one the picker offers.
    expect(pickerValueFor(READING, OFFERED, "claude-fable-5")).toBe(
      "claude-fable-5[1m]",
    );
  });

  test("a value the picker offers is already its own word", () => {
    expect(pickerValueFor(READING, OFFERED, "sonnet")).toBe("sonnet");
    expect(pickerValueFor(READING, OFFERED, "opus[1m]")).toBe("opus[1m]");
    // Including `default`, which names no model but IS a row: a conversation
    // sitting on it is put back on it by name.
    expect(pickerValueFor(READING, OFFERED, "default")).toBe("default");
  });

  test("no row is `null`, and the caller asks in the words it has", () => {
    // The refusals the reading already makes, arriving here as "nothing to
    // translate into": a row this id does not belong to, a dated pin, a model
    // from somewhere else entirely. An agent that resolves them still can.
    expect(pickerValueFor(READING, OFFERED, "claude-opus-5")).toBeNull();
    expect(
      pickerValueFor(READING, OFFERED, "claude-haiku-4-5-20251001"),
    ).toBeNull();
    expect(pickerValueFor(READING, OFFERED, "gpt-5")).toBeNull();
  });

  test("two rows sharing a name answer for neither", () => {
    // A picker naming two values alike is a picker that cannot say which row a
    // name means. Nothing is guessed; the raw string goes out instead.
    const twice = new Map([
      ["sonnet", "Sonnet"],
      ["sonnet-alt", "Sonnet"],
    ]);
    expect(pickerValueFor(READING, twice, "sonnet-alt")).toBe("sonnet-alt");
    expect(pickerValueFor(READING, twice, "claude-sonnet-5")).toBeNull();
  });
});
