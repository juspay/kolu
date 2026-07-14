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

import { z } from "zod";
import type { StreamingProcedure } from "../client";
import type { CollectionDeltasMsg } from "../define";
import { defineSurface } from "../define";
import type { SurfaceClient } from "./surfaceClient";

const surface = defineSurface({
  collections: {
    // DEFAULT verbs include `keys` — `unenrolledKeys` present; no `deltas` verb, so
    // `unenrolledDeltas` absent.
    full: { keySchema: z.string(), schema: z.object({ v: z.number() }) },
    // `keys` deliberately omitted — no keys stream, so `unenrolledKeys` absent.
    keyless: {
      keySchema: z.string(),
      schema: z.object({ v: z.number() }),
      verbs: ["get"] as const,
    },
    // `deltas` declared — the batched stream exists, so `unenrolledDeltas` present.
    bulk: {
      keySchema: z.string(),
      schema: z.object({ v: z.number() }),
      verbs: ["keys", "get", "deltas"] as const,
    },
  },
});

declare const client: SurfaceClient<typeof surface.spec>;

// POSITIVE: the default collection exposes the raw keys-stream ref, typed as a
// `StreamingProcedure` over its key type.
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
  CollectionDeltasMsg<string, { v: number }>
> = client.collections.bulk.unenrolledDeltas;
void _bulk;

// NEGATIVE (SR5): a collection without the `deltas` verb must NOT type
// `unenrolledDeltas`.
// @ts-expect-error — `full` omits the `deltas` verb, so no `unenrolledDeltas`.
void client.collections.full.unenrolledDeltas;
