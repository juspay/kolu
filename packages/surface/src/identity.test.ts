/**
 * The framework-reserved `system/identity` member's IDENTITY axis — the
 * per-process id, and the wire bytes that carry it.
 *
 * These fixtures moved here from `@kolu/surface-app`'s deleted `identity.info`
 * probe, along with the member itself. The reason they are byte-level (PLAN W3 /
 * #17) is unchanged and now stronger: this field is the restart axis of the
 * stale-tab handshake, so a client and a server of different builds must agree on
 * the exact JSON — a `processId` that started encoding as optional, or as `null`,
 * would silently turn every reconnect into an accepted stale tab.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  IdentityPayloadSchema,
  ServedIdentitySchema,
  serveIdentity,
  surfaceProcessId,
} from "./identity";

describe("surfaceProcessId — one identity per process", () => {
  it("is stable across reads (a nonce, not a fresh mint per caller)", () => {
    expect(surfaceProcessId()).toBe(surfaceProcessId());
    expect(surfaceProcessId().length).toBeGreaterThan(0);
  });

  it("is what `serveIdentity` stamps — on BOTH arms", () => {
    // The single-sourcing that makes the stale-tab gate honest: the id a server
    // ANSWERS with is the id `surfaceProcessId()` reports, so a gate comparing a
    // client's echoed claim against the latter is comparing against the former.
    // There is no argument through which the two could be made to differ.
    expect(serveIdentity(1, undefined)).toEqual({
      kind: "anonymous",
      startedAt: 1,
      processId: surfaceProcessId(),
    });
    const baked = {
      contractVersion: "5.0",
      buildId: "b1",
      commit: { kind: "commit" as const, sha: "abc" },
    };
    expect(serveIdentity(2, baked)).toEqual({
      kind: "identified",
      startedAt: 2,
      processId: surfaceProcessId(),
      baked,
    });
  });

  it("is DISTINCT from `startedAt` — two processes can start in one millisecond", () => {
    const a = serveIdentity(7, undefined);
    const b = serveIdentity(7, undefined);
    // Same clock reading, and the identity axis is still a separate field rather
    // than something a reader has to infer from the timestamp.
    expect(a.startedAt).toBe(b.startedAt);
    expect(a.processId).toBe(surfaceProcessId());
  });
});

describe("ServedIdentitySchema — the reserved member's WIRE bytes", () => {
  it("encodes the anonymous arm with kind, startedAt AND processId", () => {
    const encoded = Schema.encodeUnknownSync(ServedIdentitySchema)({
      kind: "anonymous",
      startedAt: 17,
      processId: "p1",
    });
    expect(JSON.stringify(encoded)).toBe(
      '{"kind":"anonymous","startedAt":17,"processId":"p1"}',
    );
  });

  it("decodes a server frame back to the domain value", () => {
    expect(
      Schema.decodeUnknownSync(ServedIdentitySchema)(
        JSON.parse('{"kind":"anonymous","startedAt":17,"processId":"p1"}'),
      ),
    ).toEqual({ kind: "anonymous", startedAt: 17, processId: "p1" });
  });

  it("REJECTS a frame with no processId (required, not optional)", () => {
    // The regression this guards: an optional `processId` decodes an old server's
    // frame to `undefined`, the client echoes nothing, and the gate goes back to
    // being dead code with no error anywhere.
    expect(() =>
      Schema.decodeUnknownSync(ServedIdentitySchema)({
        kind: "anonymous",
        startedAt: 17,
      }),
    ).toThrow();
  });

  it("encodes the probe input as the empty object `{}` (never `null`)", () => {
    expect(
      JSON.stringify(Schema.encodeUnknownSync(IdentityPayloadSchema)({})),
    ).toBe("{}");
  });
});
