import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  clearHostVisits,
  mruIdsForHost,
  parseVisitList,
  upsertVisit,
  visitedAtOf,
  type VisitEntry,
} from "./visitRecency";

const T = (s: string) => s as TerminalId;
const A = T("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const B = T("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const Z = T("zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz");

describe("upsertVisit", () => {
  it("moves an existing key to the front and updates visitedAt", () => {
    const prev: VisitEntry[] = [
      { hostKey: "local", terminalId: A, visitedAt: 1 },
      { hostKey: "local", terminalId: B, visitedAt: 2 },
    ];
    const out = upsertVisit(prev, "local", A, 99);
    expect(out.map((e) => e.terminalId)).toEqual([A, B]);
    expect(out[0]!.visitedAt).toBe(99);
  });

  it("dedupes by hostKey+terminalId (same id on two hosts stays two rows)", () => {
    const prev: VisitEntry[] = [
      { hostKey: "local", terminalId: A, visitedAt: 1 },
      { hostKey: "remote:zest", terminalId: A, visitedAt: 2 },
    ];
    const out = upsertVisit(prev, "local", A, 10);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      hostKey: "local",
      terminalId: A,
      visitedAt: 10,
    });
    expect(out[1]!.hostKey).toBe("remote:zest");
  });

  it("caps length", () => {
    let list: VisitEntry[] = [];
    for (let i = 0; i < 5; i++) {
      list = upsertVisit(
        list,
        "local",
        T(`00000000-0000-4000-8000-00000000000${i}`),
        i,
        3,
      );
    }
    expect(list).toHaveLength(3);
    expect(list.map((e) => e.terminalId)).toEqual([
      T("00000000-0000-4000-8000-000000000004"),
      T("00000000-0000-4000-8000-000000000003"),
      T("00000000-0000-4000-8000-000000000002"),
    ]);
  });

  it("forces strictly monotonic timestamps on same-ms activations", () => {
    let list: VisitEntry[] = [];
    list = upsertVisit(list, "local", A, 1000);
    list = upsertVisit(list, "local", B, 1000);
    expect(list[0]!.terminalId).toBe(B);
    expect(list[0]!.visitedAt).toBeGreaterThan(list[1]!.visitedAt);
    expect(visitedAtOf(list, "local", B)).toBeGreaterThan(
      visitedAtOf(list, "local", A),
    );
  });
});

describe("parseVisitList", () => {
  it("accepts a valid array", () => {
    const raw = JSON.stringify([
      { hostKey: "local", terminalId: A, visitedAt: 1 },
    ]);
    expect(parseVisitList(raw)).toEqual([
      { hostKey: "local", terminalId: A, visitedAt: 1 },
    ]);
  });

  it("throws when top-level is not an array (persistedPref falls back)", () => {
    expect(() => parseVisitList(`{"nope":true}`)).toThrow();
  });

  it("drops corrupt rows / dupes and keeps well-formed entries", () => {
    const out = parseVisitList(
      JSON.stringify([
        { hostKey: "not-a-host", terminalId: A, visitedAt: 1 },
        { hostKey: "local", terminalId: "abc", visitedAt: 1 },
        { hostKey: "local", terminalId: A, visitedAt: 10 },
        { hostKey: "local", terminalId: A, visitedAt: 11 },
        {},
      ]),
    );
    expect(out).toEqual([{ hostKey: "local", terminalId: A, visitedAt: 10 }]);
  });

  it("caps over-long lists", () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      hostKey: "local",
      terminalId: T(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      visitedAt: i + 1,
    }));
    expect(parseVisitList(JSON.stringify(many))).toHaveLength(50);
  });
});

describe("visitedAtOf", () => {
  const visits: VisitEntry[] = [
    { hostKey: "local", terminalId: A, visitedAt: 1000 },
  ];

  it("returns stored stamp or 0", () => {
    expect(visitedAtOf(visits, "local", A)).toBe(1000);
    expect(visitedAtOf(visits, "local", B)).toBe(0);
  });
});

describe("mruIdsForHost / clear", () => {
  it("filters host slice", () => {
    const visits: VisitEntry[] = [
      { hostKey: "local", terminalId: A, visitedAt: 3 },
      { hostKey: "remote:zest", terminalId: Z, visitedAt: 2 },
      { hostKey: "local", terminalId: B, visitedAt: 1 },
    ];
    expect(mruIdsForHost(visits, "local")).toEqual([A, B]);
  });

  it("clearHostVisits", () => {
    const prev: VisitEntry[] = [
      { hostKey: "local", terminalId: A, visitedAt: 1 },
      { hostKey: "local", terminalId: B, visitedAt: 2 },
      { hostKey: "remote:zest", terminalId: Z, visitedAt: 3 },
    ];
    expect(clearHostVisits(prev, "local").map((e) => e.hostKey)).toEqual([
      "remote:zest",
    ]);
  });
});
