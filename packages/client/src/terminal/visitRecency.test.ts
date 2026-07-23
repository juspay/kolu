import { describe, expect, it } from "vitest";
import type { TerminalId } from "kolu-common/surface";
import {
  clearHostVisits,
  joinVisitsToLive,
  mruIdsForHost,
  parseVisitList,
  removeVisit,
  replaceHostVisitOrder,
  upsertVisit,
  visitLiveKey,
  visitRankScore,
  type VisitEntry,
} from "./visitRecency";

const T = (s: string) => s as TerminalId;

describe("upsertVisit", () => {
  it("moves an existing key to the front and updates visitedAt", () => {
    const prev: VisitEntry[] = [
      { hostKey: "local", terminalId: T("a"), visitedAt: 1 },
      { hostKey: "local", terminalId: T("b"), visitedAt: 2 },
    ];
    const out = upsertVisit(prev, "local", T("a"), 99);
    expect(out.map((e) => e.terminalId)).toEqual([T("a"), T("b")]);
    expect(out[0]!.visitedAt).toBe(99);
  });

  it("dedupes by hostKey+terminalId (same id on two hosts stays two rows)", () => {
    const prev: VisitEntry[] = [
      { hostKey: "local", terminalId: T("a"), visitedAt: 1 },
      { hostKey: "remote:zest", terminalId: T("a"), visitedAt: 2 },
    ];
    const out = upsertVisit(prev, "local", T("a"), 10);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      hostKey: "local",
      terminalId: T("a"),
      visitedAt: 10,
    });
    expect(out[1]!.hostKey).toBe("remote:zest");
  });

  it("caps length", () => {
    let list: VisitEntry[] = [];
    for (let i = 0; i < 5; i++) {
      list = upsertVisit(list, "local", T(`t${i}`), i, 3);
    }
    expect(list).toHaveLength(3);
    expect(list.map((e) => e.terminalId)).toEqual([T("t4"), T("t3"), T("t2")]);
  });
});

describe("parseVisitList", () => {
  it("accepts a valid array", () => {
    const raw = JSON.stringify([
      { hostKey: "local", terminalId: "abc", visitedAt: 1 },
    ]);
    expect(parseVisitList(raw)).toEqual([
      { hostKey: "local", terminalId: "abc", visitedAt: 1 },
    ]);
  });

  it("throws on invalid shape (caller falls back via persistedPref)", () => {
    expect(() => parseVisitList(`{"nope":true}`)).toThrow();
    expect(() => parseVisitList(`[{}]`)).toThrow();
  });
});

describe("visitRankScore", () => {
  const visits: VisitEntry[] = [
    { hostKey: "local", terminalId: T("a"), visitedAt: 1000 },
  ];

  it("is max(visit, activity)", () => {
    expect(visitRankScore(visits, "local", T("a"), 500)).toBe(1000);
    expect(visitRankScore(visits, "local", T("a"), 2000)).toBe(2000);
  });

  it("uses activity alone when never visited", () => {
    expect(visitRankScore(visits, "local", T("b"), 42)).toBe(42);
    expect(visitRankScore(visits, "local", T("b"), null)).toBe(0);
  });
});

describe("joinVisitsToLive", () => {
  it("drops entries whose host/terminal is absent", () => {
    const visits: VisitEntry[] = [
      { hostKey: "local", terminalId: T("a"), visitedAt: 1 },
      { hostKey: "local", terminalId: T("b"), visitedAt: 2 },
      { hostKey: "remote:zest", terminalId: T("c"), visitedAt: 3 },
    ];
    const live = new Set([
      visitLiveKey("local", T("a")),
      visitLiveKey("remote:zest", T("c")),
    ]);
    expect(joinVisitsToLive(visits, live).map((e) => e.terminalId)).toEqual([
      T("a"),
      T("c"),
    ]);
  });
});

describe("mruIdsForHost / replaceHostVisitOrder / clear", () => {
  it("filters host slice", () => {
    const visits: VisitEntry[] = [
      { hostKey: "local", terminalId: T("a"), visitedAt: 3 },
      { hostKey: "remote:zest", terminalId: T("z"), visitedAt: 2 },
      { hostKey: "local", terminalId: T("b"), visitedAt: 1 },
    ];
    expect(mruIdsForHost(visits, "local")).toEqual([T("a"), T("b")]);
  });

  it("replaceHostVisitOrder reseeds one host without touching others", () => {
    const prev: VisitEntry[] = [
      { hostKey: "remote:zest", terminalId: T("z"), visitedAt: 9 },
      { hostKey: "local", terminalId: T("old"), visitedAt: 1 },
    ];
    const out = replaceHostVisitOrder(prev, "local", [T("b"), T("a")], 100);
    expect(mruIdsForHost(out, "local")).toEqual([T("b"), T("a")]);
    expect(out.some((e) => e.hostKey === "remote:zest")).toBe(true);
  });

  it("removeVisit and clearHostVisits", () => {
    const prev: VisitEntry[] = [
      { hostKey: "local", terminalId: T("a"), visitedAt: 1 },
      { hostKey: "local", terminalId: T("b"), visitedAt: 2 },
      { hostKey: "remote:zest", terminalId: T("z"), visitedAt: 3 },
    ];
    expect(removeVisit(prev, "local", T("a"))).toHaveLength(2);
    expect(clearHostVisits(prev, "local").map((e) => e.hostKey)).toEqual([
      "remote:zest",
    ]);
  });
});
