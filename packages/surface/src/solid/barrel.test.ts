/**
 * The `@kolu/surface/solid` barrel must NOT re-export `createSurfaceHealthRegistry`
 * — the raw-`live` health-fact minter.
 *
 * `createSurfaceHealthRegistry(transportLive)` takes an UNBRANDED
 * `Accessor<boolean>` and folds it straight into `health().live`, so a consumer
 * could mint `createSurfaceHealthRegistry(() => true)`, enrol nothing, and feed
 * the fact to `<HostStatusPip>` / `<SurfaceGate>` — a green/ready dot over a
 * dead or half-open transport, the #1564 lie, reachable without ever touching a
 * socket or a watchdog. Its twin `buildSurfaceClient` (which also takes a raw
 * `live`) IS now exposed — but only for FRAMEWORK COMPOSITION (`@kolu/surface-map`
 * threads an app-RESOLVED `live` into its per-key clients), gated by the half-open
 * guard at `resolveTransport`. The registry minter has no such composition need and
 * no guard, so exposing IT would re-open the raw-`live` forge one module over — this
 * test pins that it stays private.
 *
 * The honest producers — `surfaceClient` / `surfaceClients`, which derive `live`
 * from a branded `LiveSignalHandle` (or constant-true for an in-process
 * `directDispatch`) — must stay the ONLY public way to obtain a health fact carrying
 * a transport leg. This test pins the asymmetry closed: it goes RED the instant
 * the blind-`live` minter is re-exposed from the public Solid barrel.
 */

import { describe, expect, it } from "vitest";
import * as solidBarrel from "./index";

describe("@kolu/surface/solid barrel — the raw-live health minter is package-private", () => {
  it("does NOT re-export createSurfaceHealthRegistry (the unbranded-live seam)", () => {
    expect(Object.keys(solidBarrel)).not.toContain(
      "createSurfaceHealthRegistry",
    );
    expect(
      (solidBarrel as Record<string, unknown>).createSurfaceHealthRegistry,
    ).toBeUndefined();
  });

  it("still exports the honest health producers (the barrel is intact, not emptied)", () => {
    // The fix removes ONLY the raw-`live` minter — the branded producers and the
    // policy-free fact helpers a consumer legitimately needs stay public.
    const keys = Object.keys(solidBarrel);
    expect(keys).toContain("surfaceClient");
    expect(keys).toContain("surfaceClients");
    expect(keys).toContain("surfaceClientsHealth");
    expect(keys).toContain("gateStatus");
    expect(keys).toContain("createLiveSignal");
  });
});
