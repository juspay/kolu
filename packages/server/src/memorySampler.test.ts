import { BYTES_PER_MB as MB } from "kolu-common/surface";
import type { ProcessMemory } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import {
  guardOverlap,
  KAVAL_POLL_BUSY,
  KAVAL_POLL_TIMEOUT_MS,
  type MemorySamplerDeps,
  sampleMemoryOnce,
} from "./memorySampler.ts";

/** A deps stub with sane defaults; override per test. */
function deps(over: Partial<MemorySamplerDeps> = {}): {
  d: MemorySamplerDeps;
  published: ProcessMemory[];
  errors: unknown[];
} {
  const published: ProcessMemory[] = [];
  const errors: unknown[] = [];
  const d: MemorySamplerDeps = {
    serverRss: () => 100 * MB,
    daemonConnected: () => true,
    pollKavalRss: async () => 30 * MB,
    publish: (m) => published.push(m),
    reportPollError: (err) => errors.push(err),
    ...over,
  };
  return { d, published, errors };
}

describe("sampleMemoryOnce", () => {
  it("publishes server + kaval RSS when the daemon is connected", async () => {
    const { d, published } = deps();
    await sampleMemoryOnce(d);
    // Server figure published first (kaval absent), then the settled poll.
    expect(published).toEqual([
      { serverRssBytes: 100 * MB, kavalMemory: { status: "absent" } },
      {
        serverRssBytes: 100 * MB,
        kavalMemory: { status: "ok", rssBytes: 30 * MB },
      },
    ]);
  });

  it("reports absent kaval — and never polls — when the daemon is down", async () => {
    const pollKavalRss = vi.fn(async () => 30 * MB);
    const { d, published, errors } = deps({
      daemonConnected: () => false,
      pollKavalRss,
    });
    await sampleMemoryOnce(d);
    expect(pollKavalRss).not.toHaveBeenCalled();
    expect(published).toEqual([
      { serverRssBytes: 100 * MB, kavalMemory: { status: "absent" } },
    ]);
    // A down daemon is expected (daemonStatus carries it) — not an anomaly.
    expect(errors).toHaveLength(0);
  });

  it("surfaces the error and reports the distinct `error` state when a connected daemon's poll fails", async () => {
    const boom = new Error("socket closed");
    const { d, published, errors } = deps({
      pollKavalRss: async () => {
        throw boom;
      },
    });
    await sampleMemoryOnce(d);
    // Surfaced (logged ERROR in prod), and reported as `error` — never collapsed
    // into the same `absent` shape a no-daemon reading carries.
    expect(errors).toEqual([boom]);
    expect(published).toEqual([
      { serverRssBytes: 100 * MB, kavalMemory: { status: "absent" } },
      { serverRssBytes: 100 * MB, kavalMemory: { status: "error" } },
    ]);
  });

  it("reports `error` WITHOUT re-logging when a prior wedged poll is still busy", async () => {
    // A poll wrapped by guardOverlap that never settles: the first call is in
    // flight, every further call rejects with KAVAL_POLL_BUSY so no second RPC
    // launches. The sampler must render `error` but NOT log it again.
    const guarded = guardOverlap(() => new Promise<number>(() => {}));
    const launched: unknown[] = [];
    const { d, published, errors } = deps({
      pollKavalRss: () => {
        const p = guarded();
        launched.push(p);
        return p;
      },
    });
    vi.useFakeTimers();
    try {
      // First tick: launches the real (wedged) poll, times out → error + log.
      const first = sampleMemoryOnce(d);
      await vi.advanceTimersByTimeAsync(KAVAL_POLL_TIMEOUT_MS + 1);
      await first;
      // Second tick: the prior poll is still pending, so the guard rejects with
      // KAVAL_POLL_BUSY immediately — no new RPC, error state, but NO new log.
      const second = sampleMemoryOnce(d);
      await vi.advanceTimersByTimeAsync(KAVAL_POLL_TIMEOUT_MS + 1);
      await second;
    } finally {
      vi.useRealTimers();
    }
    // Only the first poll's real failure was logged; the BUSY skip wasn't.
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toBe(KAVAL_POLL_BUSY);
    // Both ticks render `error`; both publish server RSS first.
    expect(published).toEqual([
      { serverRssBytes: 100 * MB, kavalMemory: { status: "absent" } },
      { serverRssBytes: 100 * MB, kavalMemory: { status: "error" } },
      { serverRssBytes: 100 * MB, kavalMemory: { status: "absent" } },
      { serverRssBytes: 100 * MB, kavalMemory: { status: "error" } },
    ]);
  });

  it("guardOverlap launches a fresh poll once the prior one settles", async () => {
    let resolveFirst: ((n: number) => void) | undefined;
    let calls = 0;
    const guarded = guardOverlap(() => {
      calls += 1;
      if (calls === 1)
        return new Promise<number>((res) => {
          resolveFirst = res;
        });
      return Promise.resolve(42 * MB);
    });
    const p1 = guarded();
    // While p1 is pending, a second call is refused without invoking poll again.
    await expect(guarded()).rejects.toBe(KAVAL_POLL_BUSY);
    expect(calls).toBe(1);
    // Settle the first; the guard clears and the next call polls afresh.
    resolveFirst?.(10 * MB);
    await expect(p1).resolves.toBe(10 * MB);
    await expect(guarded()).resolves.toBe(42 * MB);
    expect(calls).toBe(2);
  });

  it("clears the guard on a REJECTING poll without an unobserved rejection", async () => {
    // F6: the guard's cleanup must be its own consumed handler, not a stored
    // `p.finally(...)` branch — otherwise a rejecting poll leaves an unhandled
    // rejection. We assert (a) the caller sees the rejection, (b) the guard
    // clears so the next call polls afresh, and (c) no unhandledRejection fires.
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown): void => {
      unhandled.push(err);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const boom = new Error("poll blew up");
      let calls = 0;
      const guarded = guardOverlap(() => {
        calls += 1;
        if (calls === 1) return Promise.reject(boom);
        return Promise.resolve(7 * MB);
      });
      // The caller observes the rejection of the FIRST poll.
      await expect(guarded()).rejects.toBe(boom);
      // The guard cleared on rejection, so the next call polls afresh.
      await expect(guarded()).resolves.toBe(7 * MB);
      expect(calls).toBe(2);
      // Give any stray microtask/task a chance to surface, then assert none did.
      await new Promise((r) => setTimeout(r, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("bounds a wedged poll with a timeout and reports `error`", async () => {
    vi.useFakeTimers();
    try {
      // A poll that never settles — without the timeout the tick would hang.
      const { d, published, errors } = deps({
        pollKavalRss: () => new Promise<number>(() => {}),
      });
      const done = sampleMemoryOnce(d);
      await vi.advanceTimersByTimeAsync(KAVAL_POLL_TIMEOUT_MS + 1);
      await done;
      expect(errors).toHaveLength(1);
      expect(published).toEqual([
        { serverRssBytes: 100 * MB, kavalMemory: { status: "absent" } },
        { serverRssBytes: 100 * MB, kavalMemory: { status: "error" } },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
