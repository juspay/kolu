import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installOsfactsMemoryFixture,
  type OsfactsMemoryFixture,
} from "./memorySampler.testlib.ts";

const endpoint = vi.hoisted(() => ({
  target: undefined as { pid: number; startedAt: number } | undefined,
}));
const legacyProcessMemory = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("legacy kaval processMemory RPC was called");
  }),
);

vi.mock("./ptyHost/index.ts", () => ({
  currentKavalProcessTarget: () => endpoint.target,
  ptyHostClient: {
    surface: { system: { processMemory: legacyProcessMemory } },
  },
}));
vi.mock("./log.ts", () => ({ log: { error: vi.fn() } }));

import { samplePadiMemory } from "./memorySampler.ts";

let fixture: OsfactsMemoryFixture | undefined;

function connectedKaval(): void {
  endpoint.target = { pid: 4242, startedAt: 1_000 };
}

function osfacts(rows: readonly string[]): OsfactsMemoryFixture {
  fixture = installOsfactsMemoryFixture(rows);
  return fixture;
}

afterEach(async () => {
  await fixture?.restore();
  fixture = undefined;
  endpoint.target = undefined;
  legacyProcessMemory.mockClear();
});

describe("samplePadiMemory — osfacts V2 RSS", () => {
  it("samples padi and the endpoint's connected kaval in one osfacts call", async () => {
    connectedKaval();
    const f = osfacts([`M\t${process.pid}\t10485760`, "M\t4242\t20971520"]);

    await expect(samplePadiMemory()).resolves.toEqual({
      padi: { status: "ok", rssBytes: 10_485_760 },
      kaval: { status: "ok", rssBytes: 20_971_520 },
    });
    expect(f.readArgs()).toBe(`snapshot --pids ${process.pid},4242 --mem`);
    expect(legacyProcessMemory).not.toHaveBeenCalled();
  });

  it("keeps a disconnected kaval honestly absent while sampling padi through osfacts", async () => {
    const f = osfacts([`M\t${process.pid}\t10485760`]);

    await expect(samplePadiMemory()).resolves.toEqual({
      padi: { status: "ok", rssBytes: 10_485_760 },
      kaval: { status: "absent" },
    });
    expect(f.readArgs()).toBe(`snapshot --pids ${process.pid} --mem`);
    expect(legacyProcessMemory).not.toHaveBeenCalled();
  });

  it("surfaces an unreadable padi RSS through the typed error arm", async () => {
    osfacts([`U\t${process.pid}\tmem\tEACCES`]);

    await expect(samplePadiMemory()).resolves.toEqual({
      padi: { status: "error" },
      kaval: { status: "absent" },
    });
  });

  it("surfaces whole-source memory blindness through the typed error arm", async () => {
    osfacts(["E\tprocfs\tmem\tEIO"]);

    await expect(samplePadiMemory()).resolves.toEqual({
      padi: { status: "error" },
      kaval: { status: "absent" },
    });
  });

  it("surfaces an osfacts contract failure instead of retaining stale RSS", async () => {
    connectedKaval();
    fixture = installOsfactsMemoryFixture([], 999);

    await expect(samplePadiMemory()).resolves.toEqual({
      padi: { status: "error" },
      kaval: { status: "error" },
    });
    expect(legacyProcessMemory).not.toHaveBeenCalled();
  });

  it("distinguishes a raced-away kaval from an unreadable live kaval", async () => {
    connectedKaval();
    osfacts([`M\t${process.pid}\t10485760`, "U\t4242\tmem\tESRCH"]);
    await expect(samplePadiMemory()).resolves.toEqual({
      padi: { status: "ok", rssBytes: 10_485_760 },
      kaval: { status: "absent" },
    });

    await fixture?.restore();
    fixture = installOsfactsMemoryFixture([
      `M\t${process.pid}\t10485760`,
      "U\t4242\tmem\tEACCES",
    ]);
    await expect(samplePadiMemory()).resolves.toEqual({
      padi: { status: "ok", rssBytes: 10_485_760 },
      kaval: { status: "error" },
    });
  });

  it("does not publish a prior kaval generation after an in-flight recycle", async () => {
    connectedKaval();
    const f = installOsfactsMemoryFixture(
      [`M\t${process.pid}\t10485760`, "M\t4242\t20971520"],
      2,
      { paused: true },
    );
    fixture = f;

    const sample = samplePadiMemory();
    await vi.waitFor(() => expect(f.hasStarted()).toBe(true));
    endpoint.target = { pid: 4242, startedAt: 2_000 };
    f.release();

    await expect(sample).resolves.toEqual({
      padi: { status: "ok", rssBytes: 10_485_760 },
      kaval: { status: "absent" },
    });
  });

  it("does not misreport a failed prior-generation read as a current kaval error", async () => {
    connectedKaval();
    const f = installOsfactsMemoryFixture([], 999, { paused: true });
    fixture = f;

    const sample = samplePadiMemory();
    await vi.waitFor(() => expect(f.hasStarted()).toBe(true));
    endpoint.target = { pid: 4242, startedAt: 2_000 };
    f.release();

    await expect(sample).resolves.toEqual({
      padi: { status: "error" },
      kaval: { status: "absent" },
    });
  });
});
