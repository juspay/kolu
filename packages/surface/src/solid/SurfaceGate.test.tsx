// @vitest-environment happy-dom
/**
 * `<SurfaceGate>` is the ONE place subscription-health POLICY lives — it turns the
 * `client.health()` FACT into a `connecting | degraded | ready` verdict and gates
 * its children on it. Two halves are pinned here:
 *
 *   - `gateStatus(health)` — the pure verdict function (no DOM). The triage every
 *     consumer inherits unless it overrides `ready`.
 *   - the rendered component — children appear ONLY when ready; the fallback shows
 *     otherwise; and a degraded→ready transition re-renders children IN PLACE
 *     (the un-latchable property the whole #1564 fix turns on — a stale error can
 *     never freeze the gate once the underlying `health()` clears).
 *
 * The component is driven by a plain SIGNAL health accessor: a bare signal
 * propagates reactively in this scheduler-less node+happy-dom test env (a
 * `createStore`-backed value would not — see `surfaceClient.health.test.ts`), and
 * `health()` is itself just an accessor consumers read, so a signal is a faithful
 * stand-in for the real fact.
 */

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it } from "vitest";
import type { SurfaceHealth } from "./health";
import { gateStatus, SurfaceGate } from "./SurfaceGate";

const ready: SurfaceHealth = { live: true, subs: [] };
const connectingPending: SurfaceHealth = {
  live: true,
  subs: [{ name: "conn", pending: true, error: undefined }],
};
const connectingDead: SurfaceHealth = { live: false, subs: [] };
const degraded: SurfaceHealth = {
  live: true,
  subs: [
    { name: "conn", pending: false, error: new Error("Internal server error") },
  ],
};

describe("gateStatus — the pure verdict", () => {
  it("connecting when the transport is not live", () => {
    expect(gateStatus(connectingDead)).toBe("connecting");
  });
  it("connecting when any sub is still awaiting its first frame", () => {
    expect(gateStatus(connectingPending)).toBe("connecting");
  });
  it("degraded when live and past first-frame but a sub is erroring", () => {
    expect(gateStatus(degraded)).toBe("degraded");
  });
  it("ready when live, every sub past first-frame, none erroring", () => {
    expect(gateStatus(ready)).toBe("ready");
    expect(
      gateStatus({
        live: true,
        subs: [{ name: "conn", pending: false, error: undefined }],
      }),
    ).toBe("ready");
  });
  it("an error OUTRANKS a concurrent pending — degraded, not connecting (no masked error)", () => {
    // A live surface with one sub still loading (pending) AND another erroring reads
    // `degraded`, NOT `connecting`: a present error is a real, actionable problem that
    // must not be MASKED behind a still-loading sibling. Reporting `connecting` here
    // was the round-5-found relocation of the #1564 lie — a consumer coloring the
    // `connecting` verdict from a transport∘mirror-only signal painted a green dot
    // while the erroring sub was silently dead. So the error always surfaces.
    expect(
      gateStatus({
        live: true,
        subs: [
          { name: "a", pending: true, error: undefined },
          { name: "b", pending: false, error: new Error("x") },
        ],
      }),
    ).toBe("degraded");
  });
});

const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) {
    try {
      dispose();
    } catch {
      /* best-effort teardown */
    }
  }
  document.body.innerHTML = "";
});

function mount(initial: SurfaceHealth) {
  const [health, setHealth] = createSignal<SurfaceHealth>(initial);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const dispose = render(
    () => (
      <SurfaceGate health={health}>
        <div data-testid="body">terminals</div>
      </SurfaceGate>
    ),
    container,
  );
  disposers.push(dispose);
  return { container, setHealth };
}

