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
  it("prefers connecting over degraded when a sub both pends and others error", () => {
    // A reconnecting surface (some sub pending) reads `connecting`, NOT `degraded`,
    // even if a sibling carries a stale error — first-frame wins.
    expect(
      gateStatus({
        live: true,
        subs: [
          { name: "a", pending: true, error: undefined },
          { name: "b", pending: false, error: new Error("x") },
        ],
      }),
    ).toBe("connecting");
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

  it("surfaces the first sub error in the degraded fallback", () => {
    const { container } = mount(degraded);
    expect(container.querySelector('[data-testid="body"]')).toBeNull();
    expect(container.textContent).toContain("Internal server error");
  });

  it("self-heals: a degraded→ready transition re-renders children IN PLACE (no latch)", () => {
    const { container, setHealth } = mount(degraded);
    // Frozen on the error first — the gate is closed.
    expect(container.querySelector('[data-testid="body"]')).toBeNull();
    expect(container.textContent).toContain("Internal server error");
    // The underlying health fact clears (the self-clearing error() the registry
    // folds). The OLD hand-latched fold would stay stuck here; the gate does not.
    setHealth(ready);
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe(
      "terminals",
    );
    expect(container.textContent).not.toContain("Internal server error");
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
