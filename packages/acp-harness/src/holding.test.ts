/**
 * THE HELD LIST, over values — the rules both products lean on, in one suite.
 *
 * Nothing here needs an agent, a socket or a panel: the list is a bounded,
 * coalescing set with an identity-based take, and every rule is reachable by
 * calling it. What the product suites add is the ARRIVAL of bodies from a real
 * turn; what this adds is what the list does with them.
 *
 * TWO PRODUCT SHAPES, deliberately, because they are the reason this file is
 * one file: kolu holds one body per watched terminal for ONE conversation with
 * no caps at all, and olai holds any number of bodies per plugin for any number
 * of conversations and bounds both axes. Both are configured here.
 */

import { describe, expect, it } from "vitest";
import { type Held, holding, joined, type Slot } from "./holding.ts";

/** kolu's shape: one conversation, one slot per sender, no caps. kolu names the
 *  SENDER as its own coalescing key — one slot per watched terminal, newest news
 *  only — which is what a doorbell that re-derives its sentence wants. */
const one = <T>(): Held<string, T> =>
  holding<string, T>({ keyOf: () => "the conversation" });

const holdOne = <T>(held: Held<string, T>, ref: string, value: T): void =>
  held.hold(HERE, ref, value, ref);

/** olai's shape: a conversation per agent and session, both caps named. */
const many = (): Held<{ agent: string; session: string }, string> =>
  holding<{ agent: string; session: string }, string>({
    keyOf: (to) => `${to.agent}\0${to.session}`,
    slots: 2,
    conversations: 2,
  });

const HERE = "the conversation";

describe("where a body goes in the list", () => {
  it("keeps arrival order, which is the order a person reads them in", () => {
    const held = one<string>();
    holdOne(held, "a", "first");
    holdOne(held, "b", "second");
    expect(held.waiting(HERE).map((slot) => slot.value)).toEqual([
      "first",
      "second",
    ]);
  });

  it("REPLACES IN PLACE: the newest under one key sits where the first one sat", () => {
    // A terminal that stopped and then went away is ONE subject with newer news.
    // Appending would walk it to the back of a queue it has been at the front of
    // since the start, and a body would be read after one that arrived later.
    const held = one<string>();
    holdOne(held, "t1", "stopped");
    holdOne(held, "t2", "needs you");
    holdOne(held, "t1", "ended");
    expect(held.waiting(HERE).map((slot) => slot.value)).toEqual([
      "ended",
      "needs you",
    ]);
  });

  it("matches the coalescing key as a PAIR — two senders may name the same word", () => {
    const held = many();
    const to = { agent: "a", session: "s" };
    held.hold(to, "plugin-one", "one", "digest");
    held.hold(to, "plugin-two", "two", "digest");
    expect(held.waiting(to).map((slot) => slot.value)).toEqual(["one", "two"]);
  });

  it("never replaces a body sent with NO key", () => {
    const held = one<string>();
    held.hold(HERE, "t1", "about a moment", undefined);
    held.hold(HERE, "t1", "about another moment", undefined);
    expect(held.waiting(HERE).map((slot) => slot.value)).toEqual([
      "about a moment",
      "about another moment",
    ]);
  });
});

describe("taking what was handed over", () => {
  it("hands back a COPY, so a caller's flush is not a live view", () => {
    const held = one<string>();
    held.hold(HERE, "t1", "one", undefined);
    const slots = held.waiting(HERE);
    held.hold(HERE, "t2", "two", undefined);
    expect(slots).toHaveLength(1);
    expect(held.waiting(HERE)).toHaveLength(2);
  });

  it("takes BY IDENTITY, so a replace that overtook the flush survives", () => {
    // The body that was on the wire is the one that landed. The one that
    // replaced it in that position while the flush was out was never seen by
    // anybody, and taking it would drop words nobody read.
    const held = one<string>();
    held.hold(HERE, "t1", "one", undefined);
    const flushed = held.waiting(HERE);
    held.hold(HERE, "t1", "one, restated", undefined);
    held.took(HERE, flushed);
    expect(held.waiting(HERE).map((slot) => slot.value)).toEqual([
      "one, restated",
    ]);
  });

  it("stops holding for a conversation whose last body was taken", () => {
    const held = many();
    const to = { agent: "a", session: "s" };
    held.hold(to, "p", "one", undefined);
    held.took(to, held.waiting(to));
    expect(held.waiting(to)).toEqual([]);
    // ... which is what keeps an emptied conversation from occupying one of the
    // conversations the cap allows.
    expect(held.refs(to)).toEqual([]);
  });
});

