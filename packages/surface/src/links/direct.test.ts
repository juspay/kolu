/**
 * `directDispatch` is the identity element of the link family: given a SERVED
 * surface — the `{ handlers }` record `implementSurface` returns — it builds the
 * `SurfaceDispatch` every consumer face is assembled over, but each call is a
 * direct in-process handler invocation with no wire and no serialization.
 *
 * These tests pin four things:
 *
 *   - a request/response procedure round-trips through it;
 *   - a stream round-trips through it;
 *   - the dispatch carries the DIRECT brand and NOT the half-open WIRE brand —
 *     which is precisely what lets `surfaceClient` accept it bare (its
 *     constant-`true` liveness is honest by construction, no watchdog needed);
 *   - a tag the served surface never bound CRASHES, naming the tag, instead of
 *     resolving to `undefined` and failing three frames later.
 */

import { Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "vitest";
import { buildSurfaceFace, type SurfaceFace } from "../client";
import { defineSurface } from "../define";
import {
  isDirectDispatch,
  isHalfOpenDispatch,
  type SurfaceDispatch,
} from "../link";
import { implementSurface } from "../server";
import { directDispatch } from "./direct";

const surface = defineSurface({
  streams: {
    ticks: {
      inputSchema: Schema.Struct({ n: Schema.Number }),
      outputSchema: Schema.Struct({ i: Schema.Number }),
    },
  },
  procedures: {
    math: {
      double: {
        input: Schema.Struct({ x: Schema.Number }),
        output: Schema.Struct({ y: Schema.Number }),
      },
    },
  },
});

function serve() {
  return implementSurface(surface, {
    procedures: {
      math: { double: ({ input }) => Effect.succeed({ y: input.x * 2 }) },
    },
    streams: {
      ticks: {
        source: (input) =>
          Stream.fromIterable(
            Array.from({ length: input.n }, (_, i) => ({ i })),
          ),
      },
    },
  });
}

/** Read one member ref off the face, or crash. `SurfaceFace` is deliberately
 *  STRUCTURAL (`Record<string, Record<string, unknown>>` — per-member precision
 *  lives in the Solid client's spec-derived faces), so a lookup is an index that
 *  may miss; missing is a test-wiring bug, never a value to soldier on with. */
function ref(face: SurfaceFace, member: string, verb: string): unknown {
  const bound = face.surface[member]?.[verb];
  if (bound === undefined) {
    throw new Error(`the face carries no "${member}.${verb}"`);
  }
  return bound;
}

/** The two member refs this suite calls, named once rather than re-cast at every
 *  call site. */
function buildClient(dispatch: SurfaceDispatch) {
  const face = buildSurfaceFace(surface, dispatch);
  return {
    double: ref(face, "math", "double") as (input: {
      x: number;
    }) => Effect.Effect<{ y: number }, unknown>,
    ticks: ref(face, "ticks", "get") as (input: {
      n: number;
    }) => Stream.Stream<{ i: number }>,
  };
}

describe("directDispatch — the in-process identity link", () => {
  it("round-trips a request/response procedure with no wire", async () => {
    const client = buildClient(directDispatch(serve()));
    expect(await Effect.runPromise(client.double({ x: 21 }))).toEqual({
      y: 42,
    });
  });

  it("round-trips a stream", async () => {
    const client = buildClient(directDispatch(serve()));
    const frames = await Effect.runPromise(
      Stream.runCollect(client.ticks({ n: 3 })),
    );
    expect(frames.map((ev) => ev.i)).toEqual([0, 1, 2]);
  });

  it("is branded DIRECT, and never as a half-openable wire", () => {
    const dispatch = directDispatch(serve());
    // The brand is what `surfaceClient` consults: a DIRECT dispatch has no
    // transport to half-open, so it is accepted bare; a WIRE dispatch is refused
    // unless a liveness watchdog backs it (the #1564 green-dot-over-a-dead-link
    // guard, one seam upstream of the dot).
    expect(isDirectDispatch(dispatch)).toBe(true);
    expect(isHalfOpenDispatch(dispatch)).toBe(false);
  });

  it("crashes loudly — naming the tag — when a tag was never bound", async () => {
    const dispatch = directDispatch(serve());
    // An unbound tag can only mean the face and the runtime were built from
    // DIFFERENT surfaces (`implementSurface` asserts its handler set equals its
    // group's), so both legs must die naming the tag rather than resolve to
    // `undefined`.
    await expect(
      Effect.runPromise(dispatch.unary("surface/ghost/vanish", undefined)),
    ).rejects.toThrow(/surface\/ghost\/vanish/);
    await expect(
      Effect.runPromise(
        Stream.runCollect(dispatch.stream("surface/ghost/vanish", undefined)),
      ),
    ).rejects.toThrow(/surface\/ghost\/vanish/);
  });
});
