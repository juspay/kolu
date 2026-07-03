import type { PadiProcessMemory } from "@kolu/padi/surface";
import type { ProcessMemory } from "kolu-common/surface";
import { BYTES_PER_MB as MB } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import { type MemorySamplerDeps, sampleMemoryOnce } from "./memorySampler.ts";

/** A deps stub with sane defaults; override per test. */
function deps(over: Partial<MemorySamplerDeps> = {}): {
  d: MemorySamplerDeps;
  published: ProcessMemory[];
} {
  const published: ProcessMemory[] = [];
  const d: MemorySamplerDeps = {
    serverRss: () => 100 * MB,
    padiMemory: async () => ({
      padi: { status: "ok", rssBytes: 20 * MB },
      kaval: { status: "ok", rssBytes: 30 * MB },
    }),
    publish: (m) => published.push(m),
    ...over,
  };
  return { d, published };
}

describe("sampleMemoryOnce", () => {
  it("folds kolu-server's own RSS + padi's { padi, kaval } reading into one readout", async () => {
    const { d, published } = deps();
    await sampleMemoryOnce(d);
    expect(published).toEqual([
      {
        serverRssBytes: 100 * MB,
        padi: { status: "ok", rssBytes: 20 * MB },
        kaval: { status: "ok", rssBytes: 30 * MB },
      },
    ]);
  });

  it("passes padi's honest three-way through verbatim — an `error` kaval poll stays distinct from `absent`", async () => {
    const { d, published } = deps({
      padiMemory: async () => ({
        padi: { status: "ok", rssBytes: 20 * MB },
        kaval: { status: "error" },
      }),
    });
    await sampleMemoryOnce(d);
    expect(published).toEqual([
      {
        serverRssBytes: 100 * MB,
        padi: { status: "ok", rssBytes: 20 * MB },
        kaval: { status: "error" },
      },
    ]);
  });

  it("reports padi + kaval `absent` when padi is down (null reading) — never a fake zero", async () => {
    const padiMemory = vi.fn(
      async (): Promise<PadiProcessMemory | null> => null,
    );
    const { d, published } = deps({ padiMemory });
    await sampleMemoryOnce(d);
    // The server figure is still published (it measures itself); the missing padi
    // process folds to the honest `absent`, not a 0.
    expect(published).toEqual([
      {
        serverRssBytes: 100 * MB,
        padi: { status: "absent" },
        kaval: { status: "absent" },
      },
    ]);
  });

  it("re-reads the server RSS on every call (it's a live figure)", async () => {
    let rss = 50 * MB;
    const { d, published } = deps({
      serverRss: () => rss,
      padiMemory: async () => null,
    });
    await sampleMemoryOnce(d);
    rss = 75 * MB;
    await sampleMemoryOnce(d);
    expect(published.map((m) => m.serverRssBytes)).toEqual([50 * MB, 75 * MB]);
  });
});
