// @vitest-environment happy-dom
/**
 * #1962 — the connect overlay's elapsed timer ticks on wall clock with ZERO
 * incoming log frames. The real-app failure was a jump (3s → 40s) with no
 * intermediate ticks: re-renders only happened when connection frames arrived.
 *
 * Two regressions this suite must catch:
 *  1. Clock not tracked by the rendered expression → no per-second repaint.
 *  2. Re-anchoring on every effect re-run (same sinceMs) → wall extension wiped,
 *     label stuck at last frame's sinceMs until the next frame jumps it.
 */

import type { HostKey } from "kolu-common/hostKey";
import type { ConnectionInfo } from "kolu-common/surfacesWithPadi";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  // Reactive connection frame so we can re-fire the anchor effect with the SAME
  // sinceMs (simulating mode() recomputes / parent re-renders without a new
  // server duration) without remounting ConnectCanvas.
  let info: ConnectionInfo | undefined;
  const listeners = new Set<() => void>();
  return {
    host: { kind: "remote", target: "zest" } satisfies HostKey,
    get info() {
      return info;
    },
    setInfo(next: ConnectionInfo | undefined) {
      info = next;
      for (const l of listeners) l();
    },
    /** Solid-friendly subscribe used by the mock: tracks via a signal. */
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Test-only version signal the mock reads so connectionInfo is reactive. */
    version: 0,
    bump() {
      h.version += 1;
      for (const l of [...listeners]) l();
    },
  };
});

vi.mock("../wire", () => {
  // Lazy signal so createSignal runs after solid-js is available, not in hoisted.
  let ver: (() => number) | undefined;
  let setVer: ((n: number | ((p: number) => number)) => void) | undefined;
  const ensure = () => {
    if (!ver) {
      const pair = createSignal(0);
      ver = pair[0];
      setVer = pair[1];
      h.subscribe(() => setVer?.((n) => n + 1));
    }
  };
  return {
    activeHost: () => h.host,
    connectionInfo: () => {
      ensure();
      ver?.(); // track
      return h.info;
    },
  };
});

// Fake the shared clock so we control ticks without depending on setInterval
// wiring inside createSharedRoot.
const clock = vi.hoisted(() => {
  let now = 1_000_000;
  const subs = new Set<() => void>();
  return {
    read: () => now,
    advance(ms: number) {
      now += ms;
      for (const s of [...subs]) s();
    },
    subscribe(fn: () => void) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    reset() {
      now = 1_000_000;
      subs.clear();
    },
  };
});

vi.mock("../time/clock", () => ({
  getClockNow: () => {
    // Return a Solid signal accessor driven by our fake clock.
    const [n, setN] = createSignal(clock.read());
    clock.subscribe(() => setN(clock.read()));
    return n;
  },
}));

const { ConnectCanvas } = await import("./ConnectCanvas");

let dispose: (() => void) | undefined;
beforeEach(() => {
  clock.reset();
  h.setInfo(undefined);
  document.body.innerHTML = "";
});
afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = "";
});

const elapsed = () =>
  document.querySelector('[data-testid="connect-elapsed"]')?.textContent ??
  null;

describe("ConnectCanvas elapsed timer (#1962)", () => {
  it("ticks every second with ZERO incoming log frames", async () => {
    h.setInfo({
      phase: "building",
      log: [{ source: "local", line: "6 paths done · 84 B of 84 B" }],
      sinceMs: 3_000,
    });

    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
    expect(elapsed()).toBe("3s");

    // Advance the shared clock 1s at a time — no connection-frame updates.
    // Pre-fix this stayed "3s" until a log frame jumped it to "40s".
    clock.advance(1_000);
    expect(elapsed()).toBe("4s");
    clock.advance(1_000);
    expect(elapsed()).toBe("5s");
    clock.advance(5_000);
    expect(elapsed()).toBe("10s");
  });

  it("keeps ticking when the anchor effect re-runs with the SAME sinceMs", async () => {
    // Simulates mode() object identity thrash / parent re-render that re-fires
    // the createEffect without a new server duration — the freeze that wiped
    // wall-clock extension by re-baselining `at` every time.
    h.setInfo({
      phase: "copying",
      log: [{ source: "local", line: "copying 6 paths…" }],
      sinceMs: 3_000,
    });
    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
    expect(elapsed()).toBe("3s");

    clock.advance(2_000);
    expect(elapsed()).toBe("5s");

    // Same sinceMs, new object identity — effect re-runs, must NOT reset.
    h.setInfo({
      phase: "copying",
      log: [{ source: "local", line: "path 2 of 6 · 10.0 MiB of 50.0 MiB" }],
      sinceMs: 3_000,
    });
    expect(elapsed()).toBe("5s"); // still extended, not back to 3s

    clock.advance(3_000);
    expect(elapsed()).toBe("8s");
  });

  it("re-baselines when the server sinceMs advances (stays honest to the session clock)", async () => {
    h.setInfo({
      phase: "building",
      log: [{ source: "local", line: "building" }],
      sinceMs: 3_000,
    });
    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
    clock.advance(2_000);
    expect(elapsed()).toBe("5s");

    // Server frame with a larger sinceMs (e.g. after a quiet period) — re-anchor.
    h.setInfo({
      phase: "building",
      log: [{ source: "local", line: "building" }],
      sinceMs: 40_000,
    });
    expect(elapsed()).toBe("40s");
    clock.advance(1_000);
    expect(elapsed()).toBe("41s");
  });

  it("suppresses the sub-1s flash on a fresh frame", async () => {
    h.setInfo({
      phase: "connecting",
      log: [],
      sinceMs: 200,
    });
    dispose = render(
      () => <ConnectCanvas daemonState={undefined} />,
      document.body,
    );
    expect(
      document.querySelector('[data-testid="connect-elapsed"]'),
    ).toBeNull();
  });
});
