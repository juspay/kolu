import type { TerminalMetadata } from "@kolu/padi-client/surface";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
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
