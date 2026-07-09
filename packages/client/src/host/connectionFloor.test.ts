import type { ConnectionInfo } from "kolu-common/surfacesWithPadi";
import { describe, expect, it } from "vitest";
import { floorConnectionInfo } from "./connectionFloor.ts";

const building: ConnectionInfo = {
  phase: "building",
  log: [],
  sinceMs: 0,
};

describe("floorConnectionInfo — the per-entry connection cell's liveness floor (C')", () => {
  it("drops a stale provisioning phase when the map transport is NOT live", () => {
    // The un-floored-cell bug: a cell frozen at `building` over a dead/half-open link kept
    // narrating a build forever. Floored, it stops asserting any phase → the resolver falls
    // back to a neutral surface (connectPhase becomes undefined).
    expect(floorConnectionInfo(building, false)).toBeUndefined();
  });

  it("passes the value through untouched when the transport IS live", () => {
    // A genuine remote build is narrated THROUGH a live ws to kolu-server, so a live link is a
    // no-op — the overlay keeps narrating the real, in-flight phase.
    expect(floorConnectionInfo(building, true)).toBe(building);
  });

  it("is undefined-safe (pre-first-frame)", () => {
    expect(floorConnectionInfo(undefined, true)).toBeUndefined();
    expect(floorConnectionInfo(undefined, false)).toBeUndefined();
  });
});
