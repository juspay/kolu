import { describe, expect, it } from "vitest";
import { resolveTerminalId } from "./terminalId.ts";

describe("resolveTerminalId — prefix resolution", () => {
  const ids = [
    "11111111-1111-1111-1111-111111111111",
    "22222222-2222-2222-2222-222222222222",
    "2233aaaa-0000-0000-0000-000000000000",
  ];

  it("resolves a unique prefix", () => {
    expect(resolveTerminalId("1111", ids)).toEqual({
      kind: "found",
      id: ids[0],
    });
  });

  it("prefers an exact full id over a longer id sharing its prefix", () => {
    const withLonger = [...ids, "1111"];
    expect(resolveTerminalId("1111", withLonger)).toEqual({
      kind: "found",
      id: "1111",
    });
  });

  it("is case-insensitive", () => {
    expect(resolveTerminalId("2233AAAA", ids)).toEqual({
      kind: "found",
      id: ids[2],
    });
  });

  it("reports ambiguity with the matches", () => {
    const r = resolveTerminalId("22", ids);
    expect(r.kind).toBe("ambiguous");
    if (r.kind === "ambiguous") expect(r.matches).toHaveLength(2);
  });

  it("rejects an empty query as no-match (never silently the sole terminal)", () => {
    expect(resolveTerminalId("", ids)).toEqual({ kind: "none" });
  });

  it("reports no match for an unknown prefix", () => {
    expect(resolveTerminalId("ffff", ids)).toEqual({ kind: "none" });
  });
});

describe("resolveTerminalId — the shape a client actually holds", () => {
  const fleet = new Map([
    ["11111111-1111-1111-1111-111111111111", 1],
    ["22222222-2222-2222-2222-222222222222", 2],
  ]);

  it("takes a live map's keys without materialising them", () => {
    expect(resolveTerminalId("1111", fleet.keys())).toEqual({
      kind: "found",
      id: "11111111-1111-1111-1111-111111111111",
    });
    expect(resolveTerminalId("zz", fleet.keys())).toEqual({ kind: "none" });
  });

  it("still lets an exact match win over a prefix seen EARLIER in the walk", () => {
    expect(resolveTerminalId("1111", ["11111111-aaaa", "1111"])).toEqual({
      kind: "found",
      id: "1111",
    });
  });
});
