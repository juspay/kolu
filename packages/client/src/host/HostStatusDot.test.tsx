// @vitest-environment happy-dom
/**
 * The host tab's connection dot, and the forward NOTCH on its corner.
 *
 * Field feedback replaced a separate `⇄ n` chip with a marker on the dot: the
 * dot is already the click target that opens the dropdown listing the forwards,
 * so a second chip beside it was chrome for a fact the dot could carry.
 *
 * The load-bearing property is the one this file exists to pin: **the notch never
 * touches the pip's colour.** That colour is painted from the connection-health
 * fact and nothing else (`.claude/rules/solidjs.md` — never colour a status dot
 * from anything but the fact), so the forward marker has to compose AROUND it.
 * A notch that recoloured the pip would be a green-over-a-dead-link dot by a new
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
    notch: host.querySelector('[data-testid="host-forward-notch"]'),
  };
}

/** Two real pip tones, so the notch is proved over more than the happy one. */
const READY = "bg-emerald-400";
const DOWN = "bg-rose-400";

describe("HostStatusDot", () => {
  it("draws no notch when the host has no forwards", () => {
    const { pip, notch } = mount({ statusDot: READY, forwardCount: 0 });
    expect(pip).not.toBeNull();
    expect(notch).toBeNull();
  });

  it("draws a notch when the host has forwards", () => {
    const { pip, notch } = mount({ statusDot: READY, forwardCount: 2 });
    expect(pip).not.toBeNull();
    expect(notch).not.toBeNull();
  });

  it("carries the COUNT in the accessible label, not in the visual", () => {
    // The count left the chrome and moved here: the notch says "there are
    // forwards", the label says how many, and the dropdown holds the rows.
    const { notch } = mount({ statusDot: READY, forwardCount: 2 });
    expect(notch?.getAttribute("aria-label")).toMatch(/2 forwarded ports/);
    // The COUNT is not rendered — the notch shows the forward glyph, so the
    // badge says "doors are open here" and the label says how many. A number
    // baked into a 13px badge would be unreadable and would compete with the
    // attention pills for the same job.
    expect(notch?.textContent?.trim()).toBe("⇄");
  });

  it("says 'port' rather than 'ports' for one", () => {
    const { notch } = mount({ statusDot: READY, forwardCount: 1 });
    expect(notch?.getAttribute("aria-label")).toMatch(/1 forwarded port\b/);
    expect(notch?.getAttribute("aria-label")).not.toMatch(/ports/);
  });

  it("leaves the pip's COLOUR untouched, forwards or not", () => {
    // The hard rule: the pip is painted from the connection-health fact alone.
    // The notch composes around it and may never recolour or replace it.
    const without = mount({ statusDot: READY, forwardCount: 0 }).pip?.className;
    dispose?.();
    host?.remove();
    const withRing = mount({ statusDot: READY, forwardCount: 3 }).pip
      ?.className;
    expect(withRing).toBe(without);
    expect(withRing).toContain(READY);
  });

  it("renders the notch over a DOWN pip too, not just a healthy one", () => {
    // A host can be unreachable while kolu still holds doors it opened before
    // the link dropped, so the notch has to read over every pip state.
    const { pip, notch } = mount({ statusDot: DOWN, forwardCount: 1 });
    expect(notch).not.toBeNull();
    expect(pip?.className).toContain(DOWN);
  });

  it("reads as its OWN object — a bordered badge, not an outline on the pip", () => {
    // The notch replaced a teal RING, and the reason is worth keeping: the ring
    // was JARRING — an outline drawn around the pip is visually heavy-handed,
    // and it read as chrome applied TO the dot rather than as a second fact
    // sitting beside it. A small badge overlapping the corner, bordered in the
    // tab's own background, is a separate object — which is what it is.
    const { notch } = mount({ statusDot: READY, forwardCount: 1 });
    expect(notch?.className).toMatch(/absolute/);
    expect(notch?.className).toMatch(/border/);
  });

  it("marks in the FORWARD colour, never the connection colour", () => {
    // The one binding rule of the approved UX pass: green means connection
    // health, teal means open doors, and neither surface may borrow the other's.
    // A green marker is a second, quieter way of saying "connected" rather than
    // a fact of its own — which is what the first cut drew by reusing the accent.
    const { notch } = mount({ statusDot: READY, forwardCount: 1 });
    expect(notch?.className).toMatch(/teal/);
    expect(notch?.className).not.toMatch(/emerald|green|accent/);
  });
});
