/**
 * REGRESSION PIN (SRT-PR1): the assembled app router must route the re-served
 * `/surface/padi/*` sibling over the WIRE matcher — the tree `RPCHandler` builds.
 *
 * The trap this pins: `buildAppRouter` binds its raw RPCs with
 * `t = implement(contract)`, and the base `contract` is padi-LESS (the widened
 * `servedContract` was retired at SRT-PR1). oRPC's `implement(contract).router(obj)`
 * ADAPTS `obj` against the contract and SILENTLY DROPS any key the contract
 * doesn't declare — so passing the `padi` sibling THROUGH `t.router({...})` drops
 * every `/surface/padi/*` route from the matcher (a boot-time 404: the server is
 * healthy, the padi session connects, but `POST /rpc/surface/padi/lifecycle/*`
 * 404s and padi never becomes "live"). The fix hand-merges the final `padi` router
 * onto the assembled object instead of re-adapting it through `t`.
 *
 * The `directLink`-based `padiBinding` integration test can NOT catch this —
 * `directLink` navigates the router object structurally, bypassing the
 * `StandardRPCMatcher` that the HTTP/ws `RPCHandler` uses. So this pins the matcher
 * tree directly, which is the exact surface the e2e exercises over the wire.
 */

import { implement } from "@orpc/server";
import { StandardRPCMatcher } from "@orpc/server/standard";
import { oc } from "@orpc/contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { buildAppRouter } from "./router.ts";

/** A minimal FINAL `padi` sibling router — the shape `index.ts` splices in from
 *  the re-served host map (a self-contained router built against its own
 *  contract, exactly like `serveHostMap`'s output). */
function padiSiblingSurface(): unknown {
  const padiContract = oc.router({
    lifecycle: { killAll: oc.output(z.object({}).loose()) },
  });
  const b = implement(oc.router({ surface: padiContract }));
  const built = b.router({
    surface: {
      lifecycle: { killAll: b.surface.lifecycle.killAll.handler(() => ({})) },
    },
    // biome-ignore lint/suspicious/noExplicitAny: a built router's `.surface` is the sibling map; runtime shape is a valid router leaf.
  }) as any;
  return built.surface;
}

describe("buildAppRouter — the re-served padi sibling routes over the wire matcher", () => {
  it("puts /surface/padi/* AND the raw /server/info in the StandardRPCMatcher tree", () => {
    const app = buildAppRouter({
      // The assembled surface object `index.ts` hands in: the re-served padi
      // sibling as a FINAL router leaf (kolu/surfaceApp elided — this test pins
      // that the padi splice survives the assembly, the exact regression).
      surfaceRouter: { surface: { padi: padiSiblingSurface() } },
      drainBoundPadi: async () => {},
      addHost: async () => {},
      removeHost: async () => {},
      reconnectHost: () => {},
    });

    const matcher = new StandardRPCMatcher();
    // biome-ignore lint/suspicious/noExplicitAny: matcher.init takes a Router; the assembled runtime shape satisfies it (the same `as any` RPCHandler uses).
    matcher.init(app as any);
    const paths = Object.keys(
      (matcher as unknown as { tree: Record<string, unknown> }).tree,
    );

    // The regression: this route was DROPPED when the padi sibling was spread
    // through the padi-less `t.router({...})`.
    expect(paths).toContain("/surface/padi/lifecycle/killAll");
    // The raw contract-declared RPC still routes (built through `t`).
    expect(paths).toContain("/server/info");
    // No double-prefix from the assembly.
    expect(paths).not.toContain("/surface/surface/padi/lifecycle/killAll");
  });
});
