import type { TerminalId } from "kolu-common/surface";
import { describe, expect, it } from "vitest";
import {
  applyHostLiveIds,
  clearHostVisits,
  mruIdsForHost,
  parseVisitList,
  removeVisit,
  upsertVisit,
  visitedAtOf,
  type VisitEntry,
} from "./visitRecency";

const T = (s: string) => s as TerminalId;
const A = T("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
const B = T("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
const C = T("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
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

  it("throws on invalid shape (caller falls back via persistedPref)", () => {
    expect(() => parseVisitList(`{"nope":true}`)).toThrow();
    expect(() => parseVisitList(`[{}]`)).toThrow();
  });

  it("rejects non-canonical host keys", () => {
    expect(() =>
      parseVisitList(
        JSON.stringify([
          { hostKey: "not-a-host", terminalId: A, visitedAt: 1 },
        ]),
      ),
    ).toThrow();
  });

  it("rejects non-UUID terminal ids", () => {
    expect(() =>
      parseVisitList(
        JSON.stringify([{ hostKey: "local", terminalId: "abc", visitedAt: 1 }]),
      ),
    ).toThrow();
  });

  it("rejects duplicates and over-cap", () => {
    expect(() =>
      parseVisitList(
        JSON.stringify([
          { hostKey: "local", terminalId: A, visitedAt: 1 },
          { hostKey: "local", terminalId: A, visitedAt: 2 },
        ]),
      ),
    ).toThrow(/duplicate/);
    const many = Array.from({ length: 51 }, (_, i) => ({
      hostKey: "local",
      terminalId: T(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      visitedAt: i,
    }));
    expect(() => parseVisitList(JSON.stringify(many))).toThrow(/cap/);
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

describe("mruIdsForHost / applyHostLiveIds / clear", () => {
  it("filters host slice", () => {
    const visits: VisitEntry[] = [
      { hostKey: "local", terminalId: A, visitedAt: 3 },
      { hostKey: "remote:zest", terminalId: Z, visitedAt: 2 },
      { hostKey: "local", terminalId: B, visitedAt: 1 },
    ];
    expect(mruIdsForHost(visits, "local")).toEqual([A, B]);
  });

  it("seeds an empty host trail without touching others", () => {
    const prev: VisitEntry[] = [
      { hostKey: "remote:zest", terminalId: Z, visitedAt: 9 },
    ];
    const out = applyHostLiveIds(prev, "local", [B, A], 100);
    expect(mruIdsForHost(out, "local")).toEqual([B, A]);
    expect(out.find((e) => e.hostKey === "remote:zest")?.visitedAt).toBe(9);
  });

  it("preserves survivor timestamps and does not restamp on reconcile", () => {
    const prev: VisitEntry[] = [
      { hostKey: "local", terminalId: A, visitedAt: 50 },
      { hostKey: "local", terminalId: B, visitedAt: 40 },
      { hostKey: "local", terminalId: C, visitedAt: 30 },
      { hostKey: "remote:zest", terminalId: Z, visitedAt: 99 },
    ];
    const out = applyHostLiveIds(prev, "local", [A, B], 1000);
    expect(out.find((e) => e.terminalId === A)?.visitedAt).toBe(50);
    expect(out.find((e) => e.terminalId === B)?.visitedAt).toBe(40);
    expect(out.find((e) => e.terminalId === C)).toBeUndefined();
    expect(out.find((e) => e.terminalId === Z)?.visitedAt).toBe(99);
  });

  it("appends missing live ids without restamping survivors", () => {
    const prev: VisitEntry[] = [
      { hostKey: "local", terminalId: A, visitedAt: 50 },
    ];
    const out = applyHostLiveIds(prev, "local", [A, B], 1000);
    expect(out.find((e) => e.terminalId === A)?.visitedAt).toBe(50);
    expect(out.find((e) => e.terminalId === B)?.visitedAt).toBeLessThan(50);
  });

  it("caps by true recency so newer remote visits survive local reconcile", () => {
    const prev: VisitEntry[] = [
      { hostKey: "remote:zest", terminalId: Z, visitedAt: 99 },
      { hostKey: "local", terminalId: A, visitedAt: 50 },
    ];
    const out = applyHostLiveIds(prev, "local", [A, B], 1000, 2);
    expect(out.map((e) => e.terminalId)).toEqual([Z, A]);
    expect(out.find((e) => e.terminalId === Z)?.visitedAt).toBe(99);
  });

  it("removeVisit and clearHostVisits", () => {
    const prev: VisitEntry[] = [
      { hostKey: "local", terminalId: A, visitedAt: 1 },
      { hostKey: "local", terminalId: B, visitedAt: 2 },
      { hostKey: "remote:zest", terminalId: Z, visitedAt: 3 },
    ];
    expect(removeVisit(prev, "local", A)).toHaveLength(2);
    expect(clearHostVisits(prev, "local").map((e) => e.hostKey)).toEqual([
      "remote:zest",
    ]);
  });
});
