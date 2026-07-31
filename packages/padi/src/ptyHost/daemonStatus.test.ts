/**
 * The publish middle-hop for the Kaval-lifetime mirror (F6): `publishDaemonStatus`
 * folds the endpoint's `metadata.lifetime` onto the CONNECTED `DaemonStatus` it
 * records + publishes (`daemonStatus.ts` → the connected arm's `lifetime`). Both
 * the metadata field and the status field are optional (a survivor predating the
 * field carries none), so deleting that copy still type-checks — the passthrough
 * needs a behavioural pin. This drives the real publisher (with a no-op surface
 * ctx) and reads the stored status back to prove the value survived; a second
 * case pins that a survivor with no lifetime records `undefined`, not a crash.
 */

import type { EndpointStatus } from "@kolu/surface-daemon-supervisor";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import type { DaemonStatus } from "../vocab.ts";
import type { KavalConnectionMetadata } from "./connect.ts";
import { publishDaemonStatus, readDaemonStatus } from "./daemonStatus.ts";

type Connected = EndpointStatus<
  DaemonStatus["identity"],
  KavalConnectionMetadata
>;

function connected(lifetime?: KavalConnectionMetadata["lifetime"]): Connected {
  return {
    state: "connected",
    identity: undefined,
    startedAt: 1_000,
    metadata: { contractVersion: "5.0", lifetime, pid: 4242 },
  };
}

describe("publishDaemonStatus — mirrors metadata.lifetime onto the stored status", () => {
  afterEach(() => __resetPadiSurfaceCtxForTest());

  it("records the connected lifetime read off the connection metadata", () => {
    setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
    publishDaemonStatus("H-1", connected({ kind: "boundToPid", pid: 4242 }));
    const stored = readDaemonStatus("H-1");
    expect(stored?.state).toBe("connected");
    // Fails (undefined) if the `lifetime: status.metadata.lifetime` copy in
    // daemonStatus.ts is dropped, though the type stays green (field optional).
    expect(stored?.state === "connected" && stored.lifetime).toEqual({
      kind: "boundToPid",
      pid: 4242,
    });
  });

  it("records undefined for a survivor that reports no lifetime", () => {
    setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
    publishDaemonStatus("H-2", connected(undefined));
    const stored = readDaemonStatus("H-2");
    expect(stored?.state === "connected" && stored.lifetime).toBeUndefined();
  });
});
