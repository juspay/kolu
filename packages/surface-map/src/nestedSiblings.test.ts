/**
 * A map with NESTED SIBLINGS, end to end.
 *
 * kolu's padi daemon re-serves odu's surface as a sibling of its own. The browser must
 * reach it PER HOST — `padiMap.entry(host).odu.streams.checkout.use(() => ({ repoRoot }))` — which
 * means a map entry carries, besides the entry surface, whole sibling surfaces of its
 * own. Three facts make that one mechanism rather than three:
 *
 *   - the TAG GRAMMAR. An entry member under a mounted map is
 *     `surface/<name>/<member>/<verb>`; a sibling member is exactly one segment deeper,
 *     `surface/<name>/<sibling>/<member>/<verb>` — the framework's own sibling rule
 *     applied twice (`mapSiblingTagPrefix`), never a hand-built string;
 *   - the FORWARD. A sibling member resolves the SAME per-entry dispatch an entry member
 *     does (`registry.resolve(key)`), with the map key riding the same envelope, and is
 *     re-tagged onto `surface/<sibling>/…` upstream — because on the entry's own socket
 *     that daemon IS a plain sibling, with no idea a map is mounted in front of it;
 *   - the FACE. `entry(key).<sibling>` is a full bound face built from the sibling's own
 *     spec over the same key-injecting dispatch, so the sibling client never learns it
 *     is keyed either.
 *
 * This file drives all three through a real served map, in process, and pins the
 * no-siblings case unchanged. Modelled on `siblingMount.test.ts`, whose mounted map it
 * extends.
 */

import {
  composeSurfaceContracts,
  defineSurface,
  surfaceTag,
} from "@kolu/surface/define";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { directDispatch } from "@kolu/surface/links/direct";
import { implementSurface, inMemoryStore } from "@kolu/surface/server";
import { Effect, Schema, Stream } from "effect";
import { createEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it } from "vitest";
import { connectSurfaceMap } from "./client";
import {
  defineSurfaceMap,
  ENTRY_FACE_MEMBERS,
  mapSiblingTagPrefix,
} from "./define";
import {
  A,
  B,
  connected,
  entrySurface,
  HostKeySchema,
  identityCodec,
  makeEntry,
  makeRegistry,
  settle,
  testFailureSchema,
} from "./mapHarness.testlib";
import { serveSurfaceMap } from "./server";

/** The nested sibling — a SECOND daemon's contract (odu's shape: a lane cell, a
 *  checkout stream, a CI procedure). It is a whole standalone surface, declared and
 *  versioned on its own; the map only mounts it. */
const oduSurface = defineSurface({
  cells: {
    lane: {
      schema: Schema.Struct({ name: Schema.String }),
      default: { name: "" },
      verbs: ["get"],
    },
  },
  streams: {
    checkout: {
      inputSchema: Schema.Struct({ repoRoot: Schema.String }),
      outputSchema: Schema.String,
    },
  },
  procedures: {
    ci: {
      run: {
        input: Schema.Struct({ repoRoot: Schema.String }),
        output: Schema.Struct({ lane: Schema.String }),
      },
    },
  },
});

/** odu as the ENTRY's own socket serves it: `surface/odu/…`. padi re-serves odu as a
 *  sibling of its own surface, so this is the UPSTREAM tag set the map hop forwards
 *  onto — minted by the framework's own `composeSurfaceContracts`, so the test cannot
 *  agree with the map about a tag rule neither of them shares with production. */
const oduUpstream = composeSurfaceContracts({ odu: oduSurface }).siblings.odu;

const LANE_UPSTREAM_TAG = surfaceTag(oduUpstream.tagPrefix, "lane", "get");
const CHECKOUT_UPSTREAM_TAG = surfaceTag(
  oduUpstream.tagPrefix,
  "checkout",
  "get",
);
const CI_RUN_UPSTREAM_TAG = surfaceTag(oduUpstream.tagPrefix, "ci", "run");

/** One entry's socket: the entry surface AND odu, served from ONE flat handler record
 *  — the shape a real padi socket has. Records every tag it is asked for, so a test can
 *  prove WHICH upstream tag the map forwarded onto. */
