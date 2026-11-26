import { createEffect, createRoot, createSignal, flush } from "solid-js";
import type { PadiTerminal, TerminalMetadata } from "@kolu/padi-client/surface";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  createFleetHostRows,
  type FleetTerminalRow,
  groupFleetByHost,
  isTileTerminal,
  orderHostsActiveFirst,
  rankFleetTerminalRows,
} from "./fleetTerminals";

const local: HostKey = { kind: "local" };
const remote: HostKey = { kind: "remote", target: "srid@builder" };

function row(
  host: HostKey,
  id: string,
  recencyAt: number | null,
): FleetTerminalRow {
  return {
    host,
    id: id as TerminalId,
    meta: { state: "active" } as TerminalMetadata,
    recencyAt,
  };
}

describe("rankFleetTerminalRows", () => {
  it("orders by recency across hosts (remote can beat local)", () => {
    const ranked = rankFleetTerminalRows([
      row(local, "a", 100),
      row(remote, "b", 500),
      row(local, "c", 200),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("puts never-active (null recency) last", () => {
    const ranked = rankFleetTerminalRows([
      row(local, "plain", null),
      row(remote, "agent", 50),
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["agent", "plain"]);
  });

  it("uses host encoding as a stable secondary key (exact unsorted order)", () => {
    const ranked = rankFleetTerminalRows([
      row(remote, "x", 10),
      row(local, "y", 10),
    ]);
    // local encodes before remote under localeCompare of encodeHostKey
    expect(ranked.map((r) => r.id)).toEqual(["y", "x"]);
  });
});

describe("isTileTerminal — split children are not switcher rows", () => {
  /** Parent edge from a partial map: missing key → absent from the census. */
  const edge =
    (parents: Record<string, string | null>) =>
    (id: TerminalId): TerminalId | null | undefined => {
      if (!(id in parents)) return undefined;
      const p = parents[id as string];
      return p === null ? null : (p as TerminalId);
    };

  it("includes a root tile", () => {
    expect(isTileTerminal("R" as TerminalId, edge({ R: null }))).toBe(true);
  });

  it("excludes a split child, at any depth", () => {
    const parentOf = edge({ R: null, M: "R", G: "M" });
    expect(isTileTerminal("M" as TerminalId, parentOf)).toBe(false);
    expect(isTileTerminal("G" as TerminalId, parentOf)).toBe(false);
  });

  it("includes a split whose parent is GONE — it paints as a tile everywhere else", () => {
    // The parent was killed or parked with no browser attached to re-home the
    // child, so its `parentId` dangles. The canvas and the Dock both paint it as
    // a top-level tile; a `!parentId` test would hide it from the switcher only,
    // making a live terminal findable from nowhere.
    expect(isTileTerminal("G" as TerminalId, edge({ G: "gone" }))).toBe(true);
  });

  it("includes cycle members — they are painted as tiles, never hidden", () => {
    const parentOf = edge({ A: "B", B: "A" });
    expect(isTileTerminal("A" as TerminalId, parentOf)).toBe(true);
    expect(isTileTerminal("B" as TerminalId, parentOf)).toBe(true);
  });
});

describe("groupFleetByHost", () => {
  it("buckets by host and keeps first-seen host order from ranked input", () => {
    const ranked = rankFleetTerminalRows([
      row(local, "a", 100),
      row(remote, "b", 500),
      row(local, "c", 200),
    ]);
    const groups = groupFleetByHost(ranked);
    expect(groups.map((g) => g.host)).toEqual([remote, local]);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(["b"]);
    expect(groups[1]!.rows.map((r) => r.id)).toEqual(["c", "a"]);
  });
});

describe("orderHostsActiveFirst", () => {
  it("puts the active host first and preserves relative order of the rest", () => {
    expect(orderHostsActiveFirst([local, remote], remote)).toEqual([
      remote,
      local,
    ]);
    expect(orderHostsActiveFirst([local, remote], local)).toEqual([
      local,
      remote,
    ]);
  });

  it("returns the input order when active is not in the list", () => {
    const other: HostKey = { kind: "remote", target: "other@box" };
    expect(orderHostsActiveFirst([local, remote], other)).toEqual([
      local,
      remote,
    ]);
  });
});

/** A FLEET ROW'S IDENTITY IS ITS TERMINAL'S. Every row-level consumer — the
 *  palette row's pip, its lead subtree — is bound to the row's `meta`, so a
 *  snapshot that rebuilt every row handed all of them a new-but-equal object
 *  whenever any one terminal on the host moved. */
describe("createFleetHostRows", () => {
  const wire = (lastActivityAt: number): PadiTerminal =>
    ({
      state: "active",
      lastActivityAt,
      parentId: null,
    }) as unknown as PadiTerminal;

  it("keeps an untouched terminal's row and meta across another's change", () => {
    const [a, setA] = createSignal(wire(10));
    const [b] = createSignal(wire(20));
    const held = createRoot((disposeRoot) => ({
      disposeRoot,
      rows: createFleetHostRows({
        host: local,
        keys: () => ["a", "b"] as TerminalId[],
        recordOf: (id) => (id === ("a" as TerminalId) ? a() : b()),
        // A reprojection mints a fresh record every call, as the clock one does.
        project: (record) => ({ ...record }) as TerminalMetadata,
        now: () => 0,
        thresholdMs: () => null,
      }),
    }));
    const rowB = (): FleetTerminalRow =>
      held.rows().find((r) => r.id === ("b" as TerminalId))!;
    flush();
    const before = rowB();
    for (let i = 1; i <= 4; i++) {
      setA(wire(10 + i));
      flush();
    }
    const after = rowB();
    expect(after).toBe(before);
    expect(after.meta).toBe(before.meta);
    held.disposeRoot();
  });

  it("wakes no consumer when the clock ticks without a record moving", () => {
    const [tick, setTick] = createSignal(0);
    const [a, setA] = createSignal(wire(10));
    let wakes = 0;
    const dispose = createRoot((disposeRoot) => {
      const rows = createFleetHostRows({
        host: local,
        keys: () => ["a"] as TerminalId[],
        recordOf: () => a(),
        project: (record) => ({ ...record }) as TerminalMetadata,
        now: tick,
        thresholdMs: () => null,
      });
      createEffect(
        () => rows(),
        () => {
          wakes++;
        },
      );
      return disposeRoot;
    });
    flush();
    setTick(1);
    setTick(2);
    flush();
    expect(wakes).toBe(1);
    setA(wire(20));
    flush();
    expect(wakes).toBe(2);
    dispose();
  });
});
