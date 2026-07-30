import { afterEach, describe, expect, it, vi } from "vitest";
import { withOsfactsMemoryFixture } from "./memorySampler.testlib.ts";

const endpoint = vi.hoisted(() => ({
  target: undefined as { pid: number; startedAt: number } | undefined,
}));
vi.mock("./ptyHost/index.ts", () => ({
  currentKavalProcessTarget: () => endpoint.target,
}));
vi.mock("./log.ts", () => ({ log: { error: vi.fn() } }));

import { samplePadiMemory } from "./memorySampler.ts";

function connectedKaval(): void {
  endpoint.target = { pid: 4242, startedAt: 1_000 };
}

afterEach(() => {
  endpoint.target = undefined;
});

describe("samplePadiMemory — osfacts V2 RSS", () => {
  it("samples padi and the endpoint's connected kaval in one osfacts call", async () => {
    connectedKaval();
    await withOsfactsMemoryFixture(
      { rows: [`M\t${process.pid}\t10485760`, "M\t4242\t20971520"] },
      async (fixture) => {
        await expect(samplePadiMemory()).resolves.toEqual({
          padi: { status: "ok", rssBytes: 10_485_760 },
          kaval: { status: "ok", rssBytes: 20_971_520 },
        });
        expect(fixture.readArgs()).toBe(
          `snapshot --pids ${process.pid},4242 --mem`,
        );
      },
    );
  });

  it("keeps a disconnected kaval honestly absent while sampling padi through osfacts", async () => {
    await withOsfactsMemoryFixture(
      { rows: [`M\t${process.pid}\t10485760`] },
      async (fixture) => {
        await expect(samplePadiMemory()).resolves.toEqual({
          padi: { status: "ok", rssBytes: 10_485_760 },
          kaval: { status: "absent" },
        });
        expect(fixture.readArgs()).toBe(`snapshot --pids ${process.pid} --mem`);
      },
    );
  });

  it("surfaces an unreadable padi RSS through the typed error arm", async () => {
    await withOsfactsMemoryFixture(
      { rows: [`U\t${process.pid}\tmem\tEACCES`] },
      async () => {
        await expect(samplePadiMemory()).resolves.toEqual({
          padi: { status: "error" },
          kaval: { status: "absent" },
        });
      },
    );
  });

  it("surfaces whole-source memory blindness through the typed error arm", async () => {
    await withOsfactsMemoryFixture(
      { rows: ["E\tprocfs\tmem\tEIO"] },
      async () => {
        await expect(samplePadiMemory()).resolves.toEqual({
          padi: { status: "error" },
          kaval: { status: "absent" },
        });
      },
    );
  });

  it("surfaces a missing requested padi fact through the typed error arm", async () => {
    await withOsfactsMemoryFixture({ rows: [] }, async () => {
      await expect(samplePadiMemory()).resolves.toEqual({
        padi: { status: "error" },
        kaval: { status: "absent" },
      });
    });
  });

  it("surfaces an osfacts contract failure instead of retaining stale RSS", async () => {
    connectedKaval();
    await withOsfactsMemoryFixture({ rows: [], version: 999 }, async () => {
      await expect(samplePadiMemory()).resolves.toEqual({
        padi: { status: "error" },
        kaval: { status: "error" },
      });
    });
  });

  it("distinguishes a raced-away kaval from an unreadable live kaval", async () => {
    connectedKaval();
    await withOsfactsMemoryFixture(
      { rows: [`M\t${process.pid}\t10485760`, "U\t4242\tmem\tESRCH"] },
      async () => {
        await expect(samplePadiMemory()).resolves.toEqual({
          padi: { status: "ok", rssBytes: 10_485_760 },
          kaval: { status: "absent" },
        });
      },
    );

    await withOsfactsMemoryFixture(
      { rows: [`M\t${process.pid}\t10485760`, "U\t4242\tmem\tEACCES"] },
      async () => {
        await expect(samplePadiMemory()).resolves.toEqual({
          padi: { status: "ok", rssBytes: 10_485_760 },
          kaval: { status: "error" },
        });
      },
    );
  });

  it("surfaces a missing requested fact for the current kaval through the typed error arm", async () => {
    connectedKaval();
    await withOsfactsMemoryFixture(
      { rows: [`M\t${process.pid}\t10485760`] },
      async () => {
        await expect(samplePadiMemory()).resolves.toEqual({
          padi: { status: "ok", rssBytes: 10_485_760 },
          kaval: { status: "error" },
        });
      },
    );
  });

  it("does not publish a prior kaval generation after an in-flight recycle", async () => {
    connectedKaval();
    await withOsfactsMemoryFixture(
      {
        rows: [`M\t${process.pid}\t10485760`, "M\t4242\t20971520"],
        paused: true,
      },
      async (fixture) => {
        const sample = samplePadiMemory();
        await vi.waitFor(() => expect(fixture.hasStarted()).toBe(true));
        endpoint.target = { pid: 4242, startedAt: 2_000 };
        fixture.release();

        await expect(sample).resolves.toEqual({
          padi: { status: "ok", rssBytes: 10_485_760 },
          kaval: { status: "absent" },
        });
      },
    );
  });

  it("does not misreport a failed prior-generation read as a current kaval error", async () => {
    connectedKaval();
    await withOsfactsMemoryFixture(
      { rows: [], version: 999, paused: true },
      async (fixture) => {
        const sample = samplePadiMemory();
        await vi.waitFor(() => expect(fixture.hasStarted()).toBe(true));
        endpoint.target = { pid: 4242, startedAt: 2_000 };
        fixture.release();

        await expect(sample).resolves.toEqual({
          padi: { status: "error" },
          kaval: { status: "absent" },
        });
      },
    );
  });
});
