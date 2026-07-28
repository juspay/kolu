import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KAVAL_GATE_FILE } from "kaval";
import { beforeEach, expect, it, vi } from "vitest";

let socketPath: string;

vi.mock("./ptyHost/daemonStatus.ts", () => ({
  getLocalSocketPath: () => socketPath,
  readDaemonStatus: () => ({ state: "connected" }),
}));

vi.mock("./ports/scan.ts", () => ({
  osfactsBinPath: () => {
    throw new Error("osfacts must not run for an unsupported gate format");
  },
}));

import { samplePadiMemory } from "./memorySampler.ts";

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "kaval-gate-window-"));
  mkdirSync(dir, { recursive: true });
  socketPath = join(dir, "pty-host.sock");
});

it("names a connected legacy one-field gate as an unsupported gate format", async () => {
  writeFileSync(join(socketPath, "..", KAVAL_GATE_FILE), "772500\n");

  const reading = await samplePadiMemory();

  expect(reading.kaval).toEqual({ status: "gate-format-unsupported" });
});
