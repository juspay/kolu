/**
 * The publish middle-hop for the Kaval-lifetime mirror (F6): `publishDaemonStatus`
 * folds the endpoint's `metadata.lifetime` onto the CONNECTED `DaemonStatus` it
 * records + publishes (`daemonStatus.ts` → the connected arm's `lifetime`). Both
 * the metadata field and the status field are optional (a survivor predating the
 * field carries none), so deleting that copy still type-checks — the passthrough
 * needs a behavioural pin. This drives the real publisher (with a no-op surface
 * ctx) and reads the stored status back to prove the value survived; a second
 * case pins that a survivor with no lifetime records `undefined`, not a crash.
 *
 * The last two cases pin the half the reads cannot see — the WIRE BYTES. Both
 * `metadata.lifetime` and `DaemonStatus.lifetime` are `Schema.optionalKey`, and
 * `optionalKey` rejects a present-`undefined` key where zod's `.optional()` took
 * either (#17). Since every `daemonStatus` push encodes the stored value, "no
 * lifetime" has to be spelled as an ABSENT key or the whole collection push dies.
 */

import type { EndpointStatus } from "@kolu/surface-daemon-supervisor";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { DaemonStatusSchema, type DaemonStatus } from "../vocab.ts";
import type { KavalConnectionMetadata } from "./connect.ts";
import { unreachableDispatch } from "./dispatch.testlib.ts";
import { publishDaemonStatus, readDaemonStatus } from "./daemonStatus.ts";

type Connected = EndpointStatus<
  DaemonStatus["identity"],
  KavalConnectionMetadata
>;

function connected(lifetime?: KavalConnectionMetadata["lifetime"]): Connected {
  return {
    state: "connected",
    // A real endpoint's identity is TOTAL (`projectKavalIdentity` falls back to
    // `UNKNOWN_KAVAL_IDENTITY`), so the fixture carries one — a present-but-
    // `undefined` `identity` here would be a shape production cannot reach, and
    // it would mask the `lifetime` assertion below behind its own encode failure.
    identity: { staleKey: "k", navigableCommit: "c" },
    startedAt: 1_000,
    metadata: {
      contractVersion: "5.0",
      // SPREAD, mirroring `connectKaval` (#17): the connection metadata is what
      // a survivor kaval's `system.version` decoded to, and that field is an
      // `optionalKey` — so "no lifetime" reaches this publisher as an ABSENT key.
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

  // The half a `toBeUndefined()` cannot see, and the half the wire cares about:
  // `lifetime` is `Schema.optionalKey` on `DaemonStatusSchema`, so a survivor
  // that reports none must leave the key ABSENT, not present-with-`undefined`.
  // Every `daemonStatus` push ENCODES the stored value, and `optionalKey`
  // rejects a present `undefined` where zod's `.optional()` took either — so the
  // pre-fix `lifetime: status.metadata.lifetime` copy killed the whole collection
  // push (blank KAVAL column, no DegradedCanvas) against any kaval predating the
  // field. Falsify by restoring that plain copy: this fails with the production
  // string, `Expected { readonly kind: "forever" } | … , got undefined`.
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
