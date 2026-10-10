// @vitest-environment happy-dom
/**
 * The host tab's attention summary keeps ONE width as agents start and stop.
 *
 * `AttentionTriplet` (`@kolu/solid-statepip`) used to always draw its `active`
 * segment — a rust spinner plus a bare count — so on the host tab that segment
 * appeared and vanished with every agent turn, the tab's width changed, and
 * every tab after it shifted. The host tab now OMITS `active` (it runs a stripe
 * along its bottom edge instead, see `hostTabWorkingStripe.test.tsx`), and this file pins the
 * component half of that contract: omitted means no segment and no width, while
 * the surfaces that still pass it keep their spinner. Lives in the client
 * because this is the package with the Solid DOM harness.
 */

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
    // The host tab with ten working agents and none asking/unseen: the triplet
    // must contribute zero width, exactly as it does with nothing working.
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
    // The dock section header, host switcher row and mobile host chip carry no
    // edge for a running stripe, so they keep the segment.
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