function makeHostSocket(lane: string) {
  const entry = makeEntry({ awaiting: 0, awaitingIds: [] });
  const odu = implementSurface(oduUpstream, {
    cells: { lane: { store: inMemoryStore({ name: lane }) } },
    streams: {
      checkout: {
        source: (input) => Stream.make(`${lane}:${input.repoRoot}`),
      },
    },
    procedures: {
      ci: {
        run: ({ input }) =>
          Effect.succeed({ lane: `${lane}:${input.repoRoot}` }),
      },
    },
  });
  const oduDispatch = directDispatch({ handlers: odu.handlers });
  const seen: string[] = [];
  const dispatch: SurfaceDispatch = {
    unary: (tag, payload) => {
      seen.push(tag);
      return (tag in odu.handlers ? oduDispatch : entry.dispatch).unary(
        tag,
        payload,
      );
    },
    stream: (tag, payload) => {
      seen.push(tag);
      return (tag in odu.handlers ? oduDispatch : entry.dispatch).stream(
        tag,
        payload,
      );
    },
  };
  return { dispatch, seen };
}

function mountedMap() {
  return defineSurfaceMap({
    key: HostKeySchema,
    entry: entrySurface,
    codec: identityCodec,
    failure: testFailureSchema,
    name: "padi",
    siblings: { odu: oduSurface },
  });
}

function setup() {
  const map = mountedMap();
  const reg = makeRegistry();
  const served = serveSurfaceMap(map, reg.registry);
  return { map, served, dispatch: directDispatch(served), ...reg };
}

describe("a map's NESTED SIBLINGS — the tag grammar", () => {
  it("mints every sibling member ONE SEGMENT deeper than an entry member, with no un-prefixed leak", () => {
    const { map, served } = setup();

    // The grammar, as a value: the prefix is the map's own mount with the sibling's
    // name under it.
    expect(mapSiblingTagPrefix(map, "odu")).toBe("surface/padi/odu/");
    expect(Object.keys(served.handlers).sort()).toEqual(
      expect.arrayContaining([
        "surface/padi/odu/lane/get",
        "surface/padi/odu/checkout/get",
        "surface/padi/odu/ci/run",
      ]),
    );
    // The ENTRY's own members stay where they were — a sibling adds a segment, it does
    // not move anything.
    expect(served.handlers["surface/padi/urgency/get"]).toBeTypeOf("function");

    // No leak, in either direction a mis-derived rule would produce: not the sibling's
    // standalone tag (the UPSTREAM one, which belongs to the entry's socket, not here),
    // and not an un-prefixed entry-level tag.
    expect(served.handlers[LANE_UPSTREAM_TAG]).toBeUndefined();
    expect(served.handlers["surface/padi/lane/get"]).toBeUndefined();
    expect(
      Object.keys(served.handlers).filter(
        (t) => !t.startsWith("surface/padi/"),
      ),
    ).toEqual([]);

    // Route-set identity holds with siblings in the group: every advertised tag is
    // bound, and nothing else is.
    expect(Object.keys(served.handlers).sort()).toEqual(
      [...map.group.requests.keys()].sort(),
    );
    served.dispose();
  });

  it("a map declared with NO siblings mints exactly what it always did", () => {
    const without = defineSurfaceMap({
      key: HostKeySchema,
      entry: entrySurface,
      codec: identityCodec,
      failure: testFailureSchema,
      name: "padi",
    });
    const { map } = setup();
    const added = [...map.group.requests.keys()].filter(
      (t) => !without.group.requests.has(t),
    );
    expect(without.siblings).toEqual({});
    // Every tag the sibling-bearing map adds is a sibling tag; nothing else moved.
    expect(added.every((t) => t.startsWith("surface/padi/odu/"))).toBe(true);
    expect([...without.group.requests.keys()].sort()).toEqual(
      [...map.group.requests.keys()]
        .filter((t) => !t.startsWith("surface/padi/odu/"))
        .sort(),
    );
  });

  it("REFUSES a sibling name that would shadow the entry face", () => {
    for (const shadow of ENTRY_FACE_MEMBERS) {
      expect(() =>
        defineSurfaceMap({
          key: HostKeySchema,
          entry: entrySurface,
          codec: identityCodec,
          failure: testFailureSchema,
          siblings: { [shadow]: oduSurface },
        }),
      ).toThrow(/collides with an entry face member/);
    }
  });

  it("REFUSES a sibling name that is not a legal tag segment", () => {
    expect(() =>
      defineSurfaceMap({
        key: HostKeySchema,
        entry: entrySurface,
        codec: identityCodec,
        failure: testFailureSchema,
        siblings: { "odu/ci": oduSurface },
      }),
    ).toThrow(/contains "\/"/);
  });
});

