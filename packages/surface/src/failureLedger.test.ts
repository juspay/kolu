/**
 * The LAWS of the classified failure ledger — pinned in the FRAMEWORK, not in a
 * consumer.
 *
 * Law (i) is the one no test in the repo ever pinned: N recordings of class A
 * never trip class B's ceiling, for any N. The absence of that law is what let
 * `@kolu/surface-remote`'s session count ~18 "host unreachable" failures toward
 * a five-strike "remote rejection" budget for a month (juspay/kolu#2101). Every
 * test that existed drove a SINGLE cause, and a single-cause sequence can never
 * see a cross-class leak.
 *
 * These are laws about the primitive, so a consumer that adopts it inherits
 * them; the consumer's own seam tests (`sessionGiveUpBudget.test.ts` in
 * `@kolu/surface-remote`) pin the field shape, not the algebra.
 */
import { describe, expect, it } from "vitest";
import { makeFailureLedger } from "./failureLedger";

/** The session's real spec shape: an unbounded transport class that resets the
 *  bounded rejection class, and a bounded rejection class. */
const sessionShape = () =>
  makeFailureLedger({
    network: { ceiling: null, resets: ["remote"] },
    remote: { ceiling: 5 },
  });

describe("(i) anti-conflation — one class's recordings never trip another's ceiling", () => {
  it("100 unbounded-class failures leave the bounded class's first verdict at run=1", () => {
    const ledger = makeFailureLedger({
      network: { ceiling: null },
      remote: { ceiling: 5 },
    });
    for (let i = 0; i < 100; i++) {
      const verdict = ledger.record("network");
      expect(verdict.exhausted).toBe(false);
    }
    // The field shape: a long unreachable stretch, then ONE rejection.
    const verdict = ledger.record("remote");
    expect(verdict.run).toBe(1);
    expect(verdict.ceiling).toBe(5);
    expect(verdict.exhausted).toBe(false);
  });

  it("holds for every N from 0 to 40, with no reset rule declared at all", () => {
    for (let n = 0; n <= 40; n++) {
      const ledger = makeFailureLedger({
        network: { ceiling: null },
        remote: { ceiling: 5 },
      });
      for (let i = 0; i < n; i++) ledger.record("network");
      expect(ledger.record("remote")).toEqual({
        exhausted: false,
        run: 1,
        ceiling: 5,
      });
    }
  });

  it("is symmetric — bounded-class recordings never exhaust a second bounded class", () => {
    const ledger = makeFailureLedger({
      a: { ceiling: 2 },
      b: { ceiling: 2 },
    });
    expect(ledger.record("a").exhausted).toBe(false);
    expect(ledger.record("a").exhausted).toBe(true);
    // `a` is spent; `b` is untouched.
    expect(ledger.record("b")).toEqual({
      exhausted: false,
      run: 1,
      ceiling: 2,
    });
  });
});

describe("(ii) a ceiling trips at exactly its own run length", () => {
  it("run == ceiling − 1 is not exhausted; run == ceiling is", () => {
    const ledger = makeFailureLedger({ remote: { ceiling: 5 } });
    for (let i = 1; i <= 4; i++) {
      const verdict = ledger.record("remote");
      expect(verdict.run).toBe(i);
      expect(verdict.exhausted).toBe(false);
    }
    const fifth = ledger.record("remote");
    expect(fifth.run).toBe(5);
    expect(fifth.exhausted).toBe(true);
  });

  it("a ceiling of 1 trips on the first recording", () => {
    const ledger = makeFailureLedger({ fatal: { ceiling: 1 } });
    expect(ledger.record("fatal")).toEqual({
      exhausted: true,
      run: 1,
      ceiling: 1,
    });
  });

  it("stays exhausted past the ceiling and keeps naming the true run", () => {
    const ledger = makeFailureLedger({ remote: { ceiling: 2 } });
    ledger.record("remote");
    ledger.record("remote");
    const third = ledger.record("remote");
    expect(third.run).toBe(3);
    expect(third.exhausted).toBe(true);
  });
});

