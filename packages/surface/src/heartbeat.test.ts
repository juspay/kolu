/**
 * The lifted half-open-link watchdog (`@kolu/surface/heartbeat`) — the algorithm
 * both legs share. The browser leg's partysocket-shaped wrapper is exercised
 * end-to-end in `@kolu/surface-app`'s `connect.test.ts`, and the ssh leg in
 * `@kolu/surface-nix-host`'s `liveness.test.ts`; here we pin the two injected
 * variation points directly — the `isLive` GATE and the `onStale` ACTION — plus
 * the race/settle/skip-overlap/dispose invariants, framework-free.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHeartbeat,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
} from "./heartbeat";

describe("createHeartbeat (lifted primitive)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("ships the shared 15s/10s cadence so both legs pin the same numbers", () => {
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(15_000);
    expect(DEFAULT_HEARTBEAT_TIMEOUT_MS).toBe(10_000);
  });

  it("never probes while isLive() is false (the gate)", async () => {
    const probe = vi.fn().mockResolvedValue(null);
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      isLive: () => false,
      onStale,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(probe).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
    dispose();
  });

  it("runs onStale (the action) FIRST, then onStaleReport, on a missed probe", async () => {
    const order: string[] = [];
    const onStale = vi.fn(() => order.push("action"));
    const onStaleReport = vi.fn(() => order.push("report"));
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      onStaleReport,
      probe: () => new Promise<never>(() => {}), // never answers
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1500); // tick + probe timeout
    expect(order).toEqual(["action", "report"]);
    dispose();
  });

  it("still runs onStale even when the onStaleReport reporter throws", async () => {
    const onStale = vi.fn();
    const onStaleReport = vi.fn(() => {
      throw new Error("reporter blew up");
    });
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      onStaleReport,
      probe: () => new Promise<never>(() => {}),
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(onStale).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("surfaces a throwing onStale via console.error and keeps the interval alive", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onStale = vi.fn(() => {
      throw new Error("recovery blew up");
    });
    let live = true;
    const { dispose } = createHeartbeat({
      isLive: () => live,
      onStale,
      probe: () => new Promise<never>(() => {}), // never answers
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1500); // tick + probe timeout → onStale throws
    expect(onStale).toHaveBeenCalledTimes(1);
    // The throw was surfaced, not swallowed.
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("onStale recovery action threw"),
      expect.any(Error),
    );
    // The interval survived the throw: a later tick still probes.
    live = false; // gate the next probe so the assertion is about the interval, not a 2nd stale
    await vi.advanceTimersByTimeAsync(1000);
    live = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onStale).toHaveBeenCalledTimes(2);
    dispose();
    consoleError.mockRestore();
  });

  it("treats a probe REJECTION as alive — a completed round-trip, not half-open", async () => {
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      probe: vi.fn().mockRejectedValue(new Error("server said no")),
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(onStale).not.toHaveBeenCalled();
    dispose();
  });

  it("surfaces a SYNCHRONOUS probe throw via onProbeError, does NOT run onStale, and settles for the next tick", async () => {
    const onStale = vi.fn();
    const onProbeError = vi.fn();
    const probe = vi.fn(() => {
      throw new Error("miswired");
    });
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      onProbeError,
      probe: probe as unknown as () => Promise<unknown>,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000); // tick → probe throws
    expect(onProbeError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000); // timeout window passes
    expect(onStale).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(2); // settled → next tick probed again
    dispose();
  });

  it("never overlaps probes — a tick is skipped while one is still outstanding", async () => {
    let resolveProbe: ((v: unknown) => void) | undefined;
    const probe = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveProbe = resolve;
        }),
    );
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale: vi.fn(),
      probe,
      intervalMs: 1000,
      timeoutMs: 5000,
    });
    await vi.advanceTimersByTimeAsync(1000); // tick 1 → in flight
    await vi.advanceTimersByTimeAsync(1000); // tick 2 → skipped
    expect(probe).toHaveBeenCalledTimes(1);
    resolveProbe?.({});
    await vi.advanceTimersByTimeAsync(1000); // tick 3 → probe again
    expect(probe).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("does not run onStale when disposed while a probe is still in flight", async () => {
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      probe: () => new Promise<never>(() => {}), // never answers
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000); // probe in flight, timeout armed
    dispose(); // tear down before the 500ms timeout elapses
    await vi.advanceTimersByTimeAsync(2000);
    expect(onStale).not.toHaveBeenCalled();
  });

  it("stops probing after dispose", async () => {
    const probe = vi.fn().mockResolvedValue(null);
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale: vi.fn(),
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(probe).toHaveBeenCalledTimes(1);
    dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  // The suspension-void: a probe is only a FAIR test of the link if the runtime ran
  // continuously for the whole timeout window. These inject the wall + monotonic
  // clocks so the test can model "the wall clock advanced while the event loop was
  // frozen" — which fake timers ALONE cannot express (advancing a fake timer moves
  // both clocks together, gap 0), the very thing the watchdog must distinguish.
  it("VOIDS a probe whose window a suspension crossed (wall jumped, monotonic frozen) — no onStale, re-probes fresh, and defers repeatedly while frozen", async () => {
    let wall = 0;
    const monoT = 0; // the monotonic clock stays FROZEN across the freeze
    const onStale = vi.fn();
    const probe = vi.fn(() => new Promise<never>(() => {})); // never answers
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
      deps: { now: () => wall, mono: () => monoT },
    });
    await vi.advanceTimersByTimeAsync(1000); // tick → probe 1 in flight (launch 0,0)
    expect(probe).toHaveBeenCalledTimes(1);
    // A suspension across the probe: the wall clock jumps 60s while the monotonic
    // clock stays frozen (the event loop was paused, then resumed).
    wall = 60_000;
    await vi.advanceTimersByTimeAsync(500); // the (overdue) timeout fires → VOID
    expect(onStale).not.toHaveBeenCalled(); // a healthy link is NOT declared half-open
    expect(probe).toHaveBeenCalledTimes(2); // re-probed immediately, fresh window
    // A second freeze across the fresh probe voids again — voiding DEFERS a verdict
    // for as long as the page stays frozen (the monotonic clock never advances, so
    // the void budget is never spent).
    wall = 120_000;
    await vi.advanceTimersByTimeAsync(500);
    expect(onStale).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledTimes(3);
    dispose();
  });

  it("does NOT void a genuine missed probe — wall and monotonic advance in lockstep (gap 0), so onStale still fires", async () => {
    let t = 0;
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      probe: () => new Promise<never>(() => {}), // never answers — a truly dead link
      intervalMs: 1000,
      timeoutMs: 500,
      // lockstep: a genuinely silent link, not a frozen page (gap stays 0)
      deps: { now: () => t, mono: () => t },
    });
    await vi.advanceTimersByTimeAsync(1000); // tick → probe armed (launch t=0)
    t += 500; // real running time elapses, on BOTH clocks
    await vi.advanceTimersByTimeAsync(500); // timeout fires; gap = 500 − 500 = 0
    expect(onStale).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("fires stale on a suspended probe once the void budget is spent — voiding DEFERS but never SILENCES", async () => {
    let wall = 0;
    let monoT = 0;
    const onStale = vi.fn();
    const { dispose } = createHeartbeat({
      isLive: () => true,
      onStale,
      probe: () => new Promise<never>(() => {}),
      intervalMs: 1000,
      timeoutMs: 500,
      deps: { now: () => wall, mono: () => monoT },
    });
    await vi.advanceTimersByTimeAsync(1000); // tick → probe armed (launch 0,0)
    // The monotonic clock shows MORE running time has elapsed since the last settle
    // than the void budget allows ((1000 + 500) × VOID_BUDGET_FACTOR = 4500ms) — a
    // flap that has deferred a verdict for too long of ACTUAL running time — AND the
    // wall clock jumped (this window looks suspended too).
    monoT = 5_000; // 5000 > 4500 budget (lastSettledMono is still 0)
    wall = 65_000; // far ahead → suspended…
    await vi.advanceTimersByTimeAsync(500); // …but the budget is spent, so it fires:
    expect(onStale).toHaveBeenCalledTimes(1);
    dispose();
  });

  it("wake() abandons the in-flight probe and re-probes immediately (the browser leg's resume fast path)", async () => {
    const onStale = vi.fn();
    const probe = vi.fn(() => new Promise<never>(() => {}));
    const hb = createHeartbeat({
      isLive: () => true,
      onStale,
      probe,
      intervalMs: 10_000,
      timeoutMs: 5_000,
    });
    await vi.advanceTimersByTimeAsync(10_000); // first interval tick → probe 1
    expect(probe).toHaveBeenCalledTimes(1);
    hb.wake(); // simulate a window-focus / page-resume wake event
    expect(probe).toHaveBeenCalledTimes(2); // abandoned probe 1, fresh probe 2 NOW
    expect(onStale).not.toHaveBeenCalled(); // a single wake does not declare stale
    hb.dispose();
  });

  it("a flood of wake() faster than timeoutMs still fires onStale once the void budget is spent — wake can't silence the watchdog", async () => {
    // A never-settling (dead half-open) probe whose timeout a storm of wakes keeps
    // clearing must NOT be deferred forever: `wake()` is a void in disguise, so it
    // honours a running-time budget anchored at the FIRST wake-abandon. The clocks
    // run in LOCKSTEP here (gap 0 — not a suspension), so it is the budget alone, not
    // a void verdict, that converts the flood into a stale verdict. mono is injected
    // so the budget clock advances under synchronous `wake()` calls (no fake-timer
    // tick passes between them).
    let monoMs = 0;
    const onStale = vi.fn();
    const probe = vi.fn(() => new Promise<never>(() => {})); // never answers
    const hb = createHeartbeat({
      isLive: () => true,
      onStale,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
      deps: { now: () => monoMs, mono: () => monoMs },
    });
    await vi.advanceTimersByTimeAsync(1000); // tick → probe 1 in flight (launch mono 0)
    expect(probe).toHaveBeenCalledTimes(1);
    const voidBudgetMs = (1000 + 500) * 3; // VOID_BUDGET_FACTOR = 3 → 4500ms
    const firstWakeMono = 100; // the storm budget anchors at the FIRST wake-abandon
    // Wake every 100ms of running time, faster than the 500ms timeout, so the probe
    // timeout never fires on its own — only the budget can end the flood.
    for (
      let elapsed = firstWakeMono;
      elapsed <= firstWakeMono + voidBudgetMs + 600 &&
      onStale.mock.calls.length === 0;
      elapsed += 100
    ) {
      monoMs = elapsed;
      hb.wake();
    }
    expect(onStale).toHaveBeenCalledTimes(1); // fired despite the wake flood…
    // …and within the void budget's worth of running time SINCE THE FIRST WAKE
    // (bounded deferral, not forever) — with a bounded number of re-probes.
    expect(monoMs).toBeLessThanOrEqual(firstWakeMono + voidBudgetMs + 200);
    expect(probe.mock.calls.length).toBeLessThanOrEqual(voidBudgetMs / 100 + 3);
    hb.dispose();
  });

  it("a SINGLE wake after a long OS-awake tab freeze re-probes a fresh window, never forces stale", async () => {
    // F4 regression: a backgrounded tab the browser FROZE (Page-Lifecycle `freeze`,
    // `chrome://discards`) is OS-AWAKE — the monotonic clock advances THROUGH the
    // freeze (unlike a genuine suspension, where it pauses), so a long freeze pushes
    // `mono()` well past the void budget. The `resume` event fires a SINGLE wake.
    // That wake must abandon the interrupted probe and re-probe a FRESH window — NOT
    // force `onStale()` just because freeze time crossed the budget (anchoring the
    // wake budget at `lastSettledMono` did exactly that). Only the sustained storm
    // above ever fires stale from the wake path.
    let monoMs = 0;
    const onStale = vi.fn();
    let answerProbe2: (() => void) | undefined;
    const probe = vi.fn(() =>
      probe.mock.calls.length === 1
        ? new Promise<never>(() => {}) // probe 1: interrupted by the freeze, never settles
        : new Promise<void>((res) => {
            answerProbe2 = res; // probe 2: the fresh post-resume probe, answerable
          }),
    );
    const hb = createHeartbeat({
      isLive: () => true,
      onStale,
      probe,
      intervalMs: 1000,
      timeoutMs: 500,
      deps: { now: () => monoMs, mono: () => monoMs },
    });
    await vi.advanceTimersByTimeAsync(1000); // tick → probe 1 in flight (launch 0,0)
    expect(probe).toHaveBeenCalledTimes(1);
    // A long OS-awake freeze: BOTH clocks advance together (gap ~0, so the suspension
    // void never sees it), and mono crosses the void budget ((1000+500)*3 = 4500ms).
    monoMs = 60_000;
    hb.wake(); // a single `resume`-driven wake
    expect(probe).toHaveBeenCalledTimes(2); // abandoned probe 1, fresh probe 2 NOW
    expect(onStale).not.toHaveBeenCalled(); // NOT forced stale by freeze time
    // The fresh probe answers ⇒ a healthy link — still never stale.
    answerProbe2?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(onStale).not.toHaveBeenCalled();
    hb.dispose();
  });

  // Round-8: a watchdog whose timing effectively never fires is a branded-but-blind
  // signal. createHeartbeat FAILS FAST on absurd timing rather than wire a dead one.
  it("CRASHES on a pathologically large intervalMs (the ~23-day blind-watchdog case)", () => {
    const make = (intervalMs: number) =>
      createHeartbeat({
        isLive: () => true,
        onStale: vi.fn(),
        probe: vi.fn().mockResolvedValue(null),
        intervalMs,
      });
    expect(() => make(2_000_000_000)).toThrow(
      /intervalMs must be a positive number/,
    );
    // A multi-minute timeout is the same blind-watchdog hazard on the other axis.
    expect(() =>
      createHeartbeat({
        isLive: () => true,
        onStale: vi.fn(),
        probe: vi.fn().mockResolvedValue(null),
        timeoutMs: 600_000,
      }),
    ).toThrow(/timeoutMs must be a positive number/);
    // Non-positive / non-finite are rejected too.
    expect(() => make(0)).toThrow();
    expect(() => make(Number.NaN)).toThrow();
    // A sane minute-scale cadence is still allowed.
    expect(() => make(60_000).dispose()).not.toThrow();
  });
});
