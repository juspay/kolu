import { describe, expect, it } from "vitest";
import type { TerminalMetadata } from "@kolu/padi/surface";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  type FleetTerminalRow,
  groupFleetByHost,
  isTopLevelTerminal,
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

describe("isTopLevelTerminal — split children are not switcher rows", () => {
  it("includes root tiles (no parentId / null / undefined)", () => {
    expect(isTopLevelTerminal({})).toBe(true);
    expect(isTopLevelTerminal({ parentId: undefined })).toBe(true);
    expect(isTopLevelTerminal({ parentId: null })).toBe(true);
    expect(isTopLevelTerminal({ parentId: "" })).toBe(true);
  });

  it("excludes split children that carry a parentId", () => {
    expect(isTopLevelTerminal({ parentId: "agent-tile" })).toBe(false);
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
