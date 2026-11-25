import { createEffect, createRoot, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import { createBrowser } from "./createBrowser";

// THE TWO CLOCKS, and why `flush()` appears between a verb and an assertion.
// `navigate` / `back` / `forward` / `reset` answer NOW: they move the plain
// stack the controller keeps, so `back()` returns the entry it just landed on.
// `current` / `canBack` / `canForward` / `length` are the reactive mirror a
// toolbar reads in JSX, and a signal write reaches readers on the next flush.
// So every assertion on the mirror is taken after one, which is also what
// makes it an assertion about the publish and not about the plain stack.
describe("createBrowser", () => {
  it("starts empty: no current, nowhere to go, traversal is a no-op", () => {
    const b = createBrowser<string>();
    expect(b.current()).toBe(null);
    expect(b.canBack()).toBe(false);
    expect(b.canForward()).toBe(false);
    expect(b.back()).toBe(null);
    expect(b.forward()).toBe(null);
    expect(b.length()).toBe(0);
  });

  it("navigate records and advances to the new entry", () => {
    const b = createBrowser<string>();
    b.navigate("a");
    flush();
    expect(b.current()).toBe("a");
    expect(b.canBack()).toBe(false);
    expect(b.length()).toBe(1);

    b.navigate("b");
    b.navigate("c");
    flush();
    expect(b.current()).toBe("c");
    expect(b.canBack()).toBe(true);
    expect(b.canForward()).toBe(false);
    expect(b.length()).toBe(3);
  });

  it("back returns the prior entry and enables forward", () => {
    const b = createBrowser<string>();
    b.navigate("a");
    b.navigate("b");
    b.navigate("c");

    expect(b.back()).toBe("b");
    flush();
    expect(b.canForward()).toBe(true);
    expect(b.back()).toBe("a");
    // Already at the start: no move, no spurious value.
    expect(b.back()).toBe(null);
    flush();
    expect(b.current()).toBe("a");
  });

  it("forward retraces and stops at the end", () => {
    const b = createBrowser<string>();
    b.navigate("a");
    b.navigate("b");
    b.navigate("c");
    b.back();
    b.back();

    expect(b.forward()).toBe("b");
    expect(b.forward()).toBe("c");
    expect(b.forward()).toBe(null);
    flush();
    expect(b.current()).toBe("c");
  });

  it("navigating after going back forks history (drops the forward tail)", () => {
    const b = createBrowser<string>();
    b.navigate("a");
    b.navigate("b");
    b.navigate("c");
    b.back(); // now at "b", with "c" ahead

    b.navigate("d");
    flush();
    expect(b.current()).toBe("d");
    expect(b.canForward()).toBe(false); // "c" was discarded
    expect(b.length()).toBe(3); // [a, b, d]
    expect(b.back()).toBe("b");
    expect(b.back()).toBe("a");
  });

  it("seeds an initial entry so current() is non-null from the start", () => {
    const b = createBrowser<string>({ initial: "home" });
    expect(b.current()).toBe("home");
    expect(b.length()).toBe(1);
    expect(b.canBack()).toBe(false);
  });

  it("default: navigate always records, even for an equal value", () => {
    const b = createBrowser<string>();
    b.navigate("x");
    b.navigate("x");
    flush();
    expect(b.length()).toBe(2);
  });

  it("isSameEntry refreshes the current entry in place, preserving the forward tail", () => {
    type Loc = { id: number; ref?: number };
    const b = createBrowser<Loc>({ isSameEntry: (a, c) => a.id === c.id });
    b.navigate({ id: 1, ref: 10 });
    b.navigate({ id: 2 });
    b.back(); // at {id:1}, with {id:2} ahead

    // Same logical page (id 1), new ref — refresh in place, don't duplicate.
    b.navigate({ id: 1, ref: 20 });
    flush();
    expect(b.length()).toBe(2);
    expect(b.current()).toEqual({ id: 1, ref: 20 });
    // The forward tail survived the in-place refresh.
    expect(b.canForward()).toBe(true);
    expect(b.forward()).toEqual({ id: 2 });
  });

  it("isSameEntry still records a genuinely different entry", () => {
    type Loc = { id: number };
    const b = createBrowser<Loc>({ isSameEntry: (a, c) => a.id === c.id });
    b.navigate({ id: 1 });
    b.navigate({ id: 2 });
    flush();
    expect(b.length()).toBe(2);
    expect(b.current()).toEqual({ id: 2 });
  });

  it("caps the stack, evicting the oldest entries and keeping the cursor on the latest", () => {
    const b = createBrowser<number>({ maxEntries: 3 });
    b.navigate(1);
    b.navigate(2);
    b.navigate(3);
    flush();
    expect(b.length()).toBe(3);
    // The fourth push evicts entry 1; cursor stays on the newest.
    b.navigate(4);
    flush();
    expect(b.length()).toBe(3);
    expect(b.current()).toBe(4);
    expect(b.canForward()).toBe(false);
    // Back/forward now retrace only the retained window [2, 3, 4].
    expect(b.back()).toBe(3);
    expect(b.back()).toBe(2);
    expect(b.back()).toBe(null); // 1 fell off the front
    flush();
    expect(b.current()).toBe(2);
  });

  it("maxEntries: Infinity disables the cap", () => {
    const b = createBrowser<number>({ maxEntries: Number.POSITIVE_INFINITY });
    for (let i = 0; i < 500; i++) b.navigate(i);
    flush();
    expect(b.length()).toBe(500);
  });

  it("the in-place refresh never grows the stack past the cap", () => {
    type Loc = { id: number; ref?: number };
    const b = createBrowser<Loc>({
      isSameEntry: (a, c) => a.id === c.id,
      maxEntries: 2,
    });
    b.navigate({ id: 1 });
    b.navigate({ id: 2 });
    // Same logical page as the current entry — refresh in place, no growth.
    b.navigate({ id: 2, ref: 9 });
    flush();
    expect(b.length()).toBe(2);
    expect(b.current()).toEqual({ id: 2, ref: 9 });
  });

  it("publishes every mutation to a subscriber (the ◀/▶ enablement)", () => {
    const b = createBrowser<string>();
    const seen: Array<{ back: boolean; forward: boolean }> = [];
    const dispose = createRoot((d) => {
      createEffect(
        () => ({ back: b.canBack(), forward: b.canForward() }),
        (at) => {
          seen.push(at);
        },
      );
      return d;
    });
    // Effects run in the flush after creation, so this is the first reading.
    flush();
    expect(seen).toEqual([{ back: false, forward: false }]);

    b.navigate("a");
    b.navigate("b");
    flush();
    expect(seen.at(-1)).toEqual({ back: true, forward: false });

    b.back();
    flush();
    expect(seen.at(-1)).toEqual({ back: false, forward: true });

    b.reset();
    flush();
    expect(seen.at(-1)).toEqual({ back: false, forward: false });
    dispose();
  });

  it("reset clears the stack in place, and stays usable after", () => {
    const b = createBrowser<string>();
    b.navigate("a");
    b.navigate("b");
    flush();
    expect(b.canBack()).toBe(true);
    b.reset();
    flush();
    expect(b.current()).toBe(null);
    expect(b.length()).toBe(0);
    expect(b.canBack()).toBe(false);
    expect(b.canForward()).toBe(false);
    b.navigate("x");
    flush();
    expect(b.current()).toBe("x");
  });

  it("reset(initial) reseeds to a single entry in place", () => {
    const b = createBrowser<string>();
    b.navigate("a");
    b.navigate("b");
    b.reset("home");
    flush();
    expect(b.current()).toBe("home");
    expect(b.length()).toBe(1);
    expect(b.canBack()).toBe(false);
    expect(b.canForward()).toBe(false);
  });

  // reset() mutates the same signals navigate() does, and the subscriber case
  // above sees its publish land, so a reader holding the stable Browser
  // instance sees the change. That in-place property is the phase-2 fix —
  // history reset by *replacing* the instance stranded the toolbar's
  // subscriptions on the dead object and froze the ◀/▶ buttons; the e2e
  // ("back and forward retrace") guards the reactive wiring end-to-end.
});
