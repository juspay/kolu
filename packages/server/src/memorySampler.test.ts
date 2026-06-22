import { BYTES_PER_MB as MB } from "kolu-common/surface";
import type { ProcessMemory } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import {
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
