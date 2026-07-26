/**
 * The reactor's loop guard — a poll whose own re-read fires its own change edge.
 *
 * This is the shape that froze a production server: `everyMsOr(interval, edge)`
 * is a legal, useful fuse, and a read that ANNOUNCES on that same edge closes the
 * circle. The reactor executes it exactly as written — read → announce → tick →
 * read — with the event loop never yielding again.
 *
 * ## Why this guard is built on PROVENANCE and not on timing
 *
 * The first cut of it asked "did a tick arrive close in time to a read, and did
 * the value not change?". Adversarial verification refuted that in both
 * directions, and the two failures are the reason all three tests below exist:
 *
 *  - **A healthy poll slower than its interval died.** A plain `everyMs(10)` cell
 *    whose read takes 30 ms and returns a constant crashed in ~400 ms — no fused
 *    edge, no self-announce. The coalesced path made "close in time" degenerate
 *    into "was coalesced", which every slow poll does constantly.
 *  - **Measuring lap START-to-START instead would have missed the real freeze.**
 *    In a self-loop the next read starts only after the previous ends, so the lap
 *    IS the read duration — and the incident's own reconcile takes tens of ms, so
 *    a near-zero threshold never fires.
 *
 * Timing plus value-equality is a PROXY for causation, and every variant of it
 * fails one direction or the other. So the guard asks the causal question
 * directly: the read runs inside an `AsyncLocalStorage` context keyed to the
 * cell, and a tick that fires UNDER that context — from the read's own stack or
 * its async continuations — is self-caused by construction. A timer, an I/O
 * completion, another cell's microtask burst: all carry a different context and
 * can never count, however fast or however equal.
 *
 * The repo's own doctrine already said this: cut feedback loops with PROVENANCE,
 * not value-dedup (`.claude/rules/solidjs.md`, the controlled-component echo
 * rule). This is the same lesson in the reactor.
 */

import { describe, expect, it, vi } from "vitest";
import { everyMs, everyMsOr, source } from "./reactor";
import { __setLoopReporterForTests } from "./reactor";

/** Drive a poll source the way `derived.cell`'s connect seam does, and collect
 *  any loop report instead of letting it throw the process down. */
async function connect<T>(poll: ReturnType<typeof source<T>>) {
  const seen: T[] = [];
  const loops: Error[] = [];
  const restoreReporter = __setLoopReporterForTests((err) => loops.push(err));
  const stop = await (
    poll as { connectPoll: (set: (v: T) => void) => Promise<() => void> }
  ).connectPoll((v) => seen.push(v));
  return {
    seen,
    loops,
    stop: () => {
      stop?.();
      restoreReporter();
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("the reactor's self-caused-tick loop guard", () => {
  it("leaves a healthy poll SLOWER than its interval alone — the shipped false positive", async () => {
    // The executed repro that refuted the timing guard. Nothing here is a loop:
    // one plain interval, no change edge at all, a read that simply takes longer
    // than the cadence and returns the same value each time. Every tick lands
    // mid-read and coalesces, which the timing guard read as "self-caused".
    //
    // This is an ordinary shape — drishti polls `ps`+`lsof` on a 2 s interval —
    // so a guard that kills it is worse than no guard.
    const poll = source<number>({
      read: async () => {
        await sleep(30);
        return 7;
      },
      install: everyMs(10),
      label: "slow-but-honest",
    });

    const { loops, stop } = await connect(poll);
    await sleep(400);
    stop();

    expect(loops).toEqual([]);
  });

  it("CRASHES on a read that fires its own change edge, even a SLOW one", async () => {
    // The production freeze, with a read duration that would defeat a
    // lap-timing guard: the self-loop's lap IS the read duration, so "laps are
    // near-instant" is false here while the cycle is entirely real.
    const listeners = new Set<() => void>();
    const poll = source<number>({
      read: async () => {
        await sleep(20);
        // The defect: announcing on the edge that triggers this read.
        for (const tick of [...listeners]) tick();
        return 7;
      },
      install: everyMsOr(60_000, (tick) => {
        listeners.add(tick);
        return () => listeners.delete(tick);
      }),
      label: "forwards",
    });

    const { loops, stop } = await connect(poll);
    // One external edge — the act that started it in production (a forward
    // opened). From here the read feeds itself.
    for (const tick of [...listeners]) tick();
    await vi.waitFor(() => expect(loops.length).toBeGreaterThan(0), {
      timeout: 3_000,
    });
    stop();

    expect(String(loops[0])).toMatch(/forwards/);
    expect(String(loops[0])).toMatch(/re-read/i);
  });

  it("leaves an EXTERNAL equal-value burst delivered on microtasks alone", async () => {
    // The surviving false positive of any timing guard. Real `onState` bursts
    // arrive on microtasks — a frame-per-line push log, deliberate no-change
    // republishes, a channel resolving waiters — so "world ticks cross a
    // macrotask" is simply false. These ticks are external: they carry a
    // different async context and must never count, however fast or equal.
    const listeners = new Set<() => void>();
    const poll = source<number>({
      read: async () => {
        await sleep(15);
        return 42; // never changes — the value-equality half is satisfied
      },
      install: everyMsOr(60_000, (tick) => {
        listeners.add(tick);
        return () => listeners.delete(tick);
      }),
      label: "processMemory",
    });

    const { loops, stop } = await connect(poll);
    // A burst from OUTSIDE, delivered on microtasks, landing during reads.
    for (let i = 0; i < 40; i += 1) {
      await Promise.resolve().then(() => {
        for (const tick of [...listeners]) tick();
      });
    }
    await sleep(200);
    stop();

    expect(loops).toEqual([]);
  });
});
