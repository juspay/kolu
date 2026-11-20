// @vitest-environment happy-dom

import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import { forwardRingLabel, HostStatusDot } from "./HostStatusDot";

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

  it("draws nothing and announces nothing — the button owns both", () => {
    const { ring } = mount({ statusDot: READY, forwardCount: 2 });
    expect(ring?.textContent?.trim()).toBe("");
    expect(ring?.getAttribute("aria-hidden")).toBe("true");
    expect(ring?.getAttribute("aria-label")).toBeNull();
    expect(ring?.getAttribute("data-count")).toBe("2");
  });

  it("says 'port' rather than 'ports' for one", () => {
    expect(forwardRingLabel(1)).toMatch(/1 forwarded port\b/);
    expect(forwardRingLabel(1)).not.toMatch(/ports/);
    expect(forwardRingLabel(2)).toMatch(/2 forwarded ports/);
  });

  it("leaves the pip's COLOUR untouched, forwards or not", () => {
    const without = mount({ statusDot: READY, forwardCount: 0 }).pip?.className;
    dispose?.();
    host?.remove();
    const withRing = mount({ statusDot: READY, forwardCount: 3 }).pip
      ?.className;
    expect(withRing).toBe(without);
    expect(withRing).toContain(READY);
  });

  it("renders the ring over a DOWN pip too, not just a healthy one", () => {
    const { pip, ring } = mount({ statusDot: DOWN, forwardCount: 1 });
    expect(ring).not.toBeNull();
    expect(pip?.className).toContain(DOWN);
  });

  it("is a HAIRLINE — the weight is what made the first ring jarring", () => {
    const { ring } = mount({ statusDot: READY, forwardCount: 1 });
    expect(ring?.className).toMatch(/(^|\s)ring-1(\s|$)/);
    expect(ring?.className).not.toMatch(/ring-2|ring-4|border-2/);
    expect(ring?.className).not.toMatch(/ring-offset-[1-9]/);
  });

  it("marks in the FORWARD colour, never the connection colour", () => {
    const { ring } = mount({ statusDot: READY, forwardCount: 1 });
    expect(ring?.className).toMatch(/teal/);
    expect(ring?.className).not.toMatch(/emerald|green|accent/);
  });
});
