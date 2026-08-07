/**
 * A map MOUNTED AS A SIBLING, end to end (PR3 + PLAN D1/D2).
 *
 * kolu mounts its padi map under `"padi"`, drishti its host map under `"hosts"`. Under
 * the oRPC nested router that meant two separate moves — the host spliced the served
 * `.surface` fragment under the name, and `connectSurfaceMap` re-wrapped the LINK with
 * `scopeSibling(link, name)`. The re-wrap was also the hazard: it stripped the
 * half-open brand, which is why `connectSurfaceMap` had to refuse a pre-sliced link.
 *
 * On the flat tag namespace both moves collapse into ONE fact carried on the map value
 * — `map.tagPrefix` — and the client scopes by rewriting TAGS over the SAME resolved
 * dispatch, never by rebuilding it. So:
 *
 *   - the served handlers are already keyed under `surface/<name>/…`; a host merges
 *     them into its own record with nothing to re-prefix;
 *   - the per-key entry face, built from the STANDALONE entry surface, still reaches
 *     the mounted member, because the key-injecting dispatch re-tags on the way out;
 *   - the branded transport is untouched by scoping, so the brand-stripping class of
 *     bug has no construction path left.
 *
 * This file drives all three through a real served map under a mount name — the path
 * every production consumer takes and that the nameless in-process harness (every other
 * test here) does not.
 */

import { directDispatch } from "@kolu/surface/links/direct";
import { createEffect, createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { connectSurfaceMap } from "./client";
import { defineSurfaceMap } from "./define";
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

function mountedSetup() {
  const map = defineSurfaceMap({
    key: HostKeySchema,
    entry: entrySurface,
    codec: identityCodec,
    failure: testFailureSchema,
    name: "hosts",
  });
  const reg = makeRegistry();
  const served = serveSurfaceMap(map, reg.registry);
  return { map, served, dispatch: directDispatch(served), ...reg };
}

describe("a map mounted as a sibling — one tag rule, no link re-wrap", () => {
  it("serves and consumes a per-key member end to end under surface/<name>/", async () => {
    await createRoot(async (dispose) => {
      const { map, served, dispatch, addSession } = mountedSetup();
      // The handler really is at the SIBLING tag, not the standalone one.
      expect(served.handlers["surface/hosts/urgency/get"]).toBeTypeOf(
        "function",
      );
      expect(served.handlers["surface/urgency/get"]).toBeUndefined();

      const client = connectSurfaceMap(map, dispatch);
      addSession(
        A,
        makeEntry({ awaiting: 5, awaitingIds: ["x"] }).dispatch,
        connected(0),
      );
      addSession(
        B,
        makeEntry({ awaiting: 8, awaitingIds: [] }).dispatch,
        connected(0),
      );

      // The entry face is built from the STANDALONE `map.entry`, so it mints
      // `surface/urgency/get`; the key-injecting dispatch re-tags it onto
      // `surface/hosts/urgency/get` on the way out. If it did not, this read would hit
      // an unbound tag and `directDispatch` would crash loudly rather than hang.
      const rA = client.entry(A).cells.urgency.use();
      const rB = client.entry(B).cells.urgency.use();
      await settle();
      expect(rA.value()?.awaiting).toBe(5);
      expect(rB.value()?.awaiting).toBe(8);

      served.dispose();
      dispose();
    });
  });

  it("the membership authority is reachable under the mount too", async () => {
    await createRoot(async (dispose) => {
      const { map, served, dispatch, addSession } = mountedSetup();
      const client = connectSurfaceMap(map, dispatch);
      let keys: string[] = [];
      createEffect(() => {
        keys = client.entries.use().keys().map(String);
      });
      addSession(
        A,
        makeEntry({ awaiting: 0, awaitingIds: [] }).dispatch,
        connected(0),
      );
      await settle();
      expect(keys).toEqual(["a"]);
      served.dispose();
      dispose();
    });
  });

  it("scoping does NOT re-wrap the transport — the branded-dispatch guard still fires for a mounted map", () => {
    // The old hazard: `scopeSibling(link, name)` rebuilt the link value and dropped the
    // half-open brand with it, so a pre-sliced link reached `resolveTransport`'s
    // by-exclusion constant-`true` and floored every chip green over a dead socket
    // (#1564/#1580). Scoping is a TAG rewrite now, so the guard sees the SAME value the
    // caller passed — a mounted map is no weaker than a standalone one.
    const { map, served } = mountedSetup();
    const bare = {
      unary: () => {
        throw new Error("unreachable");
      },
      stream: () => {
        throw new Error("unreachable");
      },
    };
    createRoot((dispose) => {
      expect(() => connectSurfaceMap(map, bare)).toThrow(
        /BRANDED parent transport handle/,
      );
      dispose();
    });
    served.dispose();
  });
});
