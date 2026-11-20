import type { SurfaceHandlers } from "@kolu/surface/server";
import { Effect } from "effect";
import { koluRootGroup, ROOT_RPC_TAGS } from "kolu-common/contract";
import { oduCarriedSurface, oduSibling } from "@kolu/padi-client/surface";
import { padiHostMap } from "kolu-common/surfacesWithPadi";
import { describe, expect, it } from "vitest";
import { buildAppRouter } from "./router.ts";
import { assembleServedHandlers, servedGroup } from "./surface.ts";

function rootFragment() {
  return buildAppRouter({
    drainBoundPadi: () => Effect.void,
    addHost: async () => {},
    removeHost: async () => {},
    reconnectHost: () => {},
    renewHostDaemon: () => Effect.void,
    listStateBackups: () => ({ backups: [] }),
    restoreStateBackup: async () => ({ hostFailures: [] }),
    viewerHost: async () => null,
  });
}

function handlersAt(tags: Iterable<string>): SurfaceHandlers {
  const out: SurfaceHandlers = Object.create(null) as SurfaceHandlers;
  for (const tag of tags) out[tag] = () => Effect.void;
  return out;
}

const servedTags = () => [...servedGroup.requests.keys()];

describe("the served group — the wire surface kolu-server advertises", () => {
  it("carries the re-served padi sibling's folded members AND its entries collection", () => {
    const tags = servedTags();
    expect(tags).toContain("surface/padi/entries/keys");
    expect(tags).toContain("surface/padi/entries/get");
    expect(tags).toContain("surface/padi/terminals/keys");
    expect(tags).toContain("surface/padi/lifecycle/create");
    expect(tags.filter((t) => t.startsWith("surface/surface/"))).toEqual([]);
  });

  it("the odu SIBLING's forward tags are the tags a per-host dispatch must answer", () => {
    const forwardTags = [...oduSibling.group.requests.keys()].sort();
    expect(forwardTags).toContain("surface/odu/checkout/get");
    expect(forwardTags).toContain("surface/odu/service/get");
    expect([...oduCarriedSurface.group.requests.keys()].sort()).not.toEqual(
      forwardTags,
    );
    const served = servedTags();
    expect(served).toContain("surface/padi/odu/checkout/get");
    expect(served).toContain("surface/padi/odu/service/get");
  });

  it("carries kolu-server's own two siblings and the root procedures", () => {
    const tags = servedTags();
    expect(tags).toContain("surface/kolu/preferences/get");
    expect(tags).toContain("surface/kolu/forwards/create");
    expect(tags).toContain("surface/surfaceApp/buildInfo/get");
    expect(tags).toContain("surface/surfaceApp/system/identity");
    for (const tag of ROOT_RPC_TAGS) expect(tags).toContain(tag);
    for (const tag of ROOT_RPC_TAGS)
      expect(tag.startsWith("surface/")).toBe(false);
  });

  it("is EXACTLY the three halves — nothing dropped, nothing extra (#16)", () => {
    expect(koluRootGroup.requests.size).toBe(ROOT_RPC_TAGS.length);
    expect(servedTags()).not.toContain("surface/padi/system/live");
    for (const tag of padiHostMap.group.requests.keys())
      expect(servedTags()).toContain(tag);
  });
});

describe("assembleServedHandlers — route-set identity", () => {
  it("accepts the three real fragments and returns one record covering every tag", () => {
    const root = rootFragment();
    const handlers = assembleServedHandlers({
      root,
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
    expect(Object.getPrototypeOf(handlers)).toBe(null);
  });

  it("THROWS when an advertised tag has no handler — the silent 404, made loud", () => {
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
