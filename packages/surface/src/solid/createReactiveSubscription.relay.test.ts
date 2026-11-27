/** AN INPUT CHANGE MUST NOT RELAY ITSELF THROUGH THE SUBSCRIPTION'S STATE.
 *
 *  `createReactiveSubscription`'s apply arm resets the published value, the
 *  error, `pending` and `complete` on every input change. A consumer is free to
 *  fold the subscription's own INPUT with what the subscription publishes — one
 *  computation reading both — and that consumer has already answered for the
 *  input change by the time the arm writes. That is Solid 2's
 *  `EFFECT_RELAY_TEAR`, and it reaches `warn` on the third input change.
 *
 *  Three input changes against a real `createReactiveSubscription`, with a
 *  standing reader folding the input, the value and `pending()`. Every round
 *  asserts the PUBLISHED STATE — the fold's text at the change and again at the
 *  new input's first frame — and an EMPTY diagnostics drain, `info` included. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
} from "solid-js";
import { expect, it } from "vitest";
import {
  type ControllableStream,
  controllableStream,
} from "./controllableStream.testlib";
import { createReactiveSubscription } from "./createReactiveSubscription";

const drained = (): string[] =>
  takeSolidDiagnostics().map((e) => `[${e.severity}] ${e.code} ${e.message}`);

/** One macrotask drain: the fiber opens and its first frame lands across a few
 *  ticks (the same budget the sibling suite uses). */
async function settle(ticks = 4): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
  flush();
}

it("resets on three input changes without relaying them into a reader that folds the input", async () => {
  takeSolidDiagnostics();

  const streams = new Map<string, ControllableStream<string>>();
  const streamFor = (input: string) => {
    const existing = streams.get(input);
    if (existing) return existing;
    const fresh = controllableStream<string>();
    streams.set(input, fresh);
    return fresh;
  };

  const [input, setInput] = createSignal("A");
  const shown: string[] = [];
  let read!: () => string;
  const dispose = createRoot((disposeRoot) => {
    const sub = createReactiveSubscription<string, string>(
      input,
      (current) => streamFor(current).source,
    );
    // The victim: ONE computation folding the arm's cause (the input) with the
    // facts the arm writes (the value and `pending`).
    const fold = createMemo(
      () => `${input()}|${sub() ?? "-"}|${sub.pending() ? "pending" : "ready"}`,
      { name: "reactiveSubscriptionFold" },
    );
    // Standing: a memo nobody observes is never a relay victim.
    createEffect(
      fold,
      (text) => {
        shown.push(text);
      },
      { name: "reactiveSubscriptionShown" },
    );
    read = fold;
    return disposeRoot;
  });

  try {
    flush();
    streamFor("A").push("a1");
    await settle();
    expect(read()).toBe("A|a1|ready");

    for (const [next, frame] of [
      ["B", "b1"],
      ["C", "c1"],
      ["D", "d1"],
    ] as const) {
      setInput(next);
      flush();
      // The reset is published with the new input: no stale value, pending again.
      expect(read()).toBe(`${next}|-|pending`);

      streamFor(next).push(frame);
      await settle();
      expect(read()).toBe(`${next}|${frame}|ready`);
    }

    // EVERY pass a standing reader is shown, in order. The `<input>|<prior
    // value>|ready` entry after each change is the pass the input change itself
    // makes, BEFORE the settled reset drains later in the SAME flush — the
    // sequence master publishes too (master writes the reset inline from the
    // same input-keyed effect arm, which lands a pass later than the memo's own
    // recompute just the same). The settle moves no frame; it removes the EFFECT
    // ORIGIN that made the second recompute a relay tear.
    expect(shown).toEqual([
      "A|-|pending",
      "A|a1|ready",
      "B|a1|ready",
      "B|-|pending",
      "B|b1|ready",
      "C|b1|ready",
      "C|-|pending",
      "C|c1|ready",
      "D|c1|ready",
      "D|-|pending",
      "D|d1|ready",
    ]);
    expect(drained()).toEqual([]);
  } finally {
    for (const stream of streams.values()) stream.close();
    dispose();
  }
});
