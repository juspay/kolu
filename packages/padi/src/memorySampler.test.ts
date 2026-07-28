import { describe, expect, it, vi } from "vitest";
import { samplePadiMemory, type MemorySamplerDeps } from "./memorySampler.ts";

function deps(overrides: Partial<MemorySamplerDeps> = {}): MemorySamplerDeps {
  return {
    selfRss: () => 10,
    connectedKaval: () => ({ kind: "pid", pid: 4242 }),
    samplePidRss: vi.fn(async () => 20),
    ...overrides,
  };
}

describe("samplePadiMemory", () => {
  it("reads connected kaval RSS by pid through osfacts", async () => {
    const d = deps();
    await expect(samplePadiMemory(undefined, d)).resolves.toEqual({
      padi: { status: "ok", rssBytes: 10 },
      kaval: { status: "ok", rssBytes: 20 },
    });
    expect(d.samplePidRss).toHaveBeenCalledWith(4242);
  });

  it("keeps disconnected kaval absent without invoking osfacts", async () => {
    const d = deps({ connectedKaval: () => ({ kind: "absent" }) });
    await expect(samplePadiMemory(undefined, d)).resolves.toEqual({
      padi: { status: "ok", rssBytes: 10 },
      kaval: { status: "absent" },
    });
    expect(d.samplePidRss).not.toHaveBeenCalled();
  });

  it("surfaces an osfacts failure as the existing error arm", async () => {
    const d = deps({
      samplePidRss: async () => {
        throw new Error("blind");
      },
    });
    await expect(samplePadiMemory(undefined, d)).resolves.toEqual({
      padi: { status: "ok", rssBytes: 10 },
      kaval: { status: "error" },
    });
  });
});
