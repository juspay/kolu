// @vitest-environment happy-dom

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

    const el = details();
    if (!el) throw new Error("no <details> rendered");
    el.open = true;

    setFact({ hasException: false, title: "b" });

    expect(details()?.open).toBe(true);
  });

  it("still re-asserts when the fact itself changes", () => {
    const { setFact } = mountBundled({ hasException: false, title: "a" });
    const el = details();
    if (!el) throw new Error("no <details> rendered");
    el.open = true;

    setFact({ hasException: true, title: "a" });
    expect(details()?.open).toBe(true);

    setFact({ hasException: false, title: "a" });
    expect(details()?.open).toBe(false);
  });
});