describe("<SurfaceGate> — the rendered policy", () => {
  it("hides children and shows the connecting fallback while not ready", () => {
    const { container } = mount(connectingPending);
    expect(container.querySelector('[data-testid="body"]')).toBeNull();
    expect(container.textContent).toContain("Connecting");
  });

  it("renders children when ready", () => {
    const { container } = mount(ready);
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe(
      "terminals",
    );
  });

  it("DEFAULT policy keeps children visible while degraded (stale-while-degraded), with a non-blocking notice", () => {
    const { container } = mount(degraded);
    // The default is the gentler policy: a transient sub error keeps the
    // last-good children ON SCREEN (a stale roster beats a blank one) and
    // surfaces the error in a non-blocking notice beside them.
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe(
      "terminals",
    );
    expect(container.textContent).toContain("Internal server error");
  });

  it("DEFAULT policy: the degraded notice self-clears on recovery without remounting the children", () => {
    const { container, setHealth } = mount(degraded);
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe(
      "terminals",
    );
    expect(container.textContent).toContain("Internal server error");
    // The underlying health fact clears (the self-clearing error() the registry
    // folds): the notice disappears, the children never flicker.
    setHealth(ready);
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe(
      "terminals",
    );
    expect(container.textContent).not.toContain("Internal server error");
  });

  it("self-heals under a HARD GATE: a degraded→ready transition re-renders children IN PLACE (no latch)", () => {
    const [health, setHealth] = createSignal<SurfaceHealth>(degraded);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        // Hard-gate opt-in: blank the surface the instant anything errors — the
        // harsher policy, now explicit rather than the default.
        <SurfaceGate health={health} ready={(h) => gateStatus(h) === "ready"}>
          <div data-testid="body">terminals</div>
        </SurfaceGate>
      ),
      container,
    );
    disposers.push(dispose);
    // Frozen on the error first — the hard gate is closed.
    expect(container.querySelector('[data-testid="body"]')).toBeNull();
    expect(container.textContent).toContain("Internal server error");
    // The underlying health fact clears. The OLD hand-latched fold would stay
    // stuck here; the gate does not — the un-latch the whole #1564 fix turns on.
    setHealth(ready);
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe(
      "terminals",
    );
    expect(container.textContent).not.toContain("Internal server error");
  });

  it("DEFAULT policy: a COLD dead transport blanks (never painted)", () => {
    // First connect with `!live` and no prior paint → the blocking connecting
    // fallback, exactly as before the render-while-reconnecting latch.
    const { container } = mount(connectingDead);
    expect(container.querySelector('[data-testid="body"]')).toBeNull();
    expect(container.textContent).toContain("Connecting");
  });

  it("DEFAULT policy: a transport drop AFTER first paint keeps children (stale-while-reconnecting)", () => {
    // Reach `ready` first (the latch records the first paint)…
    const { container, setHealth } = mount(ready);
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe(
      "terminals",
    );
    // …then lose the transport (`live: false`). A blip must NOT blank a
    // populated surface — the body STAYS, under a non-blocking reconnecting
    // notice (the transport analog of stale-while-degraded). The pre-latch
    // default hard-blanked here on every transient socket drop.
    setHealth(connectingDead);
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe(
      "terminals",
    );
    expect(container.textContent).toContain("Reconnecting");
    // And it recovers in place when the transport returns.
    setHealth(ready);
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe(
      "terminals",
    );
    expect(container.textContent).not.toContain("Reconnecting");
  });

  it("honors a hard-gate `ready` override (pulam-web's stricter policy)", () => {
    const [health, setHealth] = createSignal<SurfaceHealth>(degraded);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(
      () => (
        <SurfaceGate
          health={health}
          // Stricter than the default: ANY error or pending closes the gate.
          ready={(h) => h.live && h.subs.every((s) => !s.error && !s.pending)}
        >
          <div data-testid="body">terminals</div>
        </SurfaceGate>
      ),
      container,
    );
    disposers.push(dispose);
    // degraded → closed under the override.
    expect(container.querySelector('[data-testid="body"]')).toBeNull();
    // clears → open.
    setHealth(ready);
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe(
      "terminals",
    );
  });
});
