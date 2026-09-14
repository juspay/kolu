/**
 * Pins the ONE decode of the supervision knobs — the pin that matters is the
 * last one: the CLI's stream input and an MCP `watch.open` go through this
 * same function, so a default can only ever be one number — and a refusal can
 * only ever be one sentence.
 */

import {
  WATCH_DEFAULT_STATES,
  WATCH_FILTER_KEYS,
} from "@kolu/padi-client/surface";
import { WATCH_SCOPE_ALL } from "@kolu/padi-client/watchScope";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { scopeOf as okScope } from "./attentionFixture.testlib.ts";
import {
  namesWatchKnobs,
  specOf,
  watchFilterOf,
  watchSpecOf,
} from "./watchSpec.ts";

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
      "nagCount",
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

const okFilter = (input: Parameters<typeof watchFilterOf>[0]) => {
  const filter = watchFilterOf(input);
  if (filter.kind === "error") throw new Error(filter.message);
  return filter.value;
};

describe("watchFilterOf", () => {
  it("answers `undefined` when no knob was named — a plain watch.open is untouched", () => {
    expect(okFilter({})).toBeUndefined();
  });

  it("treats ANY named knob as the ask — there is no separate mode flag to forget", () => {
    expect(okFilter({ nagMs: 1 })).toBeDefined();
    expect(okFilter({ heldForMs: 0 })).toBeDefined();
    expect(okFilter({ states: ["working"] })).toBeDefined();
  });

  it("defaults the states to the two that need a person", () => {
    expect([...(okFilter({ nagMs: 1 })?.states ?? [])]).toEqual([
      ...WATCH_DEFAULT_STATES,
    ]);
    // `working` is deliberately not in it: a feed that announced every terminal
    // the moment it started thinking is the flood this replaces.
    expect(okFilter({ nagMs: 1 })?.states.has("working")).toBe(false);
  });

  it("defaults the hold to zero — report it the instant it enters", () => {
    expect(okFilter({ nagMs: 1 })?.heldForMs).toBe(0);
  });

  it("OMITS nagMs when none was asked for, rather than sending an undefined", () => {
    const filter = okFilter({ heldForMs: 1 });
    expect(Object.hasOwn(filter ?? {}, "nagMs")).toBe(false);
  });

  it("carries the CAP the caller spelled — and omits it when none was", () => {
    expect(okFilter({ nagMs: 1, nagCount: 3 })?.nagCount).toBe(3);
    const filter = okFilter({ nagMs: 1 });
    expect(Object.hasOwn(filter ?? {}, "nagCount")).toBe(false);
  });

  it("REFUSES a cap without an interval — the decode owns the sentence, not the faces", () => {
    // A count names how many times a REPETITION fires; with no interval there
    // is no repetition, so the pairing is refused where every entrance passes
    // — one sentence, no matter how the caller got here.
    const refused = watchFilterOf({ nagCount: 3 });
    expect(refused.kind).toBe("error");
    expect(refused.kind === "error" ? refused.message : "").toMatch(
      /nagCount caps the nagging, but no nagMs was given/,
    );
  });
});

describe("watchSpecOf", () => {
  it("refuses the same orphan the filter half refuses — one pairing rule", () => {
    const refused = watchSpecOf({ states: ["waiting"], nagCount: 3 });
    expect(refused.kind).toBe("error");
    expect(refused.kind === "error" ? refused.message : "").toMatch(
      /nagCount caps the nagging, but no nagMs was given/,
    );
  });
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
