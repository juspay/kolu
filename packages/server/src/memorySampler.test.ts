import type { PadiProcessMemory } from "@kolu/padi-client/surface";
import { MIB } from "@kolu/byte-units";
import { describe, expect, it, vi } from "vitest";
import { sampleServerMemory } from "./memorySampler.ts";

const padiUp = async (): Promise<PadiProcessMemory> => ({
  padi: { status: "ok", rssBytes: 20 * MIB },
  kaval: { status: "ok", rssBytes: 30 * MIB },
});

describe("sampleServerMemory — the poll read behind the derived processMemory cell", () => {
  it("folds kolu-server's own RSS + padi's { padi, kaval } reading into one readout", async () => {
    const m = await sampleServerMemory(padiUp);
    expect(m.serverRssBytes).toBeGreaterThan(0);
    expect(m.padi).toEqual({ status: "ok", rssBytes: 20 * MIB });
    expect(m.kaval).toEqual({ status: "ok", rssBytes: 30 * MIB });
  });

  it("passes padi's honest three-way through verbatim — an `error` kaval poll stays distinct from `absent`", async () => {
    const m = await sampleServerMemory(async () => ({
      padi: { status: "ok", rssBytes: 20 * MIB },
      kaval: { status: "error" },
    }));
    expect(m.padi).toEqual({ status: "ok", rssBytes: 20 * MIB });
    expect(m.kaval).toEqual({ status: "error" });
  });

  it("reports padi + kaval `absent` when padi is down (null reading) — never a fake zero", async () => {
    const readPadiMemory = vi.fn(
      async (): Promise<PadiProcessMemory | null> => null,
    );
    const m = await sampleServerMemory(readPadiMemory);
    expect(m.serverRssBytes).toBeGreaterThan(0);
    expect(m.padi).toEqual({ status: "absent" });
    expect(m.kaval).toEqual({ status: "absent" });
    expect(readPadiMemory).toHaveBeenCalledOnce();
  });
});