describe("(iii) declared interleaving resets — and the NEGATIVE", () => {
  it("a declared reset restarts the target's run mid-run", () => {
    const ledger = sessionShape();
    expect(ledger.record("remote").run).toBe(1);
    expect(ledger.record("remote").run).toBe(2);
    expect(ledger.record("remote").run).toBe(3);
    ledger.record("network"); // declares resets: ["remote"]
    expect(ledger.record("remote")).toEqual({
      exhausted: false,
      run: 1,
      ceiling: 5,
    });
  });

  it("the dark-wake alternation never exhausts under the declared reset", () => {
    const ledger = sessionShape();
    for (let cycle = 0; cycle < 50; cycle++) {
      expect(ledger.record("remote").exhausted).toBe(false);
      for (let i = 0; i < 7; i++) ledger.record("network");
    }
  });

  it("NEGATIVE: without a declared reset, interleaving does NOT reset the run", () => {
    // "Consecutive" means "since the last reset event" (a success, or a
    // DECLARED reset), NOT "adjacent". A budget that also forgave adjacency
    // would let an alternating fault retry forever with no rule saying so.
    const ledger = makeFailureLedger({
      network: { ceiling: null },
      remote: { ceiling: 5 },
    });
    for (let i = 0; i < 4; i++) {
      ledger.record("remote");
      ledger.record("network");
    }
    const fifth = ledger.record("remote");
    expect(fifth.run).toBe(5);
    expect(fifth.exhausted).toBe(true);
  });

  it("a reset restores the BUDGET, not the pace — attempts() keeps climbing", () => {
    const ledger = sessionShape();
    ledger.record("remote");
    ledger.record("network");
    ledger.record("remote");
    expect(ledger.attempts()).toBe(3);
  });

  it("a class that names ITSELF in resets never accumulates a run", () => {
    const ledger = makeFailureLedger({
      blip: { ceiling: 3, resets: ["blip"] },
    });
    for (let i = 0; i < 10; i++) {
      expect(ledger.record("blip")).toEqual({
        exhausted: false,
        run: 1,
        ceiling: 3,
      });
    }
  });
});

describe("(iv) success() clears every run and the attempt count", () => {
  it("clears a partially-spent bounded run", () => {
    const ledger = sessionShape();
    ledger.record("remote");
    ledger.record("remote");
    ledger.record("remote");
    ledger.record("remote");
    ledger.success();
    expect(ledger.attempts()).toBe(0);
    expect(ledger.record("remote")).toEqual({
      exhausted: false,
      run: 1,
      ceiling: 5,
    });
  });

  it("clears every class at once", () => {
    const ledger = makeFailureLedger({ a: { ceiling: 3 }, b: { ceiling: 3 } });
    ledger.record("a");
    ledger.record("a");
    ledger.record("b");
    ledger.record("b");
    ledger.success();
    expect(ledger.record("a").run).toBe(1);
    expect(ledger.record("b").run).toBe(1);
  });

  it("is idempotent on a fresh ledger", () => {
    const ledger = sessionShape();
    ledger.success();
    ledger.success();
    expect(ledger.attempts()).toBe(0);
  });
});

describe("unbounded classes", () => {
  it("never exhaust at any N", () => {
    const ledger = makeFailureLedger({ network: { ceiling: null } });
    for (let i = 1; i <= 500; i++) {
      const verdict = ledger.record("network");
      expect(verdict.exhausted).toBe(false);
      expect(verdict.ceiling).toBeNull();
      expect(verdict.run).toBe(i);
    }
  });
});

describe("attempts() — the display/pacing tier", () => {
  it("sums recordings across every class", () => {
    const ledger = sessionShape();
    expect(ledger.attempts()).toBe(0);
    ledger.record("network");
    ledger.record("remote");
    ledger.record("network");
    expect(ledger.attempts()).toBe(3);
  });
});

describe("construction fails fast", () => {
  it("throws on a resets entry naming a class the spec does not declare", () => {
    expect(() =>
      makeFailureLedger({
        network: { ceiling: null, resets: ["remotte"] },
        remote: { ceiling: 5 },
      }),
    ).toThrow(/"remotte" is not a class in this spec/);
  });

  it("accepts a resets entry naming a declared class", () => {
    expect(() => sessionShape()).not.toThrow();
  });
});

describe("recording an undeclared class throws", () => {
  it("names the classes it does have", () => {
    const ledger = makeFailureLedger({ remote: { ceiling: 5 } });
    expect(() => ledger.record("network" as "remote")).toThrow(
      /unknown failure class "network"/,
    );
  });
});
