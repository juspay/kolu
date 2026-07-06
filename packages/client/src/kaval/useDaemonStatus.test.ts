/** F-a — "create refused while warming". The warming DECISION
 *  (`liveWarmingWithPadiLink`) is pinned in daemonPresentation.test; here we pin the
 *  `refuseIfWarming` guard that both terminal-create call sites funnel through: while
 *  the active binding is (re)connecting it BLOCKS the create and toasts, and once the
 *  binding is connected it lets the create through. The binding subs are mocked so the
 *  test can set the connection/daemon state directly. */

import { describe, expect, it, vi } from "vitest";

// Controllable per-host state the mocked subs report.
const state = {
  connState: "connecting" as string | undefined,
  daemonState: undefined as string | undefined,
  transportLive: true,
};

vi.mock("../wire", () => ({
  app: { health: () => ({ live: state.transportLive }) },
}));
vi.mock("../binding/bindings", () => ({
  // `useBindingScopedSub(pick)` returns `() => Accessor<sub>`, so the module reads
  // `sub()()`. Both the daemonStatus collection sub (read via `.byKey(local)?.()`)
  // and the connection cell sub (read via `.value()`) resolve through this one fake.
  useBindingScopedSub: () => () => () => ({
    byKey: () =>
      state.daemonState === undefined
        ? undefined
        : () => ({ state: state.daemonState }),
    value: () =>
      state.connState === undefined ? undefined : { state: state.connState },
  }),
}));
vi.mock("solid-sonner", () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn() },
}));
vi.mock("../persistedPref", () => ({
  persistedPref: () => [() => undefined, () => {}],
}));
vi.mock("./reattachAnnounce", () => ({ announceReattach: vi.fn() }));

const { refuseIfWarming, daemonWarming } = await import("./useDaemonStatus");
const { toast } = await import("solid-sonner");

describe("refuseIfWarming (F-a: create refused while warming)", () => {
  it("BLOCKS + toasts while the active binding is (re)connecting", () => {
    state.connState = "connecting"; // padi link connecting → warming
    state.daemonState = undefined;
    state.transportLive = true;
    vi.mocked(toast.warning).mockClear();
    expect(daemonWarming()).toBe(true);
    expect(refuseIfWarming()).toBe(true); // create is refused
    expect(toast.warning).toHaveBeenCalledTimes(1); // and the user is told why
  });

  it("LETS THE CREATE THROUGH once the binding is connected (no block, no toast)", () => {
    state.connState = "connected"; // padi link connected…
    state.daemonState = "connected"; // …and the kaval daemon is up (not warming)
    state.transportLive = true;
    vi.mocked(toast.warning).mockClear();
    expect(daemonWarming()).toBe(false);
    expect(refuseIfWarming()).toBe(false); // create proceeds
    expect(toast.warning).not.toHaveBeenCalled();
  });
  // The transport-liveness floor (a dead/half-open link reads NOT-warming so ⌘T
  // isn't locked off a frozen state) is pinned in daemonPresentation.test's
  // `liveWarmingWithPadiLink` cases; not re-driven here (the shared transport-live
  // memo is app-lifetime, so it can't be toggled per-test).
});
