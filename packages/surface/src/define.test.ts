/**
 * `defineSurface` tag minting — the wire tags a spec mints, and the collisions
 * it refuses to mint.
 *
 * Two halves, both load-bearing:
 *
 *  1. **Verb honoring.** A cell's / collection's `verbs` narrows BOTH the runtime
 *     group AND its static tag union, in lockstep. The load-bearing case is a
 *     read-only cell (`verbs: ["get"]`, e.g. `@kolu/surface-remote`'s
 *     connection-health cell): it must expose `get` and NOTHING else, because a
 *     leaked `set` would let a remote RPC client forge the parent host's link
 *     health to `connected` and defeat the very stale-health gate the cell exists
 *     to power.
 *  2. **Collision refusal.** `RpcGroup.make` is a plain `Map.set` — a colliding
 *     tag is silently overwritten, last writer wins. So `defineSurface` carries
 *     its own duplicate-throw, and the flat tag namespace's new collision class
 *     (a member name containing `/`) is refused outright. Nothing here may be
 *     relaxed into a warning: a surface that silently loses a member serves 404s
 *     for a procedure whose type says it exists.
 *
 * The runtime assertions read `group.requests` — the group's own key set — which
 * IS the wire. The type assertions read `SurfaceTags<S>`, the spec-derived tag
 * union that Stage-2 handler binding and Stage-3 dispatch key off.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  composeSurfaceContracts,
  defineSurface,
  isStandaloneRoot,
  notStandaloneRootDetail,
  scopeSiblingTag,
  type SurfaceTags,
} from "./define";

/** Every wire tag a surface's group carries, sorted. */
function tags(surface: { group: { requests: ReadonlyMap<string, unknown> } }) {
  return [...surface.group.requests.keys()].sort();
}

/** The three framework-reserved members every surface carries. */
const RESERVED = [
  "surface/system/clockNow",
  "surface/system/identity",
  "surface/system/live",
];

const item = Schema.Struct({ x: Schema.String });

const getOnlyCell = {
  schema: item,
  default: { x: "" },
  verbs: ["get"],
} as const;

describe("defineSurface cell verbs", () => {
  it("a get-only cell mints get and NEVER set", () => {
    const surface = defineSurface({ cells: { conn: getOnlyCell } });
    expect(tags(surface)).toEqual([...RESERVED, "surface/conn/get"].sort());
  });

  it("a default (no verbs, no patch) cell mints get AND set", () => {
    const surface = defineSurface({
      cells: { plain: { schema: item, default: { x: "" } } },
    });
    expect(tags(surface)).toEqual(
      [...RESERVED, "surface/plain/get", "surface/plain/set"].sort(),
    );
  });

  it("a patch-bearing cell defaults to get + patch, not set", () => {
    const surface = defineSurface({
      cells: {
        prefs: {
          schema: item,
          default: { x: "" },
          patchSchema: Schema.Struct({ x: Schema.optionalKey(Schema.String) }),
        },
      },
    });
    expect(tags(surface)).toEqual(
      [...RESERVED, "surface/prefs/get", "surface/prefs/patch"].sort(),
    );
  });

  it("the get-only cell's TYPE exposes get and NOT set (no phantom verb)", () => {
    const surface = defineSurface({ cells: { conn: getOnlyCell } });
    type Tags = SurfaceTags<typeof surface.spec>;
    // If `CellVerbRpc` ignored `verbs` (the pre-fix bug), `HasSet` would be
    // `true` here and this assignment would fail to compile — the regression.
    type HasGet = "surface/conn/get" extends Tags ? true : false;
    type HasSet = "surface/conn/set" extends Tags ? true : false;
    const hasGet: HasGet = true;
    const hasSet: HasSet = false;
    expect([hasGet, hasSet]).toEqual([true, false]);
    // Reference the surface at runtime too, so the type assertion above can't
    // drift from the actual group the test built.
    expect(tags(surface)).not.toContain("surface/conn/set");
  });
});

