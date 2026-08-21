/**
 * Pins the ONE decode of the three supervision knobs — the pin that matters is
 * the last one: the CLI's stream input and an MCP `watch.open` go through this
 * same function, so a default can only ever be one number.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { WATCH_DEFAULT_STATES, WATCH_FILTER_KEYS } from "../surface.ts";
import { WATCH_SCOPE_ALL, watchScopeOf } from "./watchScope.ts";
import {
  namesWatchKnobs,
  specOf,
  watchFilterOf,
  watchSpecOf,
} from "./watchSpec.ts";

const okScope = (opts: Parameters<typeof watchScopeOf>[0]) => {
  const scope = watchScopeOf(opts);
  if (scope.kind === "error") throw new Error(scope.message);
  return scope.value;
};

const okSpec = (input: Parameters<typeof watchSpecOf>[0]) => {
  const spec = watchSpecOf(input);
  if (spec.kind === "error") throw new Error(spec.message);
  return spec.value;
};

const SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;

describe("specOf — the one place a filter becomes a spec", () => {
  it("joins the filter to the scope it is applied at, and nothing else", () => {
    const filter = { states: new Set(["waiting"] as const), heldForMs: 0 };
    expect(specOf(filter, WATCH_SCOPE_ALL)).toEqual({
      ...filter,
      scope: WATCH_SCOPE_ALL,
    });
    expect([
      ...(specOf(filter, okScope({ ids: [SELF] })).scope.include ?? []),
    ]).toEqual([SELF]);
    expect([
      ...(specOf(filter, okScope({ mute: [SELF] })).scope.mute ?? []),
    ]).toEqual([SELF]);
  });
});

describe("namesWatchKnobs", () => {
  it("is derived from the WIRE declaration — every knob counts, and nothing else does", () => {
    expect(namesWatchKnobs({})).toBe(false);
    // Not a hand-kept list: whatever `PadiWatchFilterFields` declares is what
    // makes an invocation a supervision watch, at both faces at once.
    expect([...WATCH_FILTER_KEYS].sort()).toEqual([
      "heldForMs",
      "nagMs",
      "states",
    ]);
    for (const key of WATCH_FILTER_KEYS) {
      expect(namesWatchKnobs({ [key]: undefined })).toBe(false);
      expect(
        namesWatchKnobs({ [key]: key === "states" ? ["working"] : 1 }),
      ).toBe(true);
    }
  });
});

describe("watchFilterOf", () => {
  it("answers `undefined` when no knob was named — a plain watch.open is untouched", () => {
    expect(watchFilterOf({})).toBeUndefined();
  });

  it("treats ANY named knob as the ask — there is no separate mode flag to forget", () => {
    expect(watchFilterOf({ nagMs: 1 })).toBeDefined();
    expect(watchFilterOf({ heldForMs: 0 })).toBeDefined();
    expect(watchFilterOf({ states: ["working"] })).toBeDefined();
  });

  it("defaults the states to the two that need a person", () => {
    expect([...(watchFilterOf({ nagMs: 1 })?.states ?? [])]).toEqual([
      ...WATCH_DEFAULT_STATES,
    ]);
    // `working` is deliberately not in it: a feed that announced every terminal
    // the moment it started thinking is the flood this replaces.
    expect(watchFilterOf({ nagMs: 1 })?.states.has("working")).toBe(false);
  });

  it("defaults the hold to zero — report it the instant it enters", () => {
    expect(watchFilterOf({ nagMs: 1 })?.heldForMs).toBe(0);
  });

  it("OMITS nagMs when none was asked for, rather than sending an undefined", () => {
    const filter = watchFilterOf({ heldForMs: 1 });
    expect(Object.hasOwn(filter ?? {}, "nagMs")).toBe(false);
  });
});

describe("watchSpecOf", () => {
  it("applies the SAME defaults the standing subscription gets", () => {
    const spec = okSpec({});
    expect([...spec.states]).toEqual([...WATCH_DEFAULT_STATES]);
    expect(spec.heldForMs).toBe(0);
  });

  it("scopes to the one optional id, and to the fleet without it", () => {
    expect([...(okSpec({ id: "abc" }).scope.include ?? [])]).toEqual(["abc"]);
    expect(okSpec({}).scope.include).toBeUndefined();
  });

  it("carries ignoreIds onto the spec the same way, omitted when none", () => {
    expect(okSpec({}).scope.mute).toBeUndefined();
    expect([...(okSpec({ ignoreIds: [SELF] }).scope.mute ?? [])]).toEqual([
      SELF,
    ]);
  });

  it("hands the never-match refusal back as a VALUE — the stream edge throws, not this", () => {
    const spec = watchSpecOf({ id: SELF, ignoreIds: [SELF] });
    expect(spec.kind).toBe("error");
    expect(spec.kind === "error" && spec.message).toMatch(/can never match/);
  });
});
