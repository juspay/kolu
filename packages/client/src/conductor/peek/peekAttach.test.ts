import type { TerminalAttachFrame } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import { applyPeekFrame, peekAttachInput, type PeekScreen } from "./peekAttach";

const ID = "11111111-1111-4111-8111-111111111111" as TerminalId;

function screenOf(log: string[]): PeekScreen {
  return {
    resize: (grid) => log.push(`resize ${grid.cols}x${grid.rows}`),
    write: (data) => log.push(`write ${data}`),
    reset: () => log.push("reset"),
  };
}

describe("peekAttachInput", () => {
  it("carries the id and nothing else", () => {
    const input = peekAttachInput(ID);
    expect(input).toEqual({ id: ID });
    expect(Object.keys(input)).toEqual(["id"]);
  });
});

describe("applyPeekFrame", () => {
  it("sets the terminal to a snapshot's grid before painting it", () => {
    const log: string[] = [];
    applyPeekFrame(screenOf(log), {
      kind: "snapshot",
      data: "A",
      topLine: 0,
      grid: { cols: 80, rows: 24 },
    });
    expect(log).toEqual(["resize 80x24", "write A"]);
  });

  it("applies a resized frame and writes nothing", () => {
    const log: string[] = [];
    applyPeekFrame(screenOf(log), {
      kind: "resized",
      grid: { cols: 100, rows: 30 },
    });
    expect(log).toEqual(["resize 100x30"]);
  });

  it("writes a delta and resizes nothing", () => {
    const log: string[] = [];
    applyPeekFrame(screenOf(log), { kind: "delta", data: "B" });
    expect(log).toEqual(["write B"]);
  });

  it("keeps the stream's order across snapshot, delta and resized", () => {
    const log: string[] = [];
    const screen = screenOf(log);
    const frames: TerminalAttachFrame[] = [
      { kind: "snapshot", data: "A", topLine: 0, grid: { cols: 80, rows: 24 } },
      { kind: "delta", data: "B" },
      { kind: "resized", grid: { cols: 100, rows: 30 } },
      { kind: "delta", data: "C" },
    ];
    for (const frame of frames) applyPeekFrame(screen, frame);
    expect(log).toEqual([
      "resize 80x24",
      "write A",
      "write B",
      "resize 100x30",
      "write C",
    ]);
  });
});