describe("a map's NESTED SIBLINGS — end to end through the entry's own session", () => {
  it("entry(KEY).odu.<member> reaches THAT key's dispatch, at the sibling's upstream tag", async () => {
    await createRoot(async (dispose) => {
      const { map, served, dispatch, addSession } = setup();
      const client = connectSurfaceMap(map, dispatch);
      const alpha = makeHostSocket("alpha");
      const beta = makeHostSocket("beta");
      addSession(A, alpha.dispatch, connected(0));
      addSession(B, beta.dispatch, connected(0));

      const laneA = client.entry(A).odu.cells.lane.use();
      const laneB = client.entry(B).odu.cells.lane.use();
      await settle();

      // The value came back from the RIGHT key's session — the map key rides the fold
      // envelope for a sibling member exactly as it does for an entry member.
      expect(laneA.value()?.name).toBe("alpha");
      expect(laneB.value()?.name).toBe("beta");
      // …and the forward landed on the sibling's UPSTREAM tag, not on the map's own.
      expect(alpha.seen).toContain(LANE_UPSTREAM_TAG);
      expect(alpha.seen.some((t) => t.startsWith("surface/padi/"))).toBe(false);

      served.dispose();
      dispose();
    });
  });

  it("a sibling STREAM carries its own input through the fold, per key", async () => {
    await createRoot(async (dispose) => {
      const { map, served, dispatch, addSession } = setup();
      const client = connectSurfaceMap(map, dispatch);
      const alpha = makeHostSocket("alpha");
      addSession(A, alpha.dispatch, connected(0));

      const checkout = client
        .entry(A)
        .odu.streams.checkout.use(() => ({ repoRoot: "/w/kolu" }));
      await settle();

      expect(checkout()).toBe("alpha:/w/kolu");
      expect(alpha.seen).toContain(CHECKOUT_UPSTREAM_TAG);

      served.dispose();
      dispose();
    });
  });

  it("a sibling PROCEDURE is a one-shot through the same per-entry dispatch", async () => {
    await createRoot(async (dispose) => {
      const { map, served, dispatch, addSession } = setup();
      const client = connectSurfaceMap(map, dispatch);
      const alpha = makeHostSocket("alpha");
      addSession(A, alpha.dispatch, connected(0));

      const result = await Effect.runPromise(
        client.entry(A).odu.procedures.ci.run({ repoRoot: "/w/odu" }),
      );
      expect(result).toEqual({ lane: "alpha:/w/odu" });
      expect(alpha.seen).toContain(CI_RUN_UPSTREAM_TAG);

      served.dispose();
      dispose();
    });
  });

  it("useEntry's sibling face re-keys with the entry's own", async () => {
    await createRoot(async (dispose) => {
      const { map, served, dispatch, addSession } = setup();
      const client = connectSurfaceMap(map, dispatch);
      addSession(A, makeHostSocket("alpha").dispatch, connected(0));
      addSession(B, makeHostSocket("beta").dispatch, connected(0));

      const [active, setActive] = createSignal(A);
      const view = client.useEntry(active);
      const lane = view.odu.cells.lane.use();
      await settle();
      expect(lane.value()?.name).toBe("alpha");

      setActive(B);
      await settle();
      expect(lane.value()?.name).toBe("beta");

      served.dispose();
      dispose();
    });
  });

  it("the entry's OWN face is untouched beside a sibling, and the sibling shadows nothing", async () => {
    await createRoot(async (dispose) => {
      const { map, served, dispatch, addSession } = setup();
      const client = connectSurfaceMap(map, dispatch);
      addSession(A, makeHostSocket("alpha").dispatch, connected(0));

      const e = client.entry(A);
      // The declaration-time reserved list IS this face's own property set — pinned
      // against the real object so a member added to `Entry` without being added to
      // `ENTRY_FACE_MEMBERS` becomes shadowable silently.
      expect(Object.keys(e).sort()).toEqual(
        [...ENTRY_FACE_MEMBERS, "odu"].sort(),
      );

      // The entry's own lenses still answer beside a sibling. `state()` folds the
      // membership collection, so it is read inside an effect and settled — the same
      // way every other map test reads it.
      const urgency = e.cells.urgency.use();
      let kind = "";
      createEffect(() => {
        kind = e.state().kind;
      });
      await settle();
      expect(urgency.value()?.awaiting).toBe(0);
      expect(kind).toBe("connected");

      served.dispose();
      dispose();
    });
  });
});
