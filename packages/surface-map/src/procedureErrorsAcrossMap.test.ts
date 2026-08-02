/**
 * SK6/D4 — the INCIDENT-HOP pin: a declared procedure error minted by a handler
 * BEHIND a surface-map's keyed proxy arrives at the outer client as the SAME tagged
 * error, with its data intact, across REAL wires on BOTH hops.
 *
 * This is the exact path the field failure flattened at
 * (bug-remote-kaval-contract-skew defect A): padi's typed skew rejection crossed its
 * unix socket fine, but the map's unary forward re-encodes the leaf rejection onto a
 * SECOND wire — and before the error was DECLARED, nothing on that hop could do better
 * than an `INTERNAL_SERVER_ERROR` collapse. With the error declared on the entry
 * surface AND threaded onto the map's folded member (`foldedError`, define.ts), both
 * hops preserve the `_tag` and the payload. This test is the incident as a permanent
 * regression test.
 *
 * The undeclared-throw companion pins that the crash-loudly channel still exists: an
 * undeclared failure stays a DEFECT across both hops (D4), so the fix is the
 * DECLARATION, not a blanket rewrite of unknown errors.
 *
 * The map's OWN typed rejections (`MapKeyUnknown` / `MapEntryFailed` /
 * `MapKeyNonCanonical`, D4) are pinned here too — they ride the same declared channel
 * and must survive the same wire hop with their `_tag` and fields, which is why they
 * live in `@kolu/surface/errors` rather than in this package.
 */

