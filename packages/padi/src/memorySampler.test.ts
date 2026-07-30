import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KAVAL_GATE_FILE } from "kaval";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installOsfactsMemoryFixture,
  type OsfactsMemoryFixture,
} from "./memorySampler.testlib.ts";

const daemon = vi.hoisted(() => ({
  state: "disconnected",
  socketPath: undefined as string | undefined,
}));
const legacyProcessMemory = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("legacy kaval processMemory RPC was called");
  }),
);

vi.mock("./ptyHost/daemonStatus.ts", () => ({
  readDaemonStatus: () => ({ state: daemon.state }),
  getLocalSocketPath: () => daemon.socketPath,
}));
vi.mock("./ptyHost/index.ts", () => ({
  ptyHostClient: {
    surface: { system: { processMemory: legacyProcessMemory } },
  },
}));
vi.mock("./log.ts", () => ({ log: { error: vi.fn() } }));

import { samplePadiMemory } from "./memorySampler.ts";

let fixture: OsfactsMemoryFixture | undefined;
let runtimeDir: string | undefined;

function connectedKaval(gateBody = "4242\n"): void {
  runtimeDir = mkdtempSync(join(tmpdir(), "padi-memory-kaval-"));
  daemon.state = "connected";
  daemon.socketPath = join(runtimeDir, "pty-host.sock");
  writeFileSync(join(runtimeDir, KAVAL_GATE_FILE), gateBody);
}

function osfacts(rows: readonly string[]): OsfactsMemoryFixture {
  fixture = installOsfactsMemoryFixture(rows);
  return fixture;
}

afterEach(() => {
  fixture?.restore();
  fixture = undefined;
  if (runtimeDir !== undefined) {
    rmSync(runtimeDir, { recursive: true, force: true });
    runtimeDir = undefined;
  }
  daemon.state = "disconnected";
  daemon.socketPath = undefined;
  legacyProcessMemory.mockClear();
});

describe("samplePadiMemory — osfacts V2 RSS", () => {
  it("samples padi and a connected legacy-gate kaval in one osfacts call", async () => {
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

    fixture?.restore();
    fixture = installOsfactsMemoryFixture([
      `M\t${process.pid}\t10485760`,
      "U\t4242\tmem\tEACCES",
    ]);
    await expect(samplePadiMemory()).resolves.toEqual({
      padi: { status: "ok", rssBytes: 10_485_760 },
      kaval: { status: "error" },
    });
  });

  it("fails loudly when connected status has no gate to identify", async () => {
    connectedKaval();
    rmSync(join(runtimeDir!, KAVAL_GATE_FILE));
    osfacts([`M\t${process.pid}\t10485760`]);

    await expect(samplePadiMemory()).rejects.toThrow(
      /connected kaval gate is absent/,
    );
  });
});
