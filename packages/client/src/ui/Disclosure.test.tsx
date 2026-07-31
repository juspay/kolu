// @vitest-environment happy-dom
/**
 * `Disclosure`'s `open` prop is a reactive DEFAULT, not a controlled value, and
 * its docstring makes a promise about that: the fact re-asserts itself when it
 * CHANGES, and a manual toggle in between is left alone — "the user's click
 * wins until the fact changes again."
 *
 * That is a promise about the VALUE. The original implementation only kept it
 * for callers who happened to pass a narrow leaf read: `createEffect(() => {
 * el.open = props.open })` re-runs on every DEPENDENCY tick, so a caller whose
 * `open` expression reaches through a bundle memo re-asserted `false` on every
 * unrelated field change and slammed the list shut under the user's hand.
 *
 * The Inspector became exactly that caller (`open={p().hasException}`, where
 * `p()` carries the whole PR), which is what these tests pin — at the component
 * that makes the promise, so no future caller can express the bug either.
 */

import { createMemo, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import Disclosure from "./Disclosure";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

/** Mount with `open` reached through a BUNDLE — a memo returning a fresh object
 *  each recompute, which is how the Inspector's `work()` memo feeds it. The
 *  boolean is one field of that object, so the bundle's identity turns over on
 *  every unrelated field change while `hasException` itself holds still. */
function mountBundled(initial: { hasException: boolean; title: string }) {
  const [fact, setFact] = createSignal(initial);
  const bundle = createMemo(() => ({ ...fact() }));
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <Disclosure summary="checks" open={bundle().hasException}>
        <span>body</span>
      </Disclosure>
    ),
    host,
  );
  return { setFact };
}

const details = () => host?.querySelector("details");

describe("Disclosure open-state", () => {
  it("applies the initial fact", () => {
    mountBundled({ hasException: true, title: "a" });
    expect(details()?.open).toBe(true);
  });

  it("keeps a manual toggle across an unrelated change in the same bundle", () => {
    const { setFact } = mountBundled({ hasException: false, title: "a" });
    expect(details()?.open).toBe(false);

    // The user opens the all-green list by hand.
    const el = details();
    if (!el) throw new Error("no <details> rendered");
    el.open = true;

    // A live CI poll updates an unrelated field. `hasException` has NOT
    // changed, so the user's click must survive — this is the regression:
    // before the fix the bundle's new identity re-ran the effect and wrote
    // `false` back, closing the list mid-run.
    setFact({ hasException: false, title: "b" });

    expect(details()?.open).toBe(true);
  });

  it("still re-asserts when the fact itself changes", () => {
    const { setFact } = mountBundled({ hasException: false, title: "a" });
    const el = details();
    if (!el) throw new Error("no <details> rendered");
    el.open = true;

    // A check flips to `fail`: the fact changed, so it overrides the manual
    // toggle in BOTH directions. Without this, "don't clobber the user" could
    // be satisfied by never re-asserting at all.
    setFact({ hasException: true, title: "a" });
    expect(details()?.open).toBe(true);

    setFact({ hasException: false, title: "a" });
    expect(details()?.open).toBe(false);
  });
});