import { defineSurface, surfaceTag } from "@kolu/surface/define";
import { MapEntryFailed, MapKeyUnknown } from "@kolu/surface/errors";
import { directDispatch } from "@kolu/surface/links/direct";
import { stdioLink } from "@kolu/surface/links/stdio";
import { createLoopbackPair } from "@kolu/surface/loopback";
import { serveOverStdio } from "@kolu/surface/peer-server";
import { implementSurface } from "@kolu/surface/server";
import { Cause, Effect, Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { fold } from "./envelope";
import {
  A,
  B,
  buildTestMap,
  connected,
  HostKeySchema,
  identityCodec,
  makeRegistry,
  settle,
} from "./mapHarness.testlib";
import { serveSurfaceMap } from "./server";

/** The entry surface's DECLARED domain error (SK6) — a tagged schema class, so it
 *  crosses a hop by being decoded and re-encoded rather than stringified. */
class DemoContractSkew extends Schema.TaggedErrorClass<DemoContractSkew>(
  "surface-map/test/DemoContractSkew",
)("DemoContractSkew", {
  daemonVersion: Schema.String,
  requiredVersion: Schema.String,
}) {}

const daemonSurface = defineSurface({
  procedures: {
    lifecycle: {
      recycle: {
        input: Schema.Struct({ id: Schema.String }),
        error: DemoContractSkew,
      },
      boom: {},
    },
  },
});

const RECYCLE_TAG = surfaceTag(daemonSurface.tagPrefix, "lifecycle", "recycle");
const BOOM_TAG = surfaceTag(daemonSurface.tagPrefix, "lifecycle", "boom");

/** Serve the leaf over a REAL stdio wire (hop 1 — the padi socket analogue) and hand
 *  back the wire dispatch + teardown. */
async function serveLeafOverWire() {
  const { group, handlers } = implementSurface(daemonSurface, {
    procedures: {
      lifecycle: {
        recycle: ({ input }) =>
          Effect.fail(
            new DemoContractSkew({
              daemonVersion: "5.0",
              requiredVersion: `5.2 (${input.id})`,
            }),
          ),
        // An UNDECLARED throw — the crash-loudly channel. `ProcedureSpec.error` is
        // absent, so this is a DEFECT by construction (D4), not a failure.
        boom: () => Effect.die(new Error("undeclared kaboom")),
      },
    },
  });
  const pair = createLoopbackPair();
  const serving = serveOverStdio({ group, handlers, transport: pair.server });
  const link = await stdioLink({
    group,
    read: pair.client.read,
    write: pair.client.write,
  });
  return {
    dispatch: link.dispatch,
    done: async () => {
      await link.dispose();
      pair.client.write.end();
      pair.server.write.end();
      await serving;
    },
  };
}

/** Run a unary call and hand back its `Exit`, so a DEFECT and a typed FAILURE are
 *  distinguishable (a `Promise` rejection collapses them). */
const runExit = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromiseExit(eff);

describe("a declared error crosses the map's keyed forward typed (the incident hop)", () => {
  it("arrives as the SAME tagged error with its data intact across BOTH real wires", async () => {
    const leaf = await serveLeafOverWire();
    const map = buildTestMap({
      key: HostKeySchema,
      entry: daemonSurface,
      codec: identityCodec,
    });
    const reg = makeRegistry();
    const served = serveSurfaceMap(map, reg.registry);

    // Hop 2 — the map itself over a REAL wire (the browser websocket analogue). The
    // map hands back `{ group, handlers }`, exactly what a serve path takes, so there
    // is no fragment to re-adapt against a router's route meta any more: a tag carries
    // its own route.
    const outerPair = createLoopbackPair();
    const outerServing = serveOverStdio({
      group: served.group,
      handlers: served.handlers,
      transport: outerPair.server,
    });
    const mapLink = await stdioLink({
      group: served.group,
      read: outerPair.client.read,
      write: outerPair.client.write,
    });

    reg.addSession(A, leaf.dispatch, connected(0));
    await settle();

    // Call the OUTER wire directly with the map's fold envelope (`{ mapKey, input }` —
    // envelope.ts): the browser client's `entry(key).procedures` face folds exactly
    // this, and errors pass through it untouched, so the raw dispatch call IS the
    // error-path pin (connectSurfaceMap itself refuses a bare test dispatch by design —
    // the half-open-watchdog law).
    const skew = await runExit(
      mapLink.dispatch.unary(RECYCLE_TAG, fold("a", { id: "kaval" })),
    );
    expect(Exit.isFailure(skew)).toBe(true);
    const skewError = Exit.isFailure(skew)
      ? Cause.squash(skew.cause)
      : undefined;
    expect(skewError).toBeInstanceOf(DemoContractSkew);
    expect(skewError).toMatchObject({
      _tag: "DemoContractSkew",
      daemonVersion: "5.0",
      requiredVersion: "5.2 (kaval)",
    });

    // The crash-loudly channel is untouched: an UNDECLARED failure from behind the
    // same two hops arrives as a DEFECT, never as a typed failure a caller could
    // mistake for a declared one.
    const boom = await runExit(mapLink.dispatch.unary(BOOM_TAG, fold("a", {})));
    expect(Exit.isFailure(boom)).toBe(true);
    if (Exit.isFailure(boom)) {
      expect(Cause.hasDies(boom.cause)).toBe(true);
      // …and NOT a typed failure: the declared channel stays empty, so no caller can
      // mistake an undeclared crash for a domain error it is entitled to branch on.
      expect(Cause.hasFails(boom.cause)).toBe(false);
    }

    await mapLink.dispose();
    outerPair.client.write.end();
    outerPair.server.write.end();
    await outerServing;
    await leaf.done();
    served.dispose();
  });

  it("the map's OWN rejections cross the same wire typed (D4: MapKeyUnknown / MapEntryFailed)", async () => {
    const map = buildTestMap({
      key: HostKeySchema,
      entry: daemonSurface,
      codec: identityCodec,
    });
    const reg = makeRegistry();
    const served = serveSurfaceMap(map, reg.registry);
    const pair = createLoopbackPair();
    const serving = serveOverStdio({
      group: served.group,
      handlers: served.handlers,
      transport: pair.server,
    });
    const mapLink = await stdioLink({
      group: served.group,
      read: pair.client.read,
      write: pair.client.write,
    });

    // A never-a-member key: a one-shot call cannot end gracefully, so it REJECTS
    // typed. The error is declared on the folded member, so the `_tag` and the key
    // survive the wire rather than collapsing into an opaque defect.
    const unknown = await runExit(
      mapLink.dispatch.unary(RECYCLE_TAG, fold("a", { id: "x" })),
    );
    const unknownError = Exit.isFailure(unknown)
      ? Cause.squash(unknown.cause)
      : undefined;
    expect(unknownError).toBeInstanceOf(MapKeyUnknown);
    expect(unknownError).toMatchObject({ _tag: "MapKeyUnknown", mapKey: "a" });

    // A member in a terminal FAULT state: same channel, a different tag, carrying the
    // RENDERED domain failure (the fault's own shape is app-owned and must not leak
    // into the framework's wire union).
    reg.addFault(B, { cause: "drv-missing", reason: "no drv for arch" });
    await settle();
    const failedEntry = await runExit(
      mapLink.dispatch.unary(RECYCLE_TAG, fold("b", { id: "x" })),
    );
    const failedError = Exit.isFailure(failedEntry)
      ? Cause.squash(failedEntry.cause)
      : undefined;
    expect(failedError).toBeInstanceOf(MapEntryFailed);
    expect(failedError).toMatchObject({ _tag: "MapEntryFailed", mapKey: "b" });
    expect((failedError as MapEntryFailed).failure).toContain("drv-missing");

    await mapLink.dispose();
    pair.client.write.end();
    pair.server.write.end();
    await serving;
    served.dispose();
  });
});

describe("the in-process forward preserves the same tags (no wire, same vocabulary)", () => {
  it("directDispatch over a served map raises MapKeyUnknown for an absent key", async () => {
    const map = buildTestMap({
      key: HostKeySchema,
      entry: daemonSurface,
      codec: identityCodec,
    });
    const reg = makeRegistry();
    const served = serveSurfaceMap(map, reg.registry);
    const dispatch = directDispatch(served);
    const exit = await runExit(
      dispatch.unary(RECYCLE_TAG, fold("a", { id: "x" })),
    );
    const err = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
    expect(err).toBeInstanceOf(MapKeyUnknown);
    served.dispose();
  });
});
