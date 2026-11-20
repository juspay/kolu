import type { PadiRoster, PadiTerminal } from "@kolu/padi-client/surface";
import { computed } from "@kolu/surface/reactor";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { createFleetGate } from "./fleetGate.ts";

const frame = (n: number): ReadonlyMap<TerminalId, PadiTerminal> =>
  new Map(
    Array.from({ length: n }, (_, i) => [
      `t${i}` as TerminalId,
      {} as PadiTerminal,
    ]),
  );

describe("createFleetGate", () => {
  it("refuses the pre-adopt frame — padi's registry before kaval was adopted", () => {
    const gate = createFleetGate();
    expect(gate.admit(frame(0))).toBe(false);
    expect(gate.admit(frame(0))).toBe(false);
  });

  it("opens on the first REAL inventory", () => {
    const gate = createFleetGate();
    gate.admit(frame(0));
    expect(gate.admit(frame(2))).toBe(true);
  });

  it("STAYS open — an empty fleet after a real one is every terminal exiting", () => {
    const gate = createFleetGate();
    expect(gate.admit(frame(1))).toBe(true);
    expect(gate.admit(frame(0))).toBe(true);
  });

  it("admits a first frame that is already populated — a daemon that adopted before serving", () => {
    expect(createFleetGate().admit(frame(3))).toBe(true);
  });

  it("ESTABLISHES an empty roster when the boot says adoption finished", () => {
    const gate = createFleetGate();
    expect(gate.admit(frame(0))).toBe(false);
    gate.establish();
    expect(gate.admit(frame(0))).toBe(true);
  });

  it("CLOSES again for a recycle's drain window, and re-opens at the re-park", () => {
    const gate = createFleetGate();
    expect(gate.admit(frame(2))).toBe(true);
    gate.settling();
    expect(gate.admit(frame(0))).toBe(false);
    gate.establish();
    expect(gate.admit(frame(0))).toBe(true);
  });

  it("STAYS closed through the drain's PARTIAL frames — the two-terminal recycle", () => {
    const seen: PadiRoster[] = [];
    const registry: TerminalId[] = ["t0" as TerminalId, "t1" as TerminalId];
    const gate = createFleetGate({
      publish: (roster) => seen.push(roster),
      census: () => registry,
      now: () => 7,
    });
    expect(gate.admit(frame(2))).toBe(true);
    gate.settling();
    registry.length = 0;
    expect(gate.admit(frame(1))).toBe(false);
    expect(gate.roster()).toEqual({ kind: "settling" });
    expect(gate.admit(frame(0))).toBe(false);
    expect(gate.roster()).toEqual({ kind: "settling" });
    registry.push("t0" as TerminalId, "t1" as TerminalId);
    gate.establish();
    expect(gate.roster()).toEqual({
      kind: "established",
      at: 7,
      ids: ["t0", "t1"],
    });
    expect(seen).toEqual([
      { kind: "established", at: 7, ids: ["t0", "t1"] },
      { kind: "settling" },
      { kind: "established", at: 7, ids: ["t0", "t1"] },
    ]);
  });

  it("publishes each CHANGE of the standing, with the epoch and the ids", () => {
    const seen: unknown[] = [];
    const gate = createFleetGate({
      publish: (roster) => seen.push(roster),
      now: () => 1_700_000_000_000,
    });
    expect(gate.roster()).toEqual({ kind: "settling" });
    gate.admit(frame(0));
    gate.admit(frame(1));
    gate.establish();
    gate.settling();
    expect(seen).toEqual([
      { kind: "established", at: 1_700_000_000_000, ids: ["t0"] },
      { kind: "settling" },
    ]);
    expect(gate.roster()).toEqual({ kind: "settling" });
  });

  it("states the REGISTRY's ids, and re-states them when membership moves", () => {
    let live: TerminalId[] = [];
    const seen: unknown[] = [];
    const gate = createFleetGate({
      publish: (roster) => seen.push(roster),
      now: () => 7,
      census: () => live,
    });
    gate.censusMoved();
    expect(seen).toEqual([]);

    live = ["a" as TerminalId];
    gate.establish();
    live = ["a" as TerminalId, "b" as TerminalId];
    gate.censusMoved();
    gate.censusMoved();
    live = ["a" as TerminalId];
    gate.censusMoved();
    expect(seen).toEqual([
      { kind: "established", at: 7, ids: ["a"] },
      { kind: "established", at: 7, ids: ["a", "b"] },
      { kind: "established", at: 7, ids: ["a"] },
    ]);
    expect(gate.roster()).toEqual({ kind: "established", at: 7, ids: ["a"] });
  });
});

function adopted(n: number) {
  const gate = createFleetGate();
  expect(gate.admit(frame(0))).toBe(false);
  for (let i = 0; i < n; i++) gate.awaitFirstRead(`t${i}` as TerminalId);
  return gate;
}

describe("createFleetGate — the survivors are read before attention", () => {
  it("refuses the adopted frame until every survivor has been read once, and opens on the last", () => {
    const gate = adopted(2);
    expect(gate.admit(frame(2))).toBe(false);
    gate.firstRead("t0" as TerminalId);
    expect(gate.admit(frame(2))).toBe(false);
    gate.firstRead("t1" as TerminalId);
    expect(gate.admit(frame(2))).toBe(true);
  });

  it("opens the CENSUS as soon as a survivor is listed — only the attention feed waits", () => {
    const gate = adopted(2);
    gate.admit(frame(2));
    expect(gate.roster().kind).toBe("established");
  });

  it("stops waiting for a survivor that goes away before it is read", () => {
    const gate = adopted(2);
    expect(gate.admit(frame(2))).toBe(false);
    gate.firstRead("t0" as TerminalId);
    expect(gate.admit(frame(1))).toBe(true);
  });

  it("does not wait on a terminal adopted after the feed opened — a mid-session adoption", () => {
    const gate = adopted(1);
    gate.firstRead("t0" as TerminalId);
    expect(gate.admit(frame(1))).toBe(true);
    gate.awaitFirstRead("t1" as TerminalId);
    expect(gate.admit(frame(2))).toBe(true);
  });

  it("still closes for a recycle's drain and re-opens at the re-park", () => {
    const gate = adopted(1);
    gate.firstRead("t0" as TerminalId);
    expect(gate.admit(frame(1))).toBe(true);
    gate.settling();
    expect(gate.admit(frame(0))).toBe(false);
    gate.establish();
    expect(gate.admit(frame(0))).toBe(true);
  });

  it("re-runs a fold that reads it when the last survivor is read, with no frame moving", () => {
    const gate = adopted(1);
    const unchanged = frame(1);
    let runs = 0;
    const fold = computed(() => {
      runs += 1;
      return gate.admit(unchanged);
    });
    expect(fold.value.value).toBe(false);
    const settledRuns = runs;
    expect(fold.value.value).toBe(false);
    expect(runs).toBe(settledRuns);
    gate.firstRead("t0" as TerminalId);
    expect(fold.value.value).toBe(true);
    gate.dispose();
  });

  it("re-runs that fold when the boot establishes an empty roster — a quiet host still reports", () => {
    const gate = createFleetGate();
    const empty = frame(0);
    const fold = computed(() => gate.admit(empty));
    expect(fold.value.value).toBe(false);
    gate.establish();
    expect(fold.value.value).toBe(true);
    gate.dispose();
  });
});
