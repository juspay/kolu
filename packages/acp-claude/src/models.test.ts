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

import { MODELS, modelNameIn, modelWindowIn } from "./models.ts";

test("the picker this adapter puts its model in", () => {
  // A bet rather than a protocol fact — ACP's `SessionConfigId` is free-form
  // and its one reserved hint is documented as UX-only — so it is written down
  // where the rest of this adapter's bets are, and asserted where they are.
  expect(MODELS.config).toBe("model");
  // ...and the readings the leg hands over ARE the ones below, rather than
  // second copies of them that could drift.
  expect(MODELS.nameIn).toBe(modelNameIn);
  expect(MODELS.windowIn).toBe(modelWindowIn);
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

describe("how big the running model's context is", () => {
  /** The same captured picker: the window is read off the row the name came
   *  from, so the cases are the same cases. */
  const OFFERED = new Map([
    ["default", "Default (recommended)"],
    ["opus[1m]", "Opus (1M context)"],
    ["claude-fable-5[1m]", "Fable"],
    ["sonnet", "Sonnet"],
    ["haiku", "Haiku"],
  ]);

  test("a row with no lane is the window every Claude ships with", () => {
    expect(modelWindowIn(OFFERED, "sonnet")).toBe(200_000);
    // ... including through the alias tier, which is how a live id arrives.
    expect(modelWindowIn(OFFERED, "claude-sonnet-5")).toBe(200_000);
  });

  test("a row pinned to the million-token lane is that lane", () => {
    expect(modelWindowIn(OFFERED, "opus[1m]")).toBe(1_000_000);
    // The adapter's other spelling of the same row, and the live id that is
    // the same model: one row, one window.
    expect(modelWindowIn(OFFERED, "claude-fable-5")).toBe(1_000_000);
  });

  test("a model the picker does not name has no window to report", () => {
    // The honest `null`: the header draws no number rather than one that is
    // five times the real size, which is the number a person reads to decide
    // whether to compact.
    expect(modelWindowIn(OFFERED, "gpt-5")).toBeNull();
    expect(modelWindowIn(OFFERED, "claude-opus-4-5-20260101")).toBeNull();
    // A laneless live id may not borrow the `opus[1m]` row's lane — the whole
    // reason the name tier refuses it — so there is no row and no window. And
    // a lane this file has never heard of is a guess it will not make.
    expect(modelWindowIn(OFFERED, "claude-opus-5")).toBeNull();
    expect(
      modelWindowIn(new Map([["opus[3m]", "Opus (3M)"]]), "opus[3m]"),
    ).toBeNull();
  });
});

describe("the version an alias row stands for", () => {
  /** The picker the pinned adapter sends a signed-out CLI 2.1.325, captured
   *  off the wire. Every family row is a bare alias, and the adapter wrote the
   *  version it stands for into each label. */
  const PINNED = new Map([
    ["default", "Default (recommended)"],
    ["opus", "Opus 5.5"],
    ["fable", "Fable 5.2"],
    ["sonnet", "Sonnet 5.5"],
    ["haiku", "Haiku 5.5"],
  ]);

  test("an id whose version the row does not state is no row", () => {
    // A conversation that remembers `claude-fable-5-1` used to be named
    // "Fable 5.2" and asked back as `fable`: moved to a newer model, silently.
    // The adapter refuses each of these ids, so naming a row for one claims a
    // model the picker does not offer.
    for (const id of [
      "claude-fable-5-1",
      "claude-fable-5",
      "claude-opus-4-5",
      "claude-sonnet-5",
      "claude-haiku-4-5",
    ]) {
      expect(modelNameIn(PINNED, id)).toBeNull();
      expect(modelWindowIn(PINNED, id)).toBeNull();
    }
  });

  test("an id whose version the row states is that row", () => {
    expect(modelNameIn(PINNED, "claude-fable-5-2")).toBe("Fable 5.2");
    expect(modelNameIn(PINNED, "claude-opus-5-5")).toBe("Opus 5.5");
    expect(modelNameIn(PINNED, "claude-sonnet-5-5")).toBe("Sonnet 5.5");
    for (const id of [
      "claude-fable-5-2",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
    ])
      expect(modelWindowIn(PINNED, id)).toBe(200_000);
    // A lane spelling is tier 2, which compares ids and not versions.
    expect(modelNameIn(PINNED, "opus[1m]")).toBe("Opus 5.5");
  });

  test("which version a bare row stands for is the picker's to say", () => {
    // A larger picker recorded off the wire, where `fable` was still 5.1 and
    // 5.2 had a row of its own: the same id lands on `fable` here because this
    // label says 5.1.
    const RECORDED = new Map([
      ["default", "Default (recommended)"],
      ["opus", "Opus 5.5"],
      ["claude-fable-5-2", "Fable 5.2"],
      ["sonnet", "Sonnet 5.5"],
      ["haiku", "Haiku 5.5"],
      ["fable", "Fable 5.1"],
      ["claude-haiku-4-5-20251001", "Haiku 4.5"],
      ["claude-sonnet-5", "Sonnet 5"],
      ["claude-opus-5", "Opus 5"],
      ["claude-fable-5", "Fable 5"],
      ["claude-opus-4-8", "Opus 4.8"],
      ["claude-opus-4-7", "Opus 4.7"],
      ["claude-opus-4-6", "Opus 4.6"],
      ["claude-sonnet-4-6", "Sonnet 4.6"],
    ]);
    expect(modelNameIn(RECORDED, "claude-fable-5-1")).toBe("Fable 5.1");
    expect(modelNameIn(RECORDED, "claude-haiku-5-5")).toBe("Haiku 5.5");
    // The dated 4.5 row is a pin no alias covers, and `haiku` says 5.5.
    expect(modelNameIn(RECORDED, "claude-haiku-4-5")).toBeNull();
  });

  test("a context size in a label is not a version", () => {
    // "1M" is glued to a word, so this label states no version, and the row
    // answers on family and lane as it always has.
    const lane = new Map([["sonnet[1m]", "Sonnet (1M context)"]]);
    expect(modelNameIn(lane, "claude-sonnet-5-1m")).toBe("Sonnet (1M context)");
    expect(modelWindowIn(lane, "claude-sonnet-5-1m")).toBe(1_000_000);
  });
});
