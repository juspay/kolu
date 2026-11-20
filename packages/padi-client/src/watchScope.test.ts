import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { scopeAdmits, WATCH_SCOPE_ALL, watchScopeOf } from "./watchScope.ts";
import { scopeOf as okScope } from "./watchScope.testlib.ts";

const SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;
const LANE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TerminalId;
const GONE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as TerminalId;

describe("watchScopeOf — the only constructor", () => {
  it("OMITS both halves for a fleet-wide watch rather than carrying an explicit undefined", () => {
    const scope = okScope({});
    expect(Object.hasOwn(scope, "include")).toBe(false);
    expect(Object.hasOwn(scope, "mute")).toBe(false);
  });

  it("normalizes an EMPTY mute to mute-nobody — one spelling of the identity", () => {
    expect(Object.hasOwn(okScope({ mute: [] }), "mute")).toBe(false);
  });

  it("refuses an EMPTY id list rather than silently watching everything", () => {
    const scope = watchScopeOf({ ids: [] });
    expect(scope.kind).toBe("error");
    expect(scope.kind === "error" && scope.refused).toBe("no-ids");
  });

  it("refuses when the mute covers every included id — the same never-match", () => {
    for (const opts of [
      { ids: [SELF], mute: [SELF] },
      { ids: [SELF, LANE], mute: [SELF, LANE] },
      { ids: [SELF], mute: [SELF, LANE] },
    ]) {
      const scope = watchScopeOf(opts);
      expect(scope.kind).toBe("error");
      expect(scope.kind === "error" && scope.message).toMatch(
        /can never match/,
      );
      expect(scope.kind === "error" && scope.refused).toBe("covered");
    }
  });

  it("does NOT refuse a fleet-wide mute, or a mute that leaves someone to watch", () => {
    expect(watchScopeOf({ mute: [SELF] }).kind).toBe("ok");
    expect(watchScopeOf({ ids: [SELF, LANE], mute: [SELF] }).kind).toBe("ok");
  });

  it("keeps a mute id nothing answers to — FAIL-OPEN is the whole point", () => {
    expect([...(okScope({ mute: [GONE] }).mute ?? [])]).toEqual([GONE]);
  });

  it("takes sets as readily as arrays — a face hands over what it has", () => {
    expect([...(okScope({ ids: new Set([SELF]) }).include ?? [])]).toEqual([
      SELF,
    ]);
  });
});

describe("scopeAdmits — the only reader", () => {
  it("admits everything under the fleet-wide scope", () => {
    expect(scopeAdmits(WATCH_SCOPE_ALL, SELF)).toBe(true);
  });

  it("fails CLOSED on the include list and OPEN on the mute", () => {
    const narrowed = okScope({ ids: [LANE] });
    expect(scopeAdmits(narrowed, LANE)).toBe(true);
    expect(scopeAdmits(narrowed, SELF)).toBe(false);

    const muted = okScope({ mute: [SELF] });
    expect(scopeAdmits(muted, SELF)).toBe(false);
    expect(scopeAdmits(muted, LANE)).toBe(true);
  });

  it("subtracts the mute from the include list", () => {
    const scope = okScope({ ids: [SELF, LANE], mute: [SELF] });
    expect(scopeAdmits(scope, SELF)).toBe(false);
    expect(scopeAdmits(scope, LANE)).toBe(true);
    expect(scopeAdmits(scope, GONE)).toBe(false);
  });
});
