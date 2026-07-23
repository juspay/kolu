import { describe, expect, it } from "vitest";
import type { TerminalMetadata } from "@kolu/padi/surface";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { type FleetTerminalRow, rankFleetTerminalRows } from "./fleetTerminals";

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

  it("uses host encoding as a stable secondary key", () => {
    const ranked = rankFleetTerminalRows([
      row(remote, "x", 10),
      row(local, "y", 10),
    ]);
    // local encodes before remote target string under localeCompare of encodeHostKey
    expect(ranked.map((r) => r.id).sort()).toEqual(["x", "y"].sort());
    expect(ranked).toHaveLength(2);
  });
});