describe("defineSurface collection verbs", () => {
  it("a default collection mints keys/get/upsert/delete but NOT deltas", () => {
    const surface = defineSurface({
      collections: { items: { keySchema: Schema.Number, schema: item } },
    });
    expect(tags(surface)).toEqual(
      [
        ...RESERVED,
        "surface/items/keys",
        "surface/items/get",
        "surface/items/upsert",
        "surface/items/delete",
      ].sort(),
    );
  });

  it("a default collection's TYPE exposes the default verbs and NOT deltas", () => {
    const surface = defineSurface({
      collections: { items: { keySchema: Schema.Number, schema: item } },
    });
    type Tags = SurfaceTags<typeof surface.spec>;
    type HasKeys = "surface/items/keys" extends Tags ? true : false;
    type HasUpsert = "surface/items/upsert" extends Tags ? true : false;
    // Pre-fix bug: the collection derivation ignored `verbs` and typed `deltas`
    // unconditionally, so `HasDeltas` was `true` and this line would NOT compile.
    type HasDeltas = "surface/items/deltas" extends Tags ? true : false;
    const hasKeys: HasKeys = true;
    const hasUpsert: HasUpsert = true;
    const hasDeltas: HasDeltas = false;
    expect([hasKeys, hasUpsert, hasDeltas]).toEqual([true, true, false]);
    expect(tags(surface)).not.toContain("surface/items/deltas");
  });

  it("a read-only collection (verbs: keys,get) mints and types NEITHER upsert NOR deltas", () => {
    const surface = defineSurface({
      collections: {
        items: {
          keySchema: Schema.Number,
          schema: item,
          verbs: ["keys", "get"],
        },
      },
    });
    expect(tags(surface)).toEqual(
      [...RESERVED, "surface/items/keys", "surface/items/get"].sort(),
    );
    type Tags = SurfaceTags<typeof surface.spec>;
    type HasUpsert = "surface/items/upsert" extends Tags ? true : false;
    type HasDeltas = "surface/items/deltas" extends Tags ? true : false;
    const hasUpsert: HasUpsert = false;
    const hasDeltas: HasDeltas = false;
    expect([hasUpsert, hasDeltas]).toEqual([false, false]);
  });

  it("a deltas-opted collection mints AND types deltas", () => {
    const surface = defineSurface({
      collections: {
        items: {
          keySchema: Schema.Number,
          schema: item,
          verbs: ["keys", "get", "upsert", "delete", "deltas"],
        },
      },
    });
    expect(tags(surface)).toContain("surface/items/deltas");
    type Tags = SurfaceTags<typeof surface.spec>;
    type HasDeltas = "surface/items/deltas" extends Tags ? true : false;
    const hasDeltas: HasDeltas = true;
    expect(hasDeltas).toBe(true);
  });
});

describe("defineSurface streams, events and procedures", () => {
  it("streams and events each mint one `get` tag", () => {
    const surface = defineSurface({
      streams: { view: { inputSchema: Schema.String, outputSchema: item } },
      events: { exited: { inputSchema: Schema.Void, outputSchema: item } },
    });
    expect(tags(surface)).toEqual(
      [...RESERVED, "surface/view/get", "surface/exited/get"].sort(),
    );
  });

  it("a procedure namespace mints one tag per verb, including the no-IO arm", () => {
    const surface = defineSurface({
      procedures: {
        notes: {
          create: { input: Schema.Struct({ t: Schema.String }), output: item },
          purge: {},
        },
      },
    });
    expect(tags(surface)).toEqual(
      [...RESERVED, "surface/notes/create", "surface/notes/purge"].sort(),
    );
    type Tags = SurfaceTags<typeof surface.spec>;
    const hasCreate: "surface/notes/create" extends Tags ? true : false = true;
    const hasPurge: "surface/notes/purge" extends Tags ? true : false = true;
    expect([hasCreate, hasPurge]).toEqual([true, true]);
  });

  it("a procedure namespace MERGES with a same-named primitive rather than replacing it", () => {
    // padi's `session` is a cell AND a procedure namespace. Both contribute to
    // the one member name; only a duplicate VERB is a collision.
    const surface = defineSurface({
      cells: { session: { schema: item, default: { x: "" }, verbs: ["get"] } },
      procedures: { session: { restore: {}, forfeit: {} } },
    });
    expect(tags(surface)).toEqual(
      [
        ...RESERVED,
        "surface/session/get",
        "surface/session/restore",
        "surface/session/forfeit",
      ].sort(),
    );
  });
});

