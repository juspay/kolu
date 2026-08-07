/**
 * TYPE-LEVEL pin (SRT-PR2, codex F2; SR5) — a bound collection's raw un-enrolled
 * stream refs are STRUCTURALLY PRESENT only when the collection declares the matching
 * verb: `unenrolledKeys` iff `keys`, `unenrolledDeltas` iff `deltas`.
 *
 * Each returns the raw STREAM ref for a deliberately un-enrolled reach. A collection
 * whose `verbs` omit the verb has NO such stream on the wire (the contract router
 * binds none — {@link CollectionVerbsOf} drops it), so exposing a typed callable
 * there would resolve to `undefined` at runtime. The conditionals in
 * `BoundCollectionsFor` gate each on its declared verb — the collection dual of
 * `CellIsMutable` gating `.set`/`.patch`. This file fails to compile if either gate
 * regresses (either direction). `tsc --noEmit` green IS the assertion.
 */

import { Schema } from "effect";
import type { StreamingProcedure } from "../client";
import type { CollectionDeltasMsg } from "../define";
import { defineSurface } from "../define";
import type { SurfaceClient } from "./surfaceClient";

const surface = defineSurface({
  collections: {
    // DEFAULT verbs include `keys` — `unenrolledKeys` present; no `deltas` verb, so
    // `unenrolledDeltas` absent.
    full: {
      keySchema: Schema.String,
      schema: Schema.Struct({ v: Schema.Number }),
    },
    // `keys` deliberately omitted — no keys stream, so `unenrolledKeys` absent.
    keyless: {
      keySchema: Schema.String,
      schema: Schema.Struct({ v: Schema.Number }),
      verbs: ["get"] as const,
    },
    // `deltas` declared — the batched stream exists, so `unenrolledDeltas` present.
    bulk: {
      keySchema: Schema.String,
      schema: Schema.Struct({ v: Schema.Number }),
      verbs: ["keys", "get", "deltas"] as const,
    },
  },
});

declare const client: SurfaceClient<typeof surface.spec>;

// POSITIVE: the default collection exposes the raw keys-stream ref, typed as a
// `StreamingProcedure` over its key type.
//
// A collection's KEYS and VALUES stay on the DECODED side of the schema (D2/#13):
// the client HOLDS them (a key is an identity in its own key set, a value is
// merged/rendered locally), so `unenrolledKeys` yields `string[]` — the key
// schema's `Type` — not its `Encoded` side. Only a STREAM's / EVENT's / PROCEDURE's
// *input* — a pure argument the client forwards and never holds — moved to the
// encoded side.
const _full: StreamingProcedure<undefined, string[]> =
  client.collections.full.unenrolledKeys;
void _full;

// NEGATIVE: a keys-less collection must NOT type `unenrolledKeys`.
// @ts-expect-error — `keyless` omits the `keys` verb, so no `unenrolledKeys`.
void client.collections.keyless.unenrolledKeys;

// POSITIVE (SR5): a `deltas`-declaring collection exposes the raw batched
// deltas-stream ref, typed as a `StreamingProcedure` over `CollectionDeltasMsg`.
const _bulk: StreamingProcedure<
  undefined,
  CollectionDeltasMsg<string, { readonly v: number }>
> = client.collections.bulk.unenrolledDeltas;
void _bulk;

// NEGATIVE (SR5): a collection without the `deltas` verb must NOT type
// `unenrolledDeltas`.
// @ts-expect-error — `full` omits the `deltas` verb, so no `unenrolledDeltas`.
void client.collections.full.unenrolledDeltas;
