/**
 * The shared tagged-error vocabulary (`./errors`, D4).
 *
 * The one property that justifies these living in ONE module rather than in the
 * package that raises each: a framework error must survive
 * **serialize → deserialize → re-serialize** at a re-serving parent with its
 * identity (`_tag`) and its data intact. A per-package copy would decode as a
 * foreign shape at the middle hop and flatten into an opaque defect three
 * processes away from where anyone could diagnose it.
 *
 * The typed predicates are pinned alongside, because they are what every retry
 * fence and relay branch actually calls: a dead transport must never be retried,
 * and the relay's transient loss must always be.
 */

import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  isDeadTransportError,
  isSurfaceError,
  messageOf,
  isSurfaceRelayTransportLost,
  isSurfaceStdioTransportClosed,
  isSurfaceTransportRetired,
  MapEntryFailed,
  MapKeyNonCanonical,
  MapKeyUnknown,
  SurfaceErrorSchema,
  SurfaceRelayTransportLost,
  SurfaceStdioTransportClosed,
  SurfaceTransportRetired,
} from "./errors";

const encode = Schema.encodeUnknownSync(SurfaceErrorSchema);
const decode = Schema.decodeUnknownSync(SurfaceErrorSchema);

const SAMPLES = [
  new SurfaceTransportRetired({ reason: "stale tab (close code 4001)" }),
  // The `death`-bearing spellings of the two dead-transport tags. They are
  // SAMPLES rather than a bespoke round-trip test of their own, because this
  // list's loops already assert more than one could: constructor identity, tag,
  // message, byte-stable re-encode, and every predicate's verdict surviving the
  // wire.
  new SurfaceTransportRetired({
    reason: "the server closed this socket with code 4001",
    death: "retiredByServer",
  }),
  new SurfaceStdioTransportClosed({ reason: "agent exited" }),
  new SurfaceStdioTransportClosed({
    reason: "padi on myhost: the peer stopped answering the keep-alive ping",
    death: "keepAliveUnanswered",
  }),
  new SurfaceRelayTransportLost({ reason: "upstream padi died mid-stream" }),
  new MapKeyNonCanonical({ wireKey: "Host1", canonicalKey: "host1" }),
  new MapKeyUnknown({ mapKey: "host9" }),
  new MapEntryFailed({ mapKey: "host2", failure: '{"kind":"unreachable"}' }),
];

