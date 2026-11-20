// @vitest-environment happy-dom
import { AttentionTriplet } from "@kolu/solid-statepip";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

function mountInto(view: () => ReturnType<typeof AttentionTriplet>) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(view, host);
  return host;
}

describe("AttentionTriplet — `active` is optional", () => {
  it("renders nothing at all when `active` is omitted and nothing else is up", () => {
    const el = mountInto(() => (
      <AttentionTriplet asking={0} unseen={0} sizeClass="h-4" />
    ));
    expect(el.querySelector('[data-testid="attention-triplet"]')).toBeNull();
  });

  it("never draws the spinner when omitted, even beside a needs-you capsule", () => {
    const el = mountInto(() => (
      <AttentionTriplet asking={2} unseen={0} sizeClass="h-4" />
    ));
    expect(
      el.querySelector('[data-testid="attention-asking"]')?.textContent,
    ).toBe("2");
    expect(el.querySelector('[data-testid="attention-active"]')).toBeNull();
  });

  it("surfaces that still pass `active` keep their spinner + count", () => {
    const el = mountInto(() => (
      <AttentionTriplet
        active={3}
        asking={0}
        unseen={0}
        sizeClass="h-4"
        scopeLabel="kolu"
      />
    ));
    const seg = el.querySelector('[data-testid="attention-active"]');
    expect(seg?.textContent?.trim()).toBe("3");
    expect(seg?.getAttribute("aria-label")).toBe("3 terminals active on kolu");
    expect(seg?.querySelector("svg")).not.toBeNull();
  });
});
