import {
  type DaemonStatus,
  DaemonStatusSchema,
} from "@kolu/padi-client/surface";
import type { EndpointStatus } from "@kolu/surface-daemon-supervisor";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import type { KavalConnectionMetadata } from "./connect.ts";
import { publishDaemonStatus, readDaemonStatus } from "./daemonStatus.ts";
import { unreachableDispatch } from "./dispatch.testlib.ts";

type Connected = EndpointStatus<
  DaemonStatus["identity"],
  KavalConnectionMetadata
>;

function connected(lifetime?: KavalConnectionMetadata["lifetime"]): Connected {
  return {
    state: "connected",
    identity: { staleKey: "k", navigableCommit: "c" },
    startedAt: 1_000,
    metadata: {
      contractVersion: "5.0",
      ...(lifetime !== undefined && { lifetime }),
      pid: 4242,
      dispatch: unreachableDispatch,
    },
  };
}

describe("publishDaemonStatus — mirrors metadata.lifetime onto the stored status", () => {
  afterEach(() => __resetPadiSurfaceCtxForTest());

  it("records the connected lifetime read off the connection metadata", () => {
    setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
    publishDaemonStatus("H-1", connected({ kind: "boundToPid", pid: 4242 }));
    const stored = readDaemonStatus("H-1");
    expect(stored?.state).toBe("connected");
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

  it("leaves the KEY ABSENT — the stored status must ENCODE on the wire", () => {
    setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
    publishDaemonStatus("H-3", connected(undefined));
    const stored = readDaemonStatus("H-3");
    expect(stored && Object.hasOwn(stored, "lifetime")).toBe(false);
    expect(
      JSON.stringify(Schema.encodeUnknownSync(DaemonStatusSchema)(stored)),
    ).toBe(
      '{"state":"connected","identity":{"staleKey":"k","navigableCommit":"c"},"contractVersion":"5.0","startedAt":1000}',
    );
  });

  it("a reported lifetime still reaches the wire bytes", () => {
    setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
    publishDaemonStatus("H-4", connected({ kind: "forever" }));
    expect(
      JSON.stringify(
        Schema.encodeUnknownSync(DaemonStatusSchema)(readDaemonStatus("H-4")),
      ),
    ).toContain('"lifetime":{"kind":"forever"}');
  });
});
