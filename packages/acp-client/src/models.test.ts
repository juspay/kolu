import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { ModelReading } from "@kolu/acp/engine";
import { describe, expect, test } from "vitest";

import { modelPickerIn, pickerValueFor, sameModel } from "./models.ts";

const RESOLVES = new Map([
  ["sonnet", "claude-sonnet-5"],
  ["haiku", "claude-haiku-4-5"],
  ["claude-fable-5[1m]", "claude-fable-5"],
]);

const READING: ModelReading = {
  config: "model",
  nameIn: (labels, id) =>
    labels.get(id) ??
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
    expect(
      labelsIn([{ value: "claude-opus-4-5", name: "Opus" }]).get(
        "claude-opus-4-5-20260101",
      ),
    ).toBeUndefined();
    expect(labelsIn([]).size).toBe(0);
  });

  test("the entry is the LEG's to name, and anything else leaves the model alone", () => {
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
  const OFFERED = new Map([
    ["default", "Default (recommended)"],
    ["claude-fable-5[1m]", "Fable"],
    ["sonnet", "Sonnet"],
    ["haiku", "Haiku"],
  ]);

  test("the same string is the same model, whatever anybody offers", () => {
    expect(sameModel(READING, OFFERED, "sonnet", "sonnet")).toBe(true);
    expect(sameModel(READING, new Map(), "gpt-5", "gpt-5")).toBe(true);
  });

  test("a picker value and the live id it resolves to are one model", () => {
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
    expect(sameModel(READING, OFFERED, "default", "claude-sonnet-5")).toBe(
      false,
    );
  });

  test("a model the picker cannot name answers only for itself", () => {
    expect(
      sameModel(READING, OFFERED, "gpt-5", "claude-opus-4-5-20260101"),
    ).toBe(false);
    expect(sameModel(READING, OFFERED, "sonnet", "gpt-5")).toBe(false);
  });
});

describe("the picker's own word for a model", () => {
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
    expect(pickerValueFor(READING, OFFERED, "claude-fable-5")).toBe(
      "claude-fable-5[1m]",
    );
  });

  test("a value the picker offers is already its own word", () => {
    expect(pickerValueFor(READING, OFFERED, "sonnet")).toBe("sonnet");
    expect(pickerValueFor(READING, OFFERED, "opus[1m]")).toBe("opus[1m]");
    expect(pickerValueFor(READING, OFFERED, "default")).toBe("default");
  });

  test("no row is `null`, and the caller asks in the words it has", () => {
    expect(pickerValueFor(READING, OFFERED, "claude-opus-5")).toBeNull();
    expect(
      pickerValueFor(READING, OFFERED, "claude-haiku-4-5-20251001"),
    ).toBeNull();
    expect(pickerValueFor(READING, OFFERED, "gpt-5")).toBeNull();
  });

  test("two rows sharing a name answer for neither", () => {
    const twice = new Map([
      ["sonnet", "Sonnet"],
      ["sonnet-alt", "Sonnet"],
    ]);
    expect(pickerValueFor(READING, twice, "sonnet-alt")).toBe("sonnet-alt");
    expect(pickerValueFor(READING, twice, "claude-sonnet-5")).toBeNull();
  });
});
