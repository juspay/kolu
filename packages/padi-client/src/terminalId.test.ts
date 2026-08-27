/** The "any unique prefix" rule. Pinned HERE, where the fold lives — a test
 *  against `@kolu/padi/render` would pin the RE-EXPORT and go quietly green if
 *  the leaf drifted underneath it.
 *
 *  These cases moved verbatim from `packages/padi/src/cliClient/render.test.ts`;
 *  the relocation is a relocation, and the case-fold, the exact-wins ordering
 *  and the empty-query refusal are each pinned so it stays one. */
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
    // "1111" is an exact match AND a prefix of ids[0] — exact wins.
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
