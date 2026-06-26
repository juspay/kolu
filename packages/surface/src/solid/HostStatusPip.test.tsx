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
import { HostStatusPip } from "./HostStatusPip";
import type { SurfaceHealth } from "./health";

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
// The round-5-found relocation: live, with ONE sub still pending AND ANOTHER
// erroring. `gateStatus` must report `degraded` (the error OUTRANKS the concurrent
// pending), never `connecting` — a masked error let a transport∘mirror-only tone
// paint a green dot while a sub was silently dead.
const MASKED: SurfaceHealth = {
  live: true,
  subs: [
    { name: "loading", pending: true, error: undefined },
    { name: "dead", pending: false, error: new Error("boom") },
  ],
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

  it("REFUSES a not-ready tone equal to readyColor — green can't be forged for a not-ready fact", () => {
    // The round-5-found hole: `notReadyTone`'s RETURN is an unconstrained string, so
    // an app CAN hand back the ready color (pulam-web's transport∘mirror tone was
    // green for a connected link). The component refuses it LOUDLY rather than paint
    // a green dot over a not-ready fact — the #1564 lie, one prop over, made to crash.
    const [h] = createSignal<SurfaceHealth>(DEGRADED);
    expect(() =>
      mount(() => (
        <HostStatusPip
          health={h}
          readyColor="#7ec699"
          notReadyTone={() => "#7ec699"}
        />
      )),
    ).toThrow(/notReadyTone returned the readyColor/);
  });

  it("an error OUTRANKS a concurrent pending — a masked-error fact reads degraded, dot amber, never green", () => {
    // pulam-web's exact trigger (sleep/wake): transport live + mirror connected
    // (fact.live), one sub still loading (pending) while another is dead (error).
    // gateStatus must report `degraded` (not `connecting`), so the custom
    // hostBodyReady predicate (ignores pending, fails on error) drives a degraded
    // dot. The tone returns the ready color for any NON-degraded status, so if
    // gateStatus wrongly masked the error as `connecting` this would THROW — proving
    // the precedence routes to degraded amber, never the connected green.
    const ready = (hh: SurfaceHealth): boolean =>
      hh.live && !hh.subs.some((s) => s.error);
    const [h] = createSignal<SurfaceHealth>(MASKED);
    const dot = mount(() => (
      <HostStatusPip
        health={h}
        ready={ready}
        readyColor="#7ec699"
        notReadyTone={(s) => (s === "degraded" ? "#e6a23c" : "#7ec699")}
      />
    ));
    expect(dot.getAttribute("data-health")).toBe("degraded");
    expect(dot.style.background).toBe("#e6a23c");
    expect(dot.style.background).not.toBe("#7ec699");
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