describe("surface error vocabulary", () => {
  it("every member is a real Error with a readable message", () => {
    for (const e of SAMPLES) {
      expect(e).toBeInstanceOf(Error);
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it("carries the tag as the wire discriminant", () => {
    expect(SAMPLES.map((e) => e._tag)).toEqual([
      "SurfaceTransportRetired",
      "SurfaceTransportRetired",
      "SurfaceStdioTransportClosed",
      "SurfaceStdioTransportClosed",
      "SurfaceRelayTransportLost",
      "MapKeyNonCanonical",
      "MapKeyUnknown",
      "MapEntryFailed",
    ]);
  });

  it("encodes to the tag plus its declared data, and nothing else", () => {
    expect(
      JSON.stringify(encode(new SurfaceRelayTransportLost({ reason: "gone" }))),
    ).toBe('{"_tag":"SurfaceRelayTransportLost","reason":"gone"}');
    expect(
      JSON.stringify(
        encode(new MapKeyNonCanonical({ wireKey: "A", canonicalKey: "a" })),
      ),
    ).toBe('{"_tag":"MapKeyNonCanonical","wireKey":"A","canonicalKey":"a"}');
  });

  it("survives the relay hop — serialize, deserialize, re-serialize", () => {
    for (const original of SAMPLES) {
      const wire = JSON.stringify(encode(original));
      const rehydrated = decode(JSON.parse(wire));
      // Identity is preserved: the same class, the same tag, the same message.
      expect(rehydrated.constructor).toBe(original.constructor);
      expect(rehydrated._tag).toBe(original._tag);
      expect((rehydrated as Error).message).toBe(original.message);
      // And a second hop re-encodes to the SAME bytes, so a chain of relays
      // cannot drift the payload one hop at a time.
      expect(JSON.stringify(encode(rehydrated))).toBe(wire);
    }
  });

  it("refuses a foreign tag rather than silently decoding it", () => {
    expect(() => decode({ _tag: "SomeAppError", reason: "nope" })).toThrow();
  });

  it("decodes a pre-`death` payload from a version-skewed peer", () => {
    // The one property `death` had to be an OPTIONAL key for. This tag crosses a
    // re-serve relay hop, and the peer on the far side of that hop may be a
    // build from before the field existed — it encodes `{_tag, reason}` and
    // nothing more. A NEW consumer decoding that payload must not fail; it must
    // read "the producer did not classify", which is the truth about it.
    const preUpgrade = {
      _tag: "SurfaceStdioTransportClosed",
      reason: "padi respawning",
    };
    const decoded = decode(preUpgrade);
    expect(isSurfaceStdioTransportClosed(decoded)).toBe(true);
    expect((decoded as SurfaceStdioTransportClosed).death).toBeUndefined();
    // And it re-encodes to the SAME bytes — the relay hop does not invent a
    // classification on the payload's way back out.
    expect(JSON.stringify(encode(decoded))).toBe(JSON.stringify(preUpgrade));
  });

  it("refuses a `death` value outside the closed set", () => {
    // The field is a discriminant, not free text: an unknown arm is a decode
    // failure, never a fourth meaning smuggled in as a string.
    expect(() =>
      decode({
        _tag: "SurfaceStdioTransportClosed",
        reason: "x",
        death: "peerOnFire",
      }),
    ).toThrow();
  });
});

describe("surface error predicates", () => {
  it("isSurfaceError recognises every member and nothing else", () => {
    for (const e of SAMPLES) expect(isSurfaceError(e)).toBe(true);
    expect(isSurfaceError(new Error("boom"))).toBe(false);
    expect(isSurfaceError({ _tag: "SurfaceTransportRetired" })).toBe(false);
    expect(isSurfaceError(undefined)).toBe(false);
  });

  it("isDeadTransportError spans exactly the two PERMANENTLY dead transports", () => {
    expect(SAMPLES.filter(isDeadTransportError).map((e) => e._tag)).toEqual([
      "SurfaceTransportRetired",
      "SurfaceTransportRetired",
      "SurfaceStdioTransportClosed",
      "SurfaceStdioTransportClosed",
    ]);
  });

  it("its union is UNIFORMLY branchable — both arms declare `death`", () => {
    // The property the field's symmetry buys: a consumer that has narrowed with
    // `isDeadTransportError` reads the discriminant directly, with no second
    // per-tag guard. A union where only one arm declared `death` would not
    // COMPILE here, which is the whole assertion — the values below are just
    // what proves it also runs.
    const deaths = SAMPLES.filter(isDeadTransportError).map((e) => e.death);
    expect(deaths).toEqual([
      undefined,
      "retiredByServer",
      undefined,
      "keepAliveUnanswered",
    ]);
  });

  it("the retryable relay loss is NOT a dead transport", () => {
    // The whole retry fence rests on this split: a dead transport must never be
    // retried (retrying re-presents the same corpse — the reconnect storm), and
    // the relay's transient loss must always be (the parent will heal it).
    const lost = new SurfaceRelayTransportLost({ reason: "x" });
    expect(isDeadTransportError(lost)).toBe(false);
    expect(isSurfaceRelayTransportLost(lost)).toBe(true);
  });

  it("the narrow predicates match their one tag only", () => {
    const retired = new SurfaceTransportRetired({ reason: "x" });
    const stdio = new SurfaceStdioTransportClosed({ reason: "x" });
    expect(isSurfaceTransportRetired(retired)).toBe(true);
    expect(isSurfaceTransportRetired(stdio)).toBe(false);
    expect(isSurfaceStdioTransportClosed(stdio)).toBe(true);
    expect(isSurfaceStdioTransportClosed(retired)).toBe(false);
  });

  it("recognition survives the wire — a rehydrated error still narrows", () => {
    // A predicate that only worked on a locally-constructed instance would be
    // useless: every call site that matters sees a value that came off a socket.
    for (const original of SAMPLES) {
      const rehydrated = decode(JSON.parse(JSON.stringify(encode(original))));
      expect(isSurfaceError(rehydrated)).toBe(true);
      expect(isDeadTransportError(rehydrated)).toBe(
        isDeadTransportError(original),
      );
      expect(isSurfaceRelayTransportLost(rehydrated)).toBe(
        isSurfaceRelayTransportLost(original),
      );
    }
  });
});

/**
 * `messageOf` — what an ARBITRARY failure says.
 *
 * Not one of the declared errors above, and pinned for the opposite reason: it
 * is the fallback every projecting face folds an UNdeclared failure through, so
 * the sentence a user reads on a dropped socket, a rejected dial, a bespoke
 * handler's throw and a run-edge defect all come out of this one function. The
 * three cases below are exactly the three `e instanceof Error ? e.message :
 * String(e)` gets wrong, which is why this function exists at all.
 */
describe("messageOf", () => {
  it("prefers a tagged error's _tag over its empty message", () => {
    // A `Data.TaggedError`'s `message` is `""` and its identity lives in `_tag`.
    // The obvious spelling reaches the user as a bare prefix and nothing else.
    class Refused extends Schema.TaggedError<Refused>(
      "@kolu/surface/test/Refused",
    )("Refused", { pid: Schema.Number }) {}
    expect(messageOf(new Refused({ pid: 7 }))).toBe("Refused");
    // A message, where there is one, still wins.
    expect(messageOf(new Error("the socket went away"))).toBe(
      "the socket went away",
    );
    // No message and no tag: the class name is the most specific thing left.
    expect(messageOf(new RangeError())).toBe("RangeError");
  });

  it("names a plain-object failure by its JSON, never [object Object]", () => {
    // A failure DECLARED as a plain object is not an `Error` at all, and
    // `String(e)` renders it `[object Object]` — the exact loss this replaces.
    expect(messageOf({ code: "E", detail: "no such node" })).toBe(
      '{"code":"E","detail":"no such node"}',
    );
    expect(messageOf("plain")).toBe("plain");
    expect(messageOf(undefined)).toBe("undefined");
  });

  it("keeps an unstringifiable value's own reason beside its shape", () => {
    // `JSON.stringify` EVALUATES every own enumerable getter, so a property that
    // throws throws from here — carrying a real and unrelated reason. Discarding
    // it would swallow the most specific thing known about the failure inside
    // the one function whose whole job is to find that.
    const thrower = {
      id: 1,
      get detail(): string {
        throw new Error("network timeout while computing detail");
      },
    };
    const said = messageOf(thrower);
    expect(said).toContain("id, detail");
    expect(said).toContain("network timeout while computing detail");
    // A cycle cannot travel either, but the SHAPE still can.
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(messageOf(cyclic)).toContain("Object { a, self }");
  });
});
