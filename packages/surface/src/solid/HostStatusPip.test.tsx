// @vitest-environment happy-dom
/**
 * `<HostStatusPip>` — the ONE connection dot, green ONLY from the complete fact.
 *
 * The round-5 property under test: a green dot is UNRENDERABLE except through the
 * `ready` verdict over the FACT. There is no raw-state prop, so the round-4 lie
 * (green painted from a stale `connection.state`) has no expressible form; and the
 * `notReadyTone` callback never sees the ready state, so it can't tint the
 * not-ready dot as if it were ready. A custom `ready` predicate (pulam-web's, which
 * ignores `pending`) governs the green exactly as the body gate does, so dot and
 * gate are the same decision.
 *
 * Driven by a plain SIGNAL health accessor (the scheduler-less node+happy-dom env;
 * see `surfaceClient.health.test.ts`).
 */

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { SurfaceHealth } from "./health";
import { HostStatusPip } from "./HostStatusPip";

const READY: SurfaceHealth = {
  live: true,
  subs: [{ name: "conn", pending: false, error: undefined }],
};
const DEAD: SurfaceHealth = { live: false, subs: [] };
const PENDING: SurfaceHealth = {
  live: true,
  subs: [{ name: "conn", pending: true, error: undefined }],
};
const DEGRADED: SurfaceHealth = {
  live: true,
  subs: [{ name: "conn", pending: false, error: new Error("boom") }],
};

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function mount(node: () => unknown): HTMLSpanElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  // biome-ignore lint/suspicious/noExplicitAny: render's JSX element type
  const dispose = render(node as any, container);
  disposers.push(dispose, () => container.remove());
  return container.querySelector("span") as HTMLSpanElement;
}

describe("HostStatusPip — green is fact-only (round-5 single-source)", () => {
  it("renders the ready color ONLY when the fact is ready", () => {
    const [h, setH] = createSignal<SurfaceHealth>(DEAD);
    const dot = mount(() => (
      <HostStatusPip
        health={h}
        readyColor="#7ec699"
        notReadyTone={() => "#ff0000"}
      />
    ));
    // Not ready: honest status, NOT the ready color.
    expect(dot.getAttribute("data-health")).toBe("connecting");
    expect(dot.style.background).not.toBe("#7ec699");
    // Ready: green.
    setH(READY);
    expect(dot.getAttribute("data-health")).toBe("ready");
    expect(dot.style.background).toBe("#7ec699");
    // Back to dead: green gone.
    setH(DEAD);
    expect(dot.getAttribute("data-health")).toBe("connecting");
    expect(dot.style.background).toBe("#ff0000");
  });

  it("never reports `ready` while not ready, no matter what notReadyTone returns", () => {
    // An app that (wrongly) returns the green from notReadyTone still can't make
    // the FACT read ready — `data-health` is honest, and the readyColor branch is
    // reachable ONLY via the ready verdict, never from a raw signal.
    const [h] = createSignal<SurfaceHealth>(DEGRADED);
    const dot = mount(() => (
      <HostStatusPip
        health={h}
        readyColor="#7ec699"
        notReadyTone={() => "#7ec699"}
      />
    ));
    expect(dot.getAttribute("data-health")).not.toBe("ready");
    expect(dot.getAttribute("data-health")).toBe("degraded");
  });

  it("a custom `ready` predicate governs green and matches a gate (ignores pending)", () => {
    // pulam-web's predicate: live ∧ no error, IGNORING pending — so the dot stays
    // green while data loads (matching a body gate with its own loading states),
    // and a sub error drops it to degraded.
    const ready = (hh: SurfaceHealth): boolean =>
      hh.live && !hh.subs.some((s) => s.error);
    const [h, setH] = createSignal<SurfaceHealth>(PENDING);
    const dot = mount(() => (
      <HostStatusPip
        health={h}
        ready={ready}
        readyColor="#7ec699"
        notReadyTone={(s) => (s === "degraded" ? "#e6a23c" : "#ff0000")}
      />
    ));
    // gateStatus(PENDING) === "connecting", but the custom predicate is ready.
    expect(dot.getAttribute("data-health")).toBe("ready");
    expect(dot.style.background).toBe("#7ec699");
    // A sub errors → custom ready false → degraded amber, never green.
    setH(DEGRADED);
    expect(dot.getAttribute("data-health")).toBe("degraded");
    expect(dot.style.background).toBe("#e6a23c");
    // Transport dies → connecting tone, never green.
    setH(DEAD);
    expect(dot.getAttribute("data-health")).toBe("connecting");
    expect(dot.style.background).toBe("#ff0000");
  });
});
