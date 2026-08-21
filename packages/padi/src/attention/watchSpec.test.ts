/**
 * Pins the ONE decode of the three supervision knobs — the pin that matters is
 * the last one: the CLI's stream input and an MCP `watch.open` go through this
 * same function, so a default can only ever be one number.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { WATCH_DEFAULT_STATES, WATCH_FILTER_KEYS } from "../surface.ts";
import {
  containingTerminalId,
  ignoreIdsOf,
  ignoreSelfUnresolvable,
  namesWatchKnobs,
  specOf,
  watchFilterOf,
  watchSpecOf,
} from "./watchSpec.ts";

const SELF = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" as TerminalId;
const LANE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" as TerminalId;

describe("specOf — the one place a filter becomes a spec", () => {
  it("OMITS `ids` for a fleet-wide watch rather than sending an explicit undefined", () => {
    const filter = { states: new Set(["waiting"] as const), heldForMs: 0 };
    expect(Object.hasOwn(specOf(filter), "ids")).toBe(false);
    expect([...(specOf(filter, new Set(["abc"])).ids ?? [])]).toEqual(["abc"]);
  });

  it("OMITS `ignoreIds` when none were asked for, and carries a mute set when they were", () => {
    const filter = { states: new Set(["waiting"] as const), heldForMs: 0 };
    expect(Object.hasOwn(specOf(filter), "ignoreIds")).toBe(false);
    expect([
      ...(specOf(filter, undefined, new Set([SELF])).ignoreIds ?? []),
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
    const spec = watchSpecOf({});
    expect([...spec.states]).toEqual([...WATCH_DEFAULT_STATES]);
    expect(spec.heldForMs).toBe(0);
  });

  it("scopes to the one optional id, and to the fleet without it", () => {
    expect([...(watchSpecOf({ id: "abc" }).ids ?? [])]).toEqual(["abc"]);
    expect(watchSpecOf({}).ids).toBeUndefined();
  });

  it("carries ignoreIds onto the spec the same way, omitted when none", () => {
    expect(Object.hasOwn(watchSpecOf({}), "ignoreIds")).toBe(false);
    expect([...(watchSpecOf({ ignoreIds: [SELF] }).ignoreIds ?? [])]).toEqual([
      SELF,
    ]);
  });
});

describe("ignoreIdsOf — listed mutes plus optional self, fail-open", () => {
  it("OMITS the key when nothing is muted", () => {
    expect(ignoreIdsOf()).toBeUndefined();
    expect(ignoreIdsOf([])).toBeUndefined();
  });

  it("unions listed ids with self when both are present", () => {
    expect([...(ignoreIdsOf([LANE], SELF) ?? [])].sort()).toEqual(
      [LANE, SELF].sort(),
    );
  });

  it("a listed id that is not live is still in the set — inert at the engine, not refused here", () => {
    const gone = "cccccccc-cccc-4ccc-8ccc-cccccccccccc" as TerminalId;
    expect([...(ignoreIdsOf([gone]) ?? [])]).toEqual([gone]);
  });
});

describe("containingTerminalId — KAVAL_TERMINAL_ID, or none", () => {
  it("is none when the env does not name a terminal", () => {
    expect(containingTerminalId({})).toEqual({ kind: "none" });
    expect(containingTerminalId({ KAVAL_TERMINAL_ID: "" })).toEqual({
      kind: "none",
    });
  });

  it("is this terminal when the env carries a real id", () => {
    expect(containingTerminalId({ KAVAL_TERMINAL_ID: SELF })).toEqual({
      kind: "ok",
      id: SELF,
    });
  });

  it("is invalid rather than a guess when the stamp is not a terminal id", () => {
    expect(containingTerminalId({ KAVAL_TERMINAL_ID: "not-a-uuid" })).toEqual({
      kind: "invalid",
      raw: "not-a-uuid",
    });
  });
});

describe("ignoreSelfUnresolvable — refuse rather than guess", () => {
  it("names the env the face would have read, and the way out", () => {
    expect(ignoreSelfUnresolvable("cli")).toMatch(/KAVAL_TERMINAL_ID/);
    expect(ignoreSelfUnresolvable("cli")).toMatch(/--ignore/);
    expect(ignoreSelfUnresolvable("mcp")).toMatch(/KAVAL_TERMINAL_ID/);
    expect(ignoreSelfUnresolvable("mcp")).toMatch(/ignoreIds/);
  });
});
