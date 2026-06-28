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
 * `live`) is deliberately package-private for exactly this reason; exposing the
 * registry minter through the barrel re-opened the same seam one module over.
 *
 * The honest producers — `surfaceClient` / `surfaceClients`, which derive `live`
 * from a branded `LiveSignalHandle` (or constant-true for an in-process
 * `directLink`) — must stay the ONLY public way to obtain a health fact carrying
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