describe("the four verbs a single-conversation caller asks for", () => {
  it("knows whether a sender has anything waiting", () => {
    // Read by a caller putting back a body whose delivery failed: newer news
    // must win over the retry.
    const held = one<string>();
    expect(held.has(HERE, "t1")).toBe(false);
    held.hold(HERE, "t1", "stopped", undefined);
    expect(held.has(HERE, "t1")).toBe(true);
  });

  it("answers WHAT is waiting, so a caller can see what it would throw away", () => {
    const held = one<string>();
    held.hold(HERE, "t1", "stopped", undefined);
    expect(held.peek(HERE, "t1")).toBe("stopped");
    expect(held.peek(HERE, "t2")).toBeUndefined();
  });

  it("lists what rang, in the order it rang", () => {
    const held = one<string>();
    held.hold(HERE, "t2", "b", undefined);
    held.hold(HERE, "t1", "a", undefined);
    expect(held.refs(HERE)).toEqual(["t2", "t1"]);
  });

  it("WITHDRAWS one sender's body and says whether anything went", () => {
    // The one verb a caller reaches for on its own initiative: a terminal that
    // went back to working has stopped standing the way its news described.
    const held = one<string>();
    held.hold(HERE, "t1", "stopped", undefined);
    expect(held.withdraw(HERE, "t1")).toBe(true);
    expect(held.withdraw(HERE, "t1")).toBe(false);
    expect(held.waiting(HERE)).toEqual([]);
  });

  it("clears a conversation, or every one of them", () => {
    const held = many();
    held.hold({ agent: "a", session: "s" }, "p", "one", undefined);
    held.hold({ agent: "b", session: "s" }, "p", "two", undefined);
    held.clear({ agent: "a", session: "s" });
    expect(held.waiting({ agent: "a", session: "s" })).toEqual([]);
    expect(held.waiting({ agent: "b", session: "s" })).toHaveLength(1);
    held.clear();
    expect(held.waiting({ agent: "b", session: "s" })).toEqual([]);
  });

  it("drops one sender's bodies when its doorbell went off", () => {
    const held = many();
    const to = { agent: "a", session: "s" };
    held.hold(to, "p", "one", undefined);
    held.hold(to, "q", "two", undefined);
    held.dropped(to, "p");
    expect(held.waiting(to).map((slot) => slot.value)).toEqual(["two"]);
  });

  it("counts what each sender is holding", () => {
    const held = many();
    const to = { agent: "a", session: "s" };
    held.hold(to, "p", "one", "x");
    held.hold(to, "p", "two", "y");
    held.hold(to, "q", "three", undefined);
    expect([...held.counts(to)]).toEqual([
      ["p", 2],
      ["q", 1],
    ]);
  });
});

describe("the caps, which are counts and not policies", () => {
  it("drops the OLDEST of one sender's own bodies past the per-sender cap", () => {
    const held = many();
    const to = { agent: "a", session: "s" };
    for (const at of ["one", "two", "three"]) {
      held.hold(to, "p", at, at);
    }
    expect(held.waiting(to).map((slot) => slot.value)).toEqual([
      "two",
      "three",
    ]);
  });

  it("... and never another sender's", () => {
    const held = many();
    const to = { agent: "a", session: "s" };
    held.hold(to, "q", "another sender's", undefined);
    for (const at of ["one", "two", "three"]) held.hold(to, "p", at, at);
    expect(held.waiting(to).map((slot) => slot.value)).toContain(
      "another sender's",
    );
  });

  it("evicts the conversation held for longest ago, and never the one just touched", () => {
    const held = many();
    const first = { agent: "a", session: "s" };
    const second = { agent: "b", session: "s" };
    const third = { agent: "c", session: "s" };
    held.hold(first, "p", "one", undefined);
    held.hold(second, "p", "two", undefined);
    // touching the first again makes the SECOND the oldest
    held.hold(first, "p", "one again", "again");
    held.hold(third, "p", "three", undefined);
    expect(held.waiting(second)).toEqual([]);
    expect(held.waiting(first).map((slot) => slot.value)).toEqual([
      "one",
      "one again",
    ]);
  });

  it("has NO cap when the caller names none", () => {
    const held = one<string>();
    for (let n = 0; n < 64; n++) held.hold(HERE, "t1", `news ${n}`, `${n}`);
    expect(held.waiting(HERE)).toHaveLength(64);
  });
});

describe("the bodies as one message", () => {
  it("joins whole paragraphs in arrival order, with a blank line between them", () => {
    const slots: ReadonlyArray<Slot<string>> = [
      { from: "p", value: "one", under: undefined },
      { from: "q", value: "two", under: undefined },
    ];
    expect(joined(slots, (value) => value)).toBe("one\n\ntwo");
  });

  it("leaves out a body that lost its subject, and says nothing when all did", () => {
    // Asked at the moment the row is written: a body that waited through a turn
    // is about a world that has had a turn to move.
    const slots: ReadonlyArray<Slot<string | null>> = [
      { from: "p", value: null, under: undefined },
      { from: "q", value: "", under: undefined },
    ];
    expect(joined(slots, (value) => value)).toBeNull();
  });
});
