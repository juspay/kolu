/**
 * The fine `connection` word is an OPTIONAL KEY, in bytes (#17 audit).
 *
 * `entryStatusSchema` spells the SR9 connection payload `Schema.optionalKey`, which
 * accepts an ABSENT key and REJECTS a present-`undefined` one — where the zod
 * original (`.optional()`) took either, and where TypeScript objects to neither
 * (`exactOptionalPropertyTypes` is not set). Both of this package's producers hold a
 * genuinely optional value:
 *
 *   - the SERVER's `projectStatus` takes `connection?: Conn` — a registry entry's
 *     `connection?` is optional by declaration, so reading it yields `undefined`
 *     whenever the domain has no fine word for that frame;
 *   - the CLIENT's `floorOnLiveness` DEMOTES a status over a dead link, dropping the
 *     stale word.
 *
 * Each used to spell the key outright, which would have made the published entry
 * un-encodable the moment a map that declares a `connection` schema met a frame
 * without one. The pins below therefore run the REAL encode
 * (`map.entriesSpec.schema`) rather than `toEqual`, which cannot tell a present
 * `undefined` from an absent key — the precise blind spot the #17 audit exists for.
 *
 * The second half of the audit has since been settled by SHAPE rather than by care: the
 * client's demoted value now lands on the `unobservable` arm, which has no `connection`
 * field and no wire schema, so it cannot spell the key wrongly and cannot be republished
 * at all. Those pins now assert exactly that, and only the SERVER half still turns on the
 * absent-vs-undefined distinction.
 */

import { defineSurface } from "@kolu/surface/define";
import { directDispatch } from "@kolu/surface/links/direct";
import { implementSurface } from "@kolu/surface/server";
import { runStreamScoped } from "@kolu/surface/solid";
import { Schema, type Stream } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { floorOnLiveness } from "./client";
import { defineSurfaceMap, type EntryStatus } from "./define";
import {
  connected,
  HostKeySchema,
  identityCodec,
  makeRegistry,
  settle,
  type TestFailure,
} from "./mapHarness.testlib";
import { serveSurfaceMap } from "./server";
import { testMembershipId } from "./testing";

/** A fine connection word — the shape padi's real `ConnectionInfoSchema` stands in
 *  for here: a map that DECLARES one is the only configuration where the key exists
 *  on the union at all, and therefore the only one where a present-`undefined` can
 *  be rejected rather than silently dropped as an excess key. */
const ConnSchema = Schema.Struct({ phase: Schema.String });

const testFailureSchema = Schema.Struct({
  cause: Schema.String,
  reason: Schema.String,
});

/** An entry surface with no members worth exercising — this file is about the
 *  MEMBERSHIP status, not the entry's own wire. */
const emptyEntry = defineSurface({});

function mapWithConnection() {
  return defineSurfaceMap({
    key: HostKeySchema,
    entry: emptyEntry,
    codec: identityCodec,
    failure: testFailureSchema as unknown as typeof testFailureSchema,
    connection: ConnSchema,
  });
}

describe("a session-backed entry that carries NO fine connection", () => {
  it("publishes the status with the key ABSENT, so it ENCODES", async () => {
    // The registry's `EntrySession.connection` is optional, and this harness's
    // registry never sets it — the exact shape a domain map hits whenever its
    // projector has no word for the frame. Falsify by restoring `connection,` in
    // `projectStatus`: the encode throws `Expected { readonly phase: string }, got
    // undefined at ["connection"]`.
    const map = mapWithConnection();
    const reg = makeRegistry();
    const served = serveSurfaceMap(
      map as never,
      reg.registry as never,
    ) as ReturnType<typeof serveSurfaceMap>;
    const dispatch = directDispatch(served);
    reg.addSession(
      identityCodec.decode("a"),
      directDispatch(implementSurface(emptyEntry, {})),
      connected(0),
    );

    const emits: EntryStatus<TestFailure, { phase: string }>[] = [];
    await createRoot(async (dispose) => {
      const stop = runStreamScoped(
        dispatch.stream("surface/entries/get", { key: "a" }) as Stream.Stream<
          EntryStatus<TestFailure, { phase: string }>,
          unknown
        >,
        { onFrame: (s) => emits.push(s), onEnd: () => {}, onFailure: () => {} },
      );
      await settle();
      stop();
      dispose();
    });

    const status = emits.at(-1);
    expect(status?.kind).toBe("connected");
    expect(status && Object.hasOwn(status, "connection")).toBe(false);
    // The gate the `toEqual` above cannot see: the published value must survive the
    // encode every wire subscribe runs it through.
    expect(() =>
      Schema.encodeUnknownSync(map.entriesSpec.schema as never)(status),
    ).not.toThrow();

    served.dispose();
  });
});

describe("floorOnLiveness's demotion leaves the published union entirely", () => {
  const schema = mapWithConnection().entriesSpec.schema as never;
  const encodes = (v: unknown) =>
    JSON.stringify(Schema.encodeUnknownSync(schema)(v));

  // REWRITTEN, deliberately, and STRONGER than what it replaces. These two used to pin
  // that a demoted value spelled its missing `connection` as an ABSENT key rather than a
  // present-`undefined`, so that a floored value reaching an encode (a mirror, a relay)
  // would not throw. The floored value now leaves the published union for `unobservable`,
  // an arm with no `connection` field to spell either way — so the old pins have nothing
  // left to distinguish, and the property that MATTERS flipped: a client-local projection
  // of OUR transport must never be republishable at all. That is what is pinned instead.
  it("a demoted `connected` keeps neither clockOffset nor connection — and is UNENCODABLE", () => {
    const floored = floorOnLiveness(
      {
        kind: "connected",
        membershipId: testMembershipId("m1"),
        clockOffset: 42,
        connection: { phase: "connected" },
      },
      false,
    );
    expect(floored).toEqual({
      kind: "unobservable",
      membershipId: testMembershipId("m1"),
      published: "connected",
    });
    expect(Object.hasOwn(floored, "connection")).toBe(false);
    expect(Object.hasOwn(floored, "clockOffset")).toBe(false);
    expect(() => encodes(floored)).toThrow();
  });

  it("a demoted `warming` leaves the union the SAME way its sibling arm does", () => {
    const floored = floorOnLiveness(
      {
        kind: "warming",
        membershipId: testMembershipId("m1"),
        connection: { phase: "provisioning" },
      },
      false,
    );
    expect(floored).toEqual({
      kind: "unobservable",
      membershipId: testMembershipId("m1"),
      published: "warming",
    });
    expect(Object.hasOwn(floored, "connection")).toBe(false);
    expect(() => encodes(floored)).toThrow();
  });

  it("a LIVE link still carries the word through to the bytes", () => {
    const kept = floorOnLiveness(
      {
        kind: "warming",
        membershipId: testMembershipId("m1"),
        connection: { phase: "provisioning" },
      },
      true,
    );
    expect(encodes(kept)).toContain('"connection":{"phase":"provisioning"}');
  });
});
