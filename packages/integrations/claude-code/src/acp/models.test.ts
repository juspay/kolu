/**
 * WHAT THIS ADAPTER CALLS ITS OWN MODELS ({@link ./models.ts}), over values.
 *
 * ONE ENGINE'S ARITHMETIC, which is why it is in this package rather than in
 * the one that reads a picker. The Claude Code adapter is where the awkward
 * cases live, because it is the one whose picker offers ALIASES for the ids its
 * CLI reports; an agent whose picker offers the ids themselves matches at the
 * first tier and takes `namedExactly` instead.
 *
 * What this file adds over a scenario is the near misses, cheap as values and
 * expensive to stage: a family alias against a lane-pinned row, two rows that
 * could both answer, a dated id no alias covers.
 */

import { describe, expect, test } from "vitest";

import { MODELS, modelNameIn } from "./models.ts";

test("the picker this adapter puts its model in", () => {
  // A bet rather than a protocol fact — ACP's `SessionConfigId` is free-form
  // and its one reserved hint is documented as UX-only — so it is written down
  // where the rest of this adapter's bets are, and asserted where they are.
  expect(MODELS.config).toBe("model");
  // ...and the reading the leg hands over IS the one below, rather than a
  // second copy of it that could drift.
  expect(MODELS.nameIn).toBe(modelNameIn);
});

describe("what the agent calls the model it is running", () => {
  /** The picker the adapter actually sent, captured off the wire. Every value
   *  in it is an ALIAS — this is the whole reason the lookup needs a rule
   *  rather than a `Map.get`. */
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
    // What the session came up on: the picker said `claude-fable-5[1m]` and the
    // CLI's `init` said `claude-fable-5`. One model, two spellings, and reading
    // them as two was the header changing its language mid-session.
    expect(modelNameIn(OFFERED, "claude-fable-5")).toBe("Fable");
    // The other spelling of the same hint, which the adapter treats as equal.
    expect(modelNameIn(OFFERED, "claude-fable-5-1m")).toBe("Fable");
  });

  test("a live API id lands on the alias row that names it", () => {
    // The bug, as three lines. After a `/model`, the next turn's `init` reports
    // the concrete API id; the picker offers only the alias. The header used to
    // give up and print the id.
    expect(modelNameIn(OFFERED, "claude-sonnet-5")).toBe("Sonnet");
    expect(modelNameIn(OFFERED, "claude-haiku-4-5")).toBe("Haiku");
  });

  test("a family alias does not lend the live id a context lane it never stated", () => {
    // Constructed against the real adapter in review, not imagined: `/model
    // claude-opus-4-5` runs a 200k session, the live id arrives laneless, and
    // the picker's only Opus row is the 1M one. Answering it named a context
    // window five times the real one — in the header a person reads to decide
    // whether to `/compact`, which is the one question that number is for.
    //
    // The raw id claims nothing, and claiming nothing is the truthful answer to
    // a lane the CLI did not report.
    expect(modelNameIn(OFFERED, "claude-opus-4-5")).toBeNull();
    expect(modelNameIn(OFFERED, "claude-opus-5")).toBeNull();
    // A LANELESS Opus row answers it, because then nothing is being added.
    const plain = new Map([...OFFERED, ["opus", "Opus"]]);
    plain.delete("opus[1m]");
    expect(modelNameIn(plain, "claude-opus-5")).toBe("Opus");
  });

  test("tier 2 is an identity, so the adapter's own two spellings still meet", () => {
    // Not the same claim as the alias tier above, and the difference is why
    // this one is allowed to cross a lane spelling: `claude-fable-5[1m]` and
    // `claude-fable-5` are ONE id written the adapter's two ways
    // (`canonicalizeModelId` is its own equality), not a family and a guess at
    // which member of it. Refusing here would have flipped the header from
    // "Fable" to a raw id on the first turn of every session.
    expect(modelNameIn(OFFERED, "claude-fable-5")).toBe("Fable");
  });

  test("`default` names no model, so nothing resolves onto it", () => {
    // It is the adapter's word for "whichever one the CLI recommends today".
    // It is also a bare word sitting in the alias tier, so it has to be said
    // rather than assumed.
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
    // A picker offering a bare `sonnet` and a `sonnet[1m]` is offering two
    // context lanes. The live id states none, so it is the LANELESS row — and
    // saying "Sonnet" adds nothing to what the CLI reported, where naming the
    // 1M row would have.
    const both = new Map([
      ["sonnet", "Sonnet"],
      ["sonnet[1m]", "Sonnet (1M context)"],
    ]);
    expect(modelNameIn(both, "claude-sonnet-5")).toBe("Sonnet");
  });

  test("two rows that could both be it is a question this does not answer", () => {
    // Tier 2, where the lane rule cannot help: two values that are one id in
    // the adapter's two spellings of the SAME lane. Nothing tells them apart,
    // so nothing is said.
    const lanes = new Map([
      ["claude-opus-5[1m]", "Opus (1M context)"],
      ["claude-opus-5-1m", "Opus, again"],
    ]);
    expect(modelNameIn(lanes, "claude-opus-5")).toBeNull();
    // ... and the same refusal a tier down, on two spellings of one family.
    const cased = new Map([
      ["sonnet", "Sonnet"],
      ["SONNET", "Sonnet, shouting"],
    ]);
    expect(modelNameIn(cased, "claude-sonnet-5")).toBeNull();
  });

  test("nothing is approximated onto a row that is merely nearby", () => {
    // The rule the picker's own note has always stated, and it still holds:
    // these are exact comparisons, and a model this picker does not offer is
    // reported raw by the caller rather than rounded to a neighbour.
    expect(modelNameIn(OFFERED, "gpt-5")).toBeNull();
    expect(modelNameIn(OFFERED, "claude-opus-4-5-20260101")).toBeNull();
    // A multi-word value never plays in the alias tier: `claude-sonnet-4-5` is
    // not what `claude-sonnet-5` says it is, however much of it overlaps.
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
