/**
 * `runWait` — the bounded-wait scaffold's race semantics, pinned:
 * first-writer-wins settle, the timeout arm, the interrupted-vs-closed
 * fallback split, the upstream-error latch, the timer-range fail-fast, and —
 * the ruling's pin — a REJECTING watcher rejects `runWait` verbatim (a bug
 * propagates; it is never folded into `closed`).
 */
import { describe, expect, it, vi } from "vitest";
import {
  isValidTimerMs,
  MAX_TIMER_MS,
  runWait,
  type WaitOutcome,
} from "./wait.ts";

type Met = { fired: "test"; elapsedMs: number };

describe("runWait — the bounded-wait race", () => {
  it("resolves the first settle and aborts the race for siblings", async () => {
    let siblingSawAbort = false;
    const outcome = await runWait<Met>({}, async (ctx) => {
      await Promise.all([
        new Promise<void>((resolve) => {
          // Subscribe FIRST (a real watcher opens its stream before anything can
          // settle), then guard the already-aborted case like any signal consumer.
          const done = (): void => {
            siblingSawAbort = true;
            resolve();
          };
          if (ctx.signal.aborted) done();
          else ctx.signal.addEventListener("abort", done, { once: true });
        }),
        (async () => {
          ctx.settle({ kind: "met", fired: "test", elapsedMs: 1 });
          // A late second settle is ignored — first-writer-wins.
          ctx.settle({ kind: "gone", elapsedMs: 2 });
        })(),
      ]);
    });
    expect(outcome).toEqual({ kind: "met", fired: "test", elapsedMs: 1 });
    expect(siblingSawAbort).toBe(true);
  });

  it("times out when nothing settles, stamping elapsedMs", async () => {
    vi.useFakeTimers();
    try {
      const p = runWait<Met>({ timeoutMs: 50 }, async (ctx) => {
        await new Promise<void>((resolve) => {
          ctx.signal.addEventListener("abort", () => resolve());
        });
      });
      await vi.advanceTimersByTimeAsync(50);
      const outcome = await p;
      expect(outcome.kind).toBe("timeout");
      if (outcome.kind === "timeout") {
        expect(outcome.elapsedMs).toBeGreaterThanOrEqual(50);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("a caller abort resolves interrupted; a quiet unwind resolves closed", async () => {
    const abort = new AbortController();
    const interrupted = runWait<Met>({ signal: abort.signal }, async (ctx) => {
      await new Promise<void>((resolve) => {
        ctx.signal.addEventListener("abort", () => resolve());
      });
    });
    abort.abort();
    expect(await interrupted).toEqual({ kind: "interrupted" });

    // Watchers that unwind with no settle and no caller abort: a dropped link.
    const closed = await runWait<Met>({}, async () => {});
    expect(closed).toEqual({ kind: "closed", error: undefined });
  });

  it("the closed fallback carries the FIRST latched upstream error", async () => {
    const outcome = await runWait<Met>({}, async (ctx) => {
      ctx.recordUpstreamError("first diagnostic");
      ctx.recordUpstreamError("second diagnostic");
    });
    expect(outcome).toEqual({ kind: "closed", error: "first diagnostic" });
  });

  it("PIN: a rejecting watcher rejects runWait verbatim — never folds to closed", async () => {
    // The ruling's decided semantics: a watcher that throws is a BUG, not an
    // outcome. `closed` is reserved for the link settling without an outcome.
    const bug = new Error("watcher bug");
    await expect(
      runWait<Met>({}, async () => {
        throw bug;
      }),
    ).rejects.toBe(bug);
  });

  it("fails fast on an over-ceiling timeoutMs instead of a false ~1ms timeout", async () => {
    await expect(
      runWait<Met>({ timeoutMs: MAX_TIMER_MS + 1 }, async () => {}),
    ).rejects.toThrow(RangeError);
    await expect(
      runWait<Met>({ timeoutMs: 0 }, async () => {}),
    ).rejects.toThrow(RangeError);
  });

  it("PIN: no dangling abort listener accumulates on the caller's signal", async () => {
    // The chained listener's lifetime is bound to the INTERNAL abort (fired on
    // every arm), not `{ once }` (fired only if the CALLER aborts — never on
    // the common met arm). N settled waits on one long-lived signal must leave
    // zero listeners behind.
    const { getEventListeners } = await import("node:events");
    const caller = new AbortController();
    for (let i = 0; i < 5; i++) {
      await runWait<Met>({ signal: caller.signal }, async (ctx) => {
        ctx.settle({ kind: "met", fired: "test", elapsedMs: 1 });
      });
    }
    expect(getEventListeners(caller.signal, "abort")).toHaveLength(0);
  });

  it("a pre-aborted caller signal short-circuits to interrupted", async () => {
    const abort = new AbortController();
    abort.abort();
    const outcome = await runWait<Met>(
      { signal: abort.signal },
      async (ctx) => {
        expect(ctx.signal.aborted).toBe(true);
      },
    );
    expect(outcome).toEqual({ kind: "interrupted" });
  });
});

describe("isValidTimerMs — the shared timer-range rule", () => {
  it("accepts the setTimeout-honorable range and rejects the rest", () => {
    expect(isValidTimerMs(1)).toBe(true);
    expect(isValidTimerMs(MAX_TIMER_MS)).toBe(true);
    expect(isValidTimerMs(0)).toBe(false);
    expect(isValidTimerMs(-5)).toBe(false);
    expect(isValidTimerMs(MAX_TIMER_MS + 1)).toBe(false);
    expect(isValidTimerMs(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidTimerMs(Number.NaN)).toBe(false);
  });
});

// Type-level: the Met-collision guard. A payload carrying `kind` must be a
// NAMED type error at the consumer, not a silent `never` intersection.
type _MetWithKind = { kind: "boom" };
// @ts-expect-error — Met payloads must not carry their own `kind` (WaitMet)
type _Rejected = WaitOutcome<_MetWithKind>;
