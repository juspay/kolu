/**
 * The map's WIRE TAG SET (PLAN D1 / review #16) — the successor of the deleted
 * `StandardRPCMatcher` path tests.
 *
 * `RpcGroup.make` is a last-writer-wins `Map.set` with ZERO collision detection, and a
 * dynamically assembled group carries no type-level safety at all. So the only honest
 * pins for a spec-walked group are the ones here:
 *
 *   1. the group's key set, spelled LITERALLY — every folded entry-member verb plus the
 *      two unfolded `entries` members, and nothing else;
 *   2. the served handler set equals it, in both directions (`serveSurfaceMap` asserts
 *      this at boot; this test proves the assertion is reachable and true);
 *   3. `map.name` scopes every tag under `surface/<name>/`, which is exactly what
 *      `siblingTagPrefix` mints — so a mounted map and a standalone map derive their
 *      tags by ONE rule, never two;
 *   4. the `entries` members land at exactly the tags
 *      `defineSurface({ collections: { entries: map.entriesSpec } })` mints — the
 *      surface `connectSurfaceMap` builds the membership face from. If those two ever
 *      drifted, the membership subscription would 404 while every other pin stayed
 *      green;
 *   5. the RESERVED framework members are deliberately NOT folded — the map advertises
 *      no `system/*` tag, exactly as the oRPC-era map contract carried none.
 */

import { defineSurface, siblingTagPrefix } from "@kolu/surface/define";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurfaceMap } from "./define";
import {
  buildTestMap,
  HostKeySchema,
  identityCodec,
  makeRegistry,
  testFailureSchema,
} from "./mapHarness.testlib";
import { serveSurfaceMap } from "./server";

/** One entry surface exercising every primitive: a patchable cell, a full collection
 *  with deltas, a stream, an event and a two-verb procedure namespace. */
const richEntry = defineSurface({
  cells: {
    conn: {
      schema: Schema.Struct({ state: Schema.String }),
      default: { state: "down" },
      patchSchema: Schema.Struct({ state: Schema.String }),
      patch: (_c, p) => p,
      verbs: ["get", "set", "patch", "test__set"],
    },
  },
  collections: {
    terminals: {
      keySchema: Schema.String,
      schema: Schema.Struct({ title: Schema.String }),
      verbs: ["keys", "get", "deltas", "upsert", "delete", "test__set"],
    },
  },
  streams: {
    logs: { inputSchema: Schema.Struct({}), outputSchema: Schema.String },
  },
  events: {
    exits: { inputSchema: Schema.Struct({}), outputSchema: Schema.Number },
  },
  procedures: {
    lifecycle: {
      recycle: { input: Schema.Struct({ id: Schema.String }) },
      drain: {},
    },
  },
});

const FOLDED_TAGS = [
  "conn/get",
  "conn/set",
  "conn/patch",
  "conn/test__set",
  "terminals/keys",
  "terminals/get",
  "terminals/deltas",
  "terminals/upsert",
  "terminals/delete",
  "terminals/test__set",
  "logs/get",
  "exits/get",
  "lifecycle/recycle",
  "lifecycle/drain",
];
const ENTRIES_TAGS = ["entries/keys", "entries/get"];

describe("defineSurfaceMap — the exact wire tag set", () => {
  it("a STANDALONE map mints surface/<member>/<verb> for every folded verb, plus entries", () => {
    const map = buildTestMap({
      key: HostKeySchema,
      entry: richEntry,
      codec: identityCodec,
    });
    expect(map.tagPrefix).toBe("surface/");
    expect([...map.group.requests.keys()].sort()).toEqual(
      [...FOLDED_TAGS, ...ENTRIES_TAGS].map((t) => `surface/${t}`).sort(),
    );
  });

  it("a NAMED map scopes every tag under surface/<name>/ — the same rule siblingTagPrefix mints", () => {
    const map = defineSurfaceMap({
      key: HostKeySchema,
      entry: richEntry,
      codec: identityCodec,
      failure: testFailureSchema,
      name: "hosts",
    });
    expect(map.tagPrefix).toBe(siblingTagPrefix("hosts"));
    expect([...map.group.requests.keys()].sort()).toEqual(
      [...FOLDED_TAGS, ...ENTRIES_TAGS].map((t) => `surface/hosts/${t}`).sort(),
    );
  });

  it("advertises NO reserved system/* tag — the map does not fold the framework members", () => {
    const map = buildTestMap({
      key: HostKeySchema,
      entry: richEntry,
      codec: identityCodec,
    });
    // The ENTRY surface carries all three (every surface does); the MAP carries none,
    // exactly as the oRPC-era folded contract did. Per-entry liveness rides the
    // `entries` membership authority instead.
    expect([...richEntry.group.requests.keys()]).toEqual(
      expect.arrayContaining([
        "surface/system/live",
        "surface/system/identity",
        "surface/system/clockNow",
      ]),
    );
    expect(
      [...map.group.requests.keys()].filter((t) => t.includes("/system/")),
    ).toEqual([]);
  });

  it("the `entries` tags are exactly the ones defineSurface would mint from entriesSpec", () => {
    // `connectSurfaceMap` builds the membership face from THIS surface, so a drift
    // between the two walks would 404 the membership subscription while every other pin
    // stayed green.
    const map = buildTestMap({
      key: HostKeySchema,
      entry: richEntry,
      codec: identityCodec,
    });
    const entriesSurface = defineSurface({
      collections: { entries: map.entriesSpec },
    });
    const entriesTagsFromSurface = [
      ...entriesSurface.group.requests.keys(),
    ].filter((t) => t.startsWith("surface/entries/"));
    expect(entriesTagsFromSurface.sort()).toEqual(
      ENTRIES_TAGS.map((t) => `surface/${t}`).sort(),
    );
    expect(
      [...map.group.requests.keys()]
        .filter((t) => t.startsWith("surface/entries/"))
        .sort(),
    ).toEqual(entriesTagsFromSurface.sort());
  });

  it("REFUSES an entry member named `entries` — it would collide with the membership collection", () => {
    const colliding = defineSurface({
      collections: {
        entries: { keySchema: Schema.String, schema: Schema.String },
      },
    });
    expect(() =>
      buildTestMap({
        key: HostKeySchema,
        entry: colliding,
        codec: identityCodec,
      }),
    ).toThrow(/reserved membership collection/);
  });
});

describe("serveSurfaceMap — route-set identity (D1)", () => {
  it("binds a handler at EVERY advertised tag and at no other", () => {
    const map = buildTestMap({
      key: HostKeySchema,
      entry: richEntry,
      codec: identityCodec,
    });
    const served = serveSurfaceMap(map, makeRegistry().registry);
    expect(Object.keys(served.handlers).sort()).toEqual(
      [...map.group.requests.keys()].sort(),
    );
    // `serveSurfaceMap` hands back the SAME group it was defined with — one value pair
    // a host merges, never a second fragment to keep in step.
    expect(served.group).toBe(map.group);
    served.dispose();
  });

  it("a NAMED map's handlers are already keyed under its sibling prefix — nothing to re-prefix at the mount site", () => {
    const map = defineSurfaceMap({
      key: HostKeySchema,
      entry: richEntry,
      codec: identityCodec,
      failure: testFailureSchema,
      name: "hosts",
    });
    const served = serveSurfaceMap(map, makeRegistry().registry);
    expect(
      Object.keys(served.handlers).every((t) => t.startsWith("surface/hosts/")),
    ).toBe(true);
    expect(Object.keys(served.handlers).sort()).toEqual(
      [...map.group.requests.keys()].sort(),
    );
    served.dispose();
  });
});
