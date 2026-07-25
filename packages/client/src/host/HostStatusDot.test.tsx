// @vitest-environment happy-dom
/**
 * The host tab's connection dot, and the forward RING around it.
 *
 * Field feedback replaced a separate `⇄ n` chip with a marker on the dot: the
 * dot is already the click target that opens the dropdown listing the forwards,
 * so a second chip beside it was chrome for a fact the dot could carry.
 *
 * The load-bearing property is the one this file exists to pin: **the ring never
 * touches the pip's colour.** That colour is painted from the connection-health
 * fact and nothing else (`.claude/rules/solidjs.md` — never colour a status dot
 * from anything but the fact), so the forward marker has to compose AROUND it.
 * A ring that recoloured the pip would be a green-over-a-dead-link dot by a new
 * route, which is exactly the class of bug that rule exists to make unrenderable.
 */

import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { HostStatusDot } from "./HostStatusDot";

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
});

function mount(props: { statusDot: string; forwardCount: number }) {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(() => <HostStatusDot {...props} />, host);
  return {
    pip: host.querySelector('[data-testid="host-status-pip"]'),
    ring: host.querySelector('[data-testid="host-forward-ring"]'),
  };
}

/** Two real pip tones, so the ring is proved over more than the happy one. */
const READY = "bg-emerald-400";
const DOWN = "bg-rose-400";

describe("HostStatusDot", () => {
  it("draws no ring when the host has no forwards", () => {
    const { pip, ring } = mount({ statusDot: READY, forwardCount: 0 });
    expect(pip).not.toBeNull();
    expect(ring).toBeNull();
  });

  it("draws a ring when the host has forwards", () => {
    const { pip, ring } = mount({ statusDot: READY, forwardCount: 2 });
    expect(pip).not.toBeNull();
    expect(ring).not.toBeNull();
  });

  it("carries the COUNT in the accessible label, not in the visual", () => {
    // The count left the chrome and moved here: the ring says "there are
    // forwards", the label says how many, and the dropdown holds the rows.
    const { ring } = mount({ statusDot: READY, forwardCount: 2 });
    expect(ring?.getAttribute("aria-label")).toMatch(/2 forwarded ports/);
    // …and it is not rendered as text, which is the whole point of the change.
    expect(ring?.textContent?.trim()).toBe("");
  });

  it("says 'port' rather than 'ports' for one", () => {
    const { ring } = mount({ statusDot: READY, forwardCount: 1 });
    expect(ring?.getAttribute("aria-label")).toMatch(/1 forwarded port\b/);
    expect(ring?.getAttribute("aria-label")).not.toMatch(/ports/);
  });

  it("leaves the pip's COLOUR untouched, forwards or not", () => {
    // The hard rule: the pip is painted from the connection-health fact alone.
    // The ring composes around it and may never recolour or replace it.
    const without = mount({ statusDot: READY, forwardCount: 0 }).pip?.className;
    dispose?.();
    host?.remove();
    const withRing = mount({ statusDot: READY, forwardCount: 3 }).pip
      ?.className;
    expect(withRing).toBe(without);
    expect(withRing).toContain(READY);
  });

  it("renders the ring over a DOWN pip too, not just a healthy one", () => {
    // A host can be unreachable while kolu still holds doors it opened before
    // the link dropped, so the ring has to read over every pip state.
    const { pip, ring } = mount({ statusDot: DOWN, forwardCount: 1 });
    expect(ring).not.toBeNull();
    expect(pip?.className).toContain(DOWN);
  });

  it("carries no colour of its own — the ring is geometry", () => {
    // Stated as a property rather than a screenshot: a ring class that painted a
    // background would be recolouring the dot area from a non-health fact.
    const { ring } = mount({ statusDot: READY, forwardCount: 1 });
    expect(ring?.className).not.toMatch(/\bbg-/);
  });
});
