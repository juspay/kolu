/**
 * REGRESSION PIN (SRT-PR1, restated on the tag axis): the SERVED wire surface must
 * carry the re-served `surface/padi/*` sibling, the two siblings kolu-server owns,
 * and the root procedures — all of them, and nothing else.
 *
 * The trap this pins, in its oRPC form: `buildAppRouter` re-adapted the assembled
 * surface through `implement(servedContract)`, and a `servedContract` that failed to
 * widen the base (padi-less) contract SILENTLY DROPPED every `/surface/padi/*` route
 * from the wire matcher — a boot-time 404 that made padi "never become live" in the
 * e2e, and which the `directLink`-based `padiBinding` test could not see (directLink
 * bypasses the matcher).
 *
 * Under Effect RPC there is no matcher tree to inspect: the wire namespace is FLAT,
 * a tag carries its own route, and the served surface IS a `{ group, handlers }`
 * pair. So the same regression is pinned two ways, both of which the old
 * `StandardRPCMatcher` assertions stood in for:
 *
 *  1. **`servedGroup` carries the exact tag SUPERSET** — the root procedures, the
 *     `surface/kolu/*` + `surface/surfaceApp/*` siblings, and the padi MAP's folded
 *     members + `entries`. `RpcGroup.merge` is a last-writer-wins `Map.set` with
 *     zero collision detection (#16), so "the padi half is present" and "nothing was
 *     silently overwritten" are the same assertion: count, and spell the tags.
 *  2. **Every advertised tag has a handler, and every handler is advertised** —
 *     `assembleServedHandlers`, which is what turns an advertised-but-unbound tag
 *     (the silent 404) into a boot crash.
 */

import type { SurfaceHandlers } from "@kolu/surface/server";
import { Effect } from "effect";
import { ROOT_RPC_TAGS } from "kolu-common/contract";
import { padiHostMap } from "kolu-common/surfacesWithPadi";
import { describe, expect, it } from "vitest";
import { buildAppRouter } from "./router.ts";
import {
  assembleServedHandlers,
  SERVED_TAG_COUNTS,
  servedGroup,
} from "./surface.ts";

/** The root fragment, over deps that are never called by these tests. */
function rootFragment() {
  return buildAppRouter({
    drainBoundPadi: async () => {},
    addHost: async () => {},
    removeHost: async () => {},
    reconnectHost: () => {},
    renewHostDaemon: async () => {},
    viewerHost: async () => null,
  });
}

/** A handler record bound at exactly `tags` — the stand-in for a real fragment. */
function handlersAt(tags: Iterable<string>): SurfaceHandlers {
  const out: SurfaceHandlers = Object.create(null) as SurfaceHandlers;
  for (const tag of tags) out[tag] = () => Effect.void;
  return out;
}

const servedTags = () => [...servedGroup.requests.keys()];

describe("the served group — the wire surface kolu-server advertises", () => {
  it("carries the re-served padi sibling's folded members AND its entries collection", () => {
    const tags = servedTags();
    // The regression: these tags were DROPPED when the builder bound the padi-less
    // contract, so every `/surface/padi/*` request 404'd at the wire.
    expect(tags).toContain("surface/padi/entries/keys");
    expect(tags).toContain("surface/padi/entries/get");
    // A folded MEMBER, not just the membership collection — the map's own key-folded
    // half is what a browser actually drives a host's terminals through.
    expect(tags).toContain("surface/padi/terminals/keys");
    expect(tags).toContain("surface/padi/lifecycle/create");
    // No double prefix from the assembly (the `/surface/surface/…` shape the old
    // matcher-tree assertion watched for).
    expect(tags.filter((t) => t.startsWith("surface/surface/"))).toEqual([]);
  });

  it("carries kolu-server's own two siblings and the root procedures", () => {
    const tags = servedTags();
    expect(tags).toContain("surface/kolu/preferences/get");
    expect(tags).toContain("surface/kolu/forwards/create");
    expect(tags).toContain("surface/surfaceApp/identity/info");
    for (const tag of ROOT_RPC_TAGS) expect(tags).toContain(tag);
    // A root tag is not under `surface/` — which is exactly what keeps a
    // hand-written root procedure from ever colliding with a surface member.
    for (const tag of ROOT_RPC_TAGS)
      expect(tag.startsWith("surface/")).toBe(false);
  });

  it("is EXACTLY the three halves — nothing dropped, nothing extra (#16)", () => {
    // `RpcGroup.merge` overwrites a colliding tag silently, so counting is the only
    // way a collision is ever observed. The same assertion runs at import in
    // `surface.ts`; spelling it here is what keeps it from being deleted as
    // redundant when someone widens the merge.
    expect(servedGroup.requests.size).toBe(
      SERVED_TAG_COUNTS.root +
        SERVED_TAG_COUNTS.koluSurfaces +
        SERVED_TAG_COUNTS.padiMap,
    );
    expect(SERVED_TAG_COUNTS.root).toBe(ROOT_RPC_TAGS.length);
    expect(SERVED_TAG_COUNTS.padiMap).toBe(padiHostMap.group.requests.size);
    // The padi half is the MAP's, never the plain sibling's — a plain padi sibling
    // would also carry the three reserved `system/*` tags, which the map does not
    // serve, so they must not be advertised.
    expect(servedTags()).not.toContain("surface/padi/system/live");
  });
});

describe("assembleServedHandlers — route-set identity", () => {
  it("accepts the three real fragments and returns one record covering every tag", () => {
    const root = rootFragment();
    const handlers = assembleServedHandlers({
      root,
      // The two surface halves are stood in for by handler records bound at the
      // exact tags their groups advertise — this test is about the MERGE, and the
      // real producers assert their own tag/handler identity internally.
      kolu: {
        group: servedGroup,
        handlers: handlersAt(
          servedTags().filter(
            (t) =>
              t.startsWith("surface/kolu/") ||
              t.startsWith("surface/surfaceApp/"),
          ),
        ),
      },
      padiMap: {
        group: padiHostMap.group,
        handlers: handlersAt(padiHostMap.group.requests.keys()),
      },
    });
    expect(new Set(Object.keys(handlers))).toEqual(new Set(servedTags()));
    // A null-prototype record, like every framework handler record: a member named
    // `toString` must not resolve to an inherited function nobody bound.
    expect(Object.getPrototypeOf(handlers)).toBe(null);
  });

  it("THROWS when an advertised tag has no handler — the silent 404, made loud", () => {
    // Everything EXCEPT one padi tag — so the failure names exactly that tag.
    const allButOne = servedTags().filter(
      (t) => t !== "surface/padi/entries/keys",
    );
    expect(() =>
      assembleServedHandlers({
        root: { group: servedGroup, handlers: handlersAt([]) },
        kolu: { group: servedGroup, handlers: handlersAt(allButOne) },
        padiMap: { group: padiHostMap.group, handlers: handlersAt([]) },
      }),
    ).toThrow(/surface\/padi\/entries\/keys/);
  });

  it("THROWS when a handler sits at a tag the group never minted — dead code", () => {
    expect(() =>
      assembleServedHandlers({
        root: rootFragment(),
        kolu: {
          group: servedGroup,
          handlers: handlersAt([...servedTags(), "surface/kolu/ghost/get"]),
        },
        padiMap: {
          group: padiHostMap.group,
          handlers: handlersAt(padiHostMap.group.requests.keys()),
        },
      }),
    ).toThrow(/surface\/kolu\/ghost\/get/);
  });
});
