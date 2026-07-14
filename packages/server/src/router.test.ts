/**
 * REGRESSION PIN (SRT-PR1): the assembled app router must route the re-served
 * `/surface/padi/*` sibling over the WIRE matcher — the tree `RPCHandler` builds.
 *
 * The trap this pins: `buildAppRouter` re-adapts the assembled surface through
 * `t = implement(servedContract)`, and `servedContract` MUST widen the base
 * (padi-less) `contract` with the `padi` sibling. Two independent facts make the
 * widening load-bearing for ROUTING, not just types:
 *
 *  1. oRPC's `implement(C).router(obj)` adapts `obj` against `C` and SILENTLY
 *     DROPS any key `C` doesn't declare — so a padi-less builder drops every
 *     `/surface/padi/*` route from the matcher.
 *  2. `serveHostMap` returns a `{ surface: … }` FRAGMENT carrying no
 *     `/surface/padi/*` matcher meta of its own (it's structurally navigable by
 *     `directLink`, which is why `padiBinding.test` — a directLink test — can't
 *     see this). The padi-aware `servedContract` builder is what RE-ADAPTS that
 *     fragment under the `padi` key, attaching the wire routes.
 *
 * If `surface.ts` ever rebinds `t` to the padi-less `contract`, `t.surface.padi`
 * vanishes and this test throws (or the matcher loses the route) — the exact
 * boot-time 404 that made padi "never become live" in the e2e.
 */

import { StandardRPCMatcher } from "@orpc/server/standard";
import { describe, expect, it } from "vitest";
import { buildAppRouter } from "./router.ts";
import { t } from "./surface.ts";

/** A minimal `padi` sibling built through the EXPORTED `t` builder's
 *  `surface.padi` node — which only exists when `servedContract` widens the
 *  contract with padi. `entries` is the map's always-present membership
 *  collection (`serveHostMap` serves `keys` + `get`). */
function padiSibling(): unknown {
  // biome-ignore lint/suspicious/noExplicitAny: reach the padi builder node; its absence (padi-less `t`) is itself the regression this pins.
  const padi = (t as any).surface.padi;
  return {
    entries: {
      keys: padi.entries.keys.handler(async function* () {
        yield [];
      }),
      get: padi.entries.get.handler(async function* () {
        // A bare-string `membershipId` here is fine: `padi` is `(t as any)`, so
        // the branded `MembershipId` type never reaches this stub, and this yield
        // is dead — the test asserts the ROUTING tree, never invoking `get`. It is
        // not a typed `EntryStatus` fixture, so it needs no `testMembershipId()`.
        yield { kind: "warming", membershipId: "x" };
      }),
    },
  };
}

describe("buildAppRouter — the re-served padi sibling routes over the wire matcher", () => {
  it("puts /surface/padi/* AND the raw /server/info in the StandardRPCMatcher tree", () => {
    const app = buildAppRouter({
      // The assembled surface `index.ts` hands in: the re-served padi sibling
      // (kolu/surfaceApp elided — this test pins that the padi splice survives
      // the assembly's re-adaptation, the exact regression).
      surfaceRouter: { surface: { padi: padiSibling() } },
      drainBoundPadi: async () => {},
      addHost: async () => {},
      removeHost: async () => {},
      reconnectHost: () => {},
      // biome-ignore lint/suspicious/noExplicitAny: buildAppRouter's dynamic surface-router splice is opaque; the runtime shape is a valid router.
    } as any);

    const matcher = new StandardRPCMatcher();
    // biome-ignore lint/suspicious/noExplicitAny: matcher.init takes a Router; the assembled runtime shape satisfies it (the same `as any` RPCHandler uses).
    matcher.init(app as any);
    const paths = Object.keys(
      (matcher as unknown as { tree: Record<string, unknown> }).tree,
    );

    // The regression: these routes were DROPPED when `t` bound the padi-less
    // contract, so the wire matcher 404'd every `/surface/padi/*` request.
    expect(paths).toContain("/surface/padi/entries/keys");
    expect(paths).toContain("/surface/padi/entries/get");
    // The raw contract-declared RPC still routes (built through `t`).
    expect(paths).toContain("/server/info");
    // No double-prefix from the assembly.
    expect(paths).not.toContain("/surface/surface/padi/entries/keys");
  });
});
