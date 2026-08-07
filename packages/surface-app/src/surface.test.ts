/**
 * `surfaceAppSurface` — the standalone surface (buildInfo cell + identity probe),
 * and the BYTE format of the probe frames.
 *
 * The contract assertions moved to the tag axis: a surface carries a flat
 * `RpcGroup` now (PLAN D1), so "the probe lives in this surface's OWN `identity`
 * namespace" is a statement about the tags the group minted, not about a nested
 * router shape. The byte fixtures are the #17/W3 obligation for a WIRE format:
 * this probe rides the app handshake, so its encoded JSON must not move when the
 * schema library does.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ServerProbeInputSchema,
  ServerProbeSchema,
  surfaceAppSurface,
  surfaceAppSurfaceWith,
} from "./surface";

describe("surfaceAppSurface — a standalone surface", () => {
  it("carries the buildInfo cell + the identity.info probe under its own surface", () => {
    // It's a built Surface: spec + group, not a mergeable fragment.
    expect(Object.keys(surfaceAppSurface.spec.cells ?? {})).toEqual([
      "buildInfo",
    ]);
    expect(surfaceAppSurface.spec.procedures?.identity?.info).toBeDefined();
    // The probe lives in the surface's OWN `identity` namespace, so a consumer
    // registering it under key `surfaceApp` gets `surface/surfaceApp/identity/info`
    // (the sibling prefix is spliced by `composeSurfaceContracts`).
    const tags = [...surfaceAppSurface.group.requests.keys()].sort();
    expect(tags).toEqual([
      "surface/buildInfo/get",
      "surface/identity/info",
      "surface/system/clockNow",
      "surface/system/identity",
      "surface/system/live",
    ]);
  });

  it("exposes the buildInfo cell read-only (get, no set)", () => {
    expect(surfaceAppSurface.spec.cells?.buildInfo.verbs).toEqual(["get"]);
    // Route-set identity, not just the declaration: no `set` tag was minted.
    expect(surfaceAppSurface.group.requests.has("surface/buildInfo/set")).toBe(
      false,
    );
  });

  it("supports an extended buildInfo def via surfaceAppSurfaceWith", () => {
    const surface = surfaceAppSurfaceWith({
      cells: {
        buildInfo: {
          schema: Schema.Struct({
            commit: Schema.String,
            bootId: Schema.String,
          }),
          default: { commit: "", bootId: "" },
          verbs: ["get"] as const,
        },
      },
      isStale: () => false,
    });
    expect(surface.spec.cells?.buildInfo.default).toEqual({
      commit: "",
      bootId: "",
    });
    expect(surface.spec.procedures?.identity?.info).toBeDefined();
  });
});

describe("ServerProbeSchema — the probe's WIRE bytes", () => {
  // Byte-level fixtures (PLAN W3 / #17): this probe is the restart axis of the
  // stale-tab handshake, so a client and a server of different builds must agree
  // on the exact JSON. Decode-equality alone would not catch a `processId` that
  // started encoding as `null`-tolerant, or an input that started riding as
  // `null` instead of `{}`.
  it('encodes the probe result as {"processId":"…"}', () => {
    const encoded = Schema.encodeUnknownSync(ServerProbeSchema)({
      processId: "p1",
    });
    expect(JSON.stringify(encoded)).toBe('{"processId":"p1"}');
  });

  it("encodes the probe input as the empty object `{}` (never `null`)", () => {
    const encoded = Schema.encodeUnknownSync(ServerProbeInputSchema)({});
    expect(JSON.stringify(encoded)).toBe("{}");
  });

  it("decodes a server frame back to the domain value", () => {
    expect(
      Schema.decodeUnknownSync(ServerProbeSchema)(
        JSON.parse('{"processId":"p1"}'),
      ),
    ).toEqual({ processId: "p1" });
  });

  it("REJECTS a frame with no processId (the field is required, not optional)", () => {
    expect(() => Schema.decodeUnknownSync(ServerProbeSchema)({})).toThrow();
  });
});
