import type { PadiProcessMemory } from "@kolu/padi/surface";
import { BYTES_PER_MB as MB } from "kolu-common/surface";
import { describe, expect, it, vi } from "vitest";
import { sampleServerMemory } from "./memorySampler.ts";

/** padi up: an `ok` `{ padi, kaval }` pair. */
const padiUp = async (): Promise<PadiProcessMemory> => ({
  padi: { status: "ok", rssBytes: 20 * MB },
  kaval: { status: "ok", rssBytes: 30 * MB },
});

describe("sampleServerMemory — the poll read behind the derived processMemory cell", () => {
  it("folds kolu-server's own RSS + padi's { padi, kaval } reading into one readout", async () => {
    const m = await sampleServerMemory(padiUp);
    // kolu-server measures itself, so its RSS is a real positive figure (not injected).
    expect(m.serverRssBytes).toBeGreaterThan(0);
    expect(m.padi).toEqual({ status: "ok", rssBytes: 20 * MB });
    expect(m.kaval).toEqual({ status: "ok", rssBytes: 30 * MB });
  });

  it("passes padi's honest three-way through verbatim — an `error` kaval poll stays distinct from `absent`", async () => {
    const m = await sampleServerMemory(async () => ({
      padi: { status: "ok", rssBytes: 20 * MB },
      kaval: { status: "error" },
    }));
    expect(m.padi).toEqual({ status: "ok", rssBytes: 20 * MB });
    expect(m.kaval).toEqual({ status: "error" });
  });

  it("reports padi + kaval `absent` when padi is down (null reading) — never a fake zero", async () => {
    const readPadiMemory = vi.fn(
      async (): Promise<PadiProcessMemory | null> => null,
    );
    const m = await sampleServerMemory(readPadiMemory);
    // The server figure is still present (it measures itself); the missing padi
    // process folds to the honest `absent`, not a 0.
    expect(m.serverRssBytes).toBeGreaterThan(0);
    expect(m.padi).toEqual({ status: "absent" });
    expect(m.kaval).toEqual({ status: "absent" });
    expect(readPadiMemory).toHaveBeenCalledOnce();
  });
});
