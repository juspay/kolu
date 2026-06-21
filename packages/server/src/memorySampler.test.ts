import type { ProcessMemory } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import {
  type MemorySamplerDeps,
  processMemoryMbEqual,
  sampleMemoryOnce,
} from "./memorySampler.ts";

const MB = 1_048_576;

/** A deps stub with sane defaults; override per test. */
function deps(over: Partial<MemorySamplerDeps> = {}): {
  d: MemorySamplerDeps;
  published: ProcessMemory[];
  warned: unknown[];
} {
  const published: ProcessMemory[] = [];
  const warned: unknown[] = [];
  const d: MemorySamplerDeps = {
    serverRss: () => 100 * MB,
    daemonConnected: () => true,
    pollKavalRss: async () => 30 * MB,
    publish: (m) => published.push(m),
    warn: (err) => warned.push(err),
    ...over,
  };
  return { d, published, warned };
}

describe("sampleMemoryOnce", () => {
  it("publishes server + kaval RSS when the daemon is connected", async () => {
    const { d, published } = deps();
    await sampleMemoryOnce(d);
    expect(published).toEqual([
      { serverRssBytes: 100 * MB, kavalRssBytes: 30 * MB },
    ]);
  });

  it("reports null kaval RSS — and never polls — when the daemon is down", async () => {
    const pollKavalRss = vi.fn(async () => 30 * MB);
    const { d, published, warned } = deps({
      daemonConnected: () => false,
      pollKavalRss,
    });
    await sampleMemoryOnce(d);
    expect(pollKavalRss).not.toHaveBeenCalled();
    expect(published).toEqual([
      { serverRssBytes: 100 * MB, kavalRssBytes: null },
    ]);
    // A down daemon is expected (daemonStatus carries it) — not an anomaly.
    expect(warned).toHaveLength(0);
  });

  it("surfaces the error and reports null when a connected daemon's processMemory poll fails", async () => {
    const boom = new Error("socket closed");
    const { d, published, warned } = deps({
      pollKavalRss: async () => {
        throw boom;
      },
    });
    await sampleMemoryOnce(d);
    // Surfaced, not swallowed — and never collapsed to a stale/zero value.
    expect(warned).toEqual([boom]);
    expect(published).toEqual([
      { serverRssBytes: 100 * MB, kavalRssBytes: null },
    ]);
  });
});

describe("processMemoryMbEqual", () => {
  it("treats sub-MB wobble as equal (so the cell doesn't re-publish)", () => {
    expect(
      processMemoryMbEqual(
        { serverRssBytes: 100 * MB, kavalRssBytes: 30 * MB },
        { serverRssBytes: 100 * MB + 1024, kavalRssBytes: 30 * MB - 512 },
      ),
    ).toBe(true);
  });

  it("treats a whole-MB move as a change", () => {
    expect(
      processMemoryMbEqual(
        { serverRssBytes: 100 * MB, kavalRssBytes: 30 * MB },
        { serverRssBytes: 101 * MB, kavalRssBytes: 30 * MB },
      ),
    ).toBe(false);
  });

  it("distinguishes a null kaval reading from any real value", () => {
    expect(
      processMemoryMbEqual(
        { serverRssBytes: 100 * MB, kavalRssBytes: null },
        { serverRssBytes: 100 * MB, kavalRssBytes: 0 },
      ),
    ).toBe(false);
    expect(
      processMemoryMbEqual(
        { serverRssBytes: 100 * MB, kavalRssBytes: null },
        { serverRssBytes: 100 * MB, kavalRssBytes: null },
      ),
    ).toBe(true);
  });
});