describe("defineSurface reserved members", () => {
  it("every surface carries the three reserved system members", () => {
    expect(tags(defineSurface({}))).toEqual([...RESERVED].sort());
  });

  it("the reserved members merge into an app-owned `system` namespace", () => {
    const surface = defineSurface({
      procedures: { system: { echo: { input: item, output: item } } },
    });
    expect(tags(surface)).toEqual([...RESERVED, "surface/system/echo"].sort());
  });

  it.each([
    "live",
    "identity",
    "clockNow",
  ])("an app claiming the reserved `system.%s` verb is a loud boot-time collision", (verb) => {
    expect(() =>
      defineSurface({ procedures: { system: { [verb]: {} } } }),
    ).toThrow(new RegExp(`duplicate verb "${verb}"`));
  });
});

describe("defineSurface collision refusal", () => {
  it("throws when two primitives claim the same (member, verb)", () => {
    expect(() =>
      defineSurface({
        streams: { conn: { inputSchema: Schema.Void, outputSchema: item } },
        procedures: { conn: { get: {} } },
      }),
    ).toThrow(/duplicate verb "get" claimed at "conn"/);
  });

  it("refuses a member name carrying the tag separator (the FLAT-namespace collision class)", () => {
    // `member "conn/get" + verb "set"` and `procedure ns "conn" + verb "get/set"`
    // both spell `surface/conn/get/set` with DIFFERENT (member, verb) pairs, so
    // the duplicate-check could not see the collision. Refusing `/` in a name
    // makes it unrepresentable rather than merely detected.
    expect(() =>
      defineSurface({
        cells: { "conn/get": { schema: item, default: { x: "" } } },
      }),
    ).toThrow(/contains "\/"/);
    expect(() =>
      defineSurface({ procedures: { conn: { "get/set": {} } } }),
    ).toThrow(/contains "\/"/);
  });

  it("refuses an empty member name", () => {
    expect(() =>
      defineSurface({ cells: { "": { schema: item, default: { x: "" } } } }),
    ).toThrow(/empty cell name/);
  });

  it("refuses a name declared as BOTH a cell and a collection", () => {
    // Disjoint wire verbs (cell `get`, collection `keys`) so the duplicate-verb
    // guard can't mask it — the NAME collision itself is what must fail, because
    // the `$` sibling-read face is one flat namespace over both kinds.
    expect(() =>
      defineSurface({
        cells: { dual: { schema: item, default: { x: "" }, verbs: ["get"] } },
        collections: {
          dual: { keySchema: Schema.String, schema: item, verbs: ["keys"] },
        },
      }),
    ).toThrow(/declared as BOTH a cell and a collection/);
  });

  it("the assembled group carries EXACTLY the claimed tags — nothing dropped", () => {
    // The standing assertion `defineSurface` makes at boot, restated as a test:
    // `RpcGroup.make` silently overwrites a colliding tag, so a group whose size
    // matches the claim count is the proof that no member was lost.
    const surface = defineSurface({
      cells: { a: { schema: item, default: { x: "" } } },
      collections: { b: { keySchema: Schema.String, schema: item } },
      streams: { c: { inputSchema: Schema.Void, outputSchema: item } },
      events: { d: { inputSchema: Schema.Void, outputSchema: item } },
      procedures: { e: { one: {}, two: {} } },
    });
    // 2 cell + 4 collection + 1 stream + 1 event + 2 procedure + 3 reserved
    expect(surface.group.requests.size).toBe(13);
    for (const [tag, rpc] of surface.group.requests) {
      expect(rpc._tag).toBe(tag);
    }
  });
});

