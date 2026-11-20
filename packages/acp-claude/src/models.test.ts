import { describe, expect, test } from "vitest";

import { MODELS, modelNameIn, modelWindowIn } from "./models.ts";

test("the picker this adapter puts its model in", () => {
  expect(MODELS.config).toBe("model");
  expect(MODELS.nameIn).toBe(modelNameIn);
  expect(MODELS.windowIn).toBe(modelWindowIn);
});

describe("what the agent calls the model it is running", () => {
  const OFFERED = new Map([
    ["default", "Default (recommended)"],
    ["opus[1m]", "Opus (1M context)"],
    ["claude-fable-5[1m]", "Fable"],
    ["sonnet", "Sonnet"],
    ["haiku", "Haiku"],
  ]);

  test("a picked value is itself, which is the case that always worked", () => {
    expect(modelNameIn(OFFERED, "sonnet")).toBe("Sonnet");
    expect(modelNameIn(OFFERED, "claude-fable-5[1m]")).toBe("Fable");
    expect(modelNameIn(OFFERED, "default")).toBe("Default (recommended)");
  });

  test("the same model in the adapter's two spellings of a context lane", () => {
    expect(modelNameIn(OFFERED, "claude-fable-5")).toBe("Fable");
    expect(modelNameIn(OFFERED, "claude-fable-5-1m")).toBe("Fable");
  });

  test("a live API id lands on the alias row that names it", () => {
    expect(modelNameIn(OFFERED, "claude-sonnet-5")).toBe("Sonnet");
    expect(modelNameIn(OFFERED, "claude-haiku-4-5")).toBe("Haiku");
  });

  test("a family alias does not lend the live id a context lane it never stated", () => {
    expect(modelNameIn(OFFERED, "claude-opus-4-5")).toBeNull();
    expect(modelNameIn(OFFERED, "claude-opus-5")).toBeNull();
    const plain = new Map([...OFFERED, ["opus", "Opus"]]);
    plain.delete("opus[1m]");
    expect(modelNameIn(plain, "claude-opus-5")).toBe("Opus");
  });

  test("tier 2 is an identity, so the adapter's own two spellings still meet", () => {
    expect(modelNameIn(OFFERED, "claude-fable-5")).toBe("Fable");
  });

  test("`default` names no model, so nothing resolves onto it", () => {
    expect(
      modelNameIn(
        new Map([["default", "Default (recommended)"]]),
        "claude-opus-5",
      ),
    ).toBeNull();
    expect(
      modelNameIn(new Map([["default", "Default (recommended)"]]), "default-5"),
    ).toBeNull();
  });

  test("two lanes on offer is answered by the one the live id is in", () => {
    const both = new Map([
      ["sonnet", "Sonnet"],
      ["sonnet[1m]", "Sonnet (1M context)"],
    ]);
    expect(modelNameIn(both, "claude-sonnet-5")).toBe("Sonnet");
  });

  test("two rows that could both be it is a question this does not answer", () => {
    const lanes = new Map([
      ["claude-opus-5[1m]", "Opus (1M context)"],
      ["claude-opus-5-1m", "Opus, again"],
    ]);
    expect(modelNameIn(lanes, "claude-opus-5")).toBeNull();
    const cased = new Map([
      ["sonnet", "Sonnet"],
      ["SONNET", "Sonnet, shouting"],
    ]);
    expect(modelNameIn(cased, "claude-sonnet-5")).toBeNull();
  });

  test("nothing is approximated onto a row that is merely nearby", () => {
    expect(modelNameIn(OFFERED, "gpt-5")).toBeNull();
    expect(modelNameIn(OFFERED, "claude-opus-4-5-20260101")).toBeNull();
    expect(
      modelNameIn(
        new Map([["claude-sonnet-4-5", "Sonnet 4.5"]]),
        "claude-sonnet-5",
      ),
    ).toBeNull();
    expect(modelNameIn(new Map(), "claude-sonnet-5")).toBeNull();
    expect(modelNameIn(OFFERED, "")).toBeNull();
  });
});

describe("how big the running model's context is", () => {
  const OFFERED = new Map([
    ["default", "Default (recommended)"],
    ["opus[1m]", "Opus (1M context)"],
    ["claude-fable-5[1m]", "Fable"],
    ["sonnet", "Sonnet"],
    ["haiku", "Haiku"],
  ]);

  test("a row with no lane is the window every Claude ships with", () => {
    expect(modelWindowIn(OFFERED, "sonnet")).toBe(200_000);
    expect(modelWindowIn(OFFERED, "claude-sonnet-5")).toBe(200_000);
  });

  test("a row pinned to the million-token lane is that lane", () => {
    expect(modelWindowIn(OFFERED, "opus[1m]")).toBe(1_000_000);
    expect(modelWindowIn(OFFERED, "claude-fable-5")).toBe(1_000_000);
  });

  test("a model the picker does not name has no window to report", () => {
    expect(modelWindowIn(OFFERED, "gpt-5")).toBeNull();
    expect(modelWindowIn(OFFERED, "claude-opus-4-5-20260101")).toBeNull();
    expect(modelWindowIn(OFFERED, "claude-opus-5")).toBeNull();
    expect(
      modelWindowIn(new Map([["opus[3m]", "Opus (3M)"]]), "opus[3m]"),
    ).toBeNull();
  });
});