describe("composeSurfaceContracts", () => {
  const makeSurface = () =>
    defineSurface({
      cells: { conn: getOnlyCell },
      collections: { items: { keySchema: Schema.Number, schema: item } },
    });

  it("prefixes each sibling's tags with its key, reserved members included", () => {
    const composed = composeSurfaceContracts({
      alpha: makeSurface(),
      beta: makeSurface(),
    });
    expect([...composed.group.requests.keys()].sort()).toEqual(
      [
        "surface/alpha/conn/get",
        "surface/alpha/items/delete",
        "surface/alpha/items/get",
        "surface/alpha/items/keys",
        "surface/alpha/items/upsert",
        "surface/alpha/system/clockNow",
        "surface/alpha/system/identity",
        "surface/alpha/system/live",
        "surface/beta/conn/get",
        "surface/beta/items/delete",
        "surface/beta/items/get",
        "surface/beta/items/keys",
        "surface/beta/items/upsert",
        "surface/beta/system/clockNow",
        "surface/beta/system/identity",
        "surface/beta/system/live",
      ].sort(),
    );
  });

  it("keeps the reserved members of BOTH siblings — a bare merge would collide them", () => {
    // This is the whole reason composition prefixes instead of merging: the three
    // `system/*` tags are identical on every surface, and `RpcGroup.merge` is a
    // last-writer-wins `Map.set`, so a bare merge would leave one sibling's
    // liveness probe answering for the other's.
    const composed = composeSurfaceContracts({
      alpha: makeSurface(),
      beta: makeSurface(),
    });
    for (const key of ["alpha", "beta"]) {
      for (const verb of ["live", "identity", "clockNow"]) {
        expect(
          composed.group.requests.has(`surface/${key}/system/${verb}`),
        ).toBe(true);
      }
    }
  });

  it("exposes a per-sibling view carrying only that sibling's tags", () => {
    const composed = composeSurfaceContracts({
      alpha: makeSurface(),
      beta: makeSurface(),
    });
    expect(composed.siblings.alpha.tagPrefix).toBe("surface/alpha/");
    expect([...composed.siblings.alpha.group.requests.keys()].sort()).toEqual([
      "surface/alpha/conn/get",
      "surface/alpha/items/delete",
      "surface/alpha/items/get",
      "surface/alpha/items/keys",
      "surface/alpha/items/upsert",
      "surface/alpha/system/clockNow",
      "surface/alpha/system/identity",
      "surface/alpha/system/live",
    ]);
    expect(composed.siblings.beta.spec).toBe(composed.siblings.beta.spec);
  });

  it("the sibling tag prefix is what `scopeSiblingTag` computes from a standalone tag", () => {
    const composed = composeSurfaceContracts({ alpha: makeSurface() });
    // The Stage-3 dispatch wrapper builds a face against the STANDALONE tags and
    // rewrites through here, so the two derivations must agree exactly.
    for (const tag of [
      ...defineSurface({ cells: { conn: getOnlyCell } }).group.requests.keys(),
    ]) {
      expect(composed.group.requests.has(scopeSiblingTag(tag, "alpha"))).toBe(
        true,
      );
    }
  });

  it("refuses a sibling key carrying the tag separator", () => {
    expect(() => composeSurfaceContracts({ "a/b": makeSurface() })).toThrow(
      /contains "\/"/,
    );
  });
});

describe("scopeSiblingTag", () => {
  it("splices the sibling key after the surface root", () => {
    expect(scopeSiblingTag("surface/conn/get", "host1")).toBe(
      "surface/host1/conn/get",
    );
    expect(scopeSiblingTag("surface/system/live", "host1")).toBe(
      "surface/host1/system/live",
    );
  });

  it("throws on a tag that is not a surface tag", () => {
    // A mis-scoped dispatch must fail at the seam, not 404 at the far end.
    expect(() => scopeSiblingTag("terminal/create", "host1")).toThrow(
      /is not a surface tag/,
    );
  });
});

describe("the rooted-root law", () => {
  it("reads a standalone surface as a root and a sibling-scoped one as not", () => {
    const standalone = defineSurface({
      cells: { a: { schema: Schema.String, default: "" } },
    });
    expect(isStandaloneRoot(standalone)).toBe(true);
    expect(
      isStandaloneRoot(composeSurfaceContracts({ k: standalone }).siblings.k),
    ).toBe(false);
  });

  it("says the same sentence for every door, differing only in the door's own words", () => {
    // ONE reading of one law. The three doors that carry a root — the serve side,
    // the gate and the browser — kept three hand-synced copies of this sentence,
    // and the third arrived without amending the two that cite each other.
    const serve = notStandaloneRootDetail(
      "implementRootedSurfaces",
      "the root surface",
      "surface/kolu/",
      "serve it as a sibling with `implementSurfaces`",
    );
    const dial = notStandaloneRootDetail(
      "connectSurfaces",
      "`core.surface`",
      "surface/kolu/",
      "make it a sibling in `surfaces`",
    );
    for (const detail of [serve, dial]) {
      expect(detail).toMatch(
        /the root of a rooted bundle is the UNPREFIXED one/,
      );
      expect(detail).toContain('"surface/kolu/"');
    }
    expect(serve).toMatch(/^implementRootedSurfaces: the root surface/);
    expect(dial).toMatch(/^connectSurfaces: `core.surface`/);
  });
});
