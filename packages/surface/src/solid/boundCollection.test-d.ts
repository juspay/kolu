/**
 * TYPE-LEVEL pin (SRT-PR2, codex F2) — a bound collection's raw `unenrolledKeys`
 * ref is STRUCTURALLY PRESENT only when the collection declares the `keys` verb.
 *
 * `unenrolledKeys` returns the raw keys-STREAM ref for a deliberately un-enrolled
 * reach. A collection whose `verbs` omit `keys` has NO keys stream on the wire (the
 * contract router binds none — {@link CollectionVerbsOf} drops it), so exposing a
 * typed `unenrolledKeys` callable there would resolve to `undefined` at runtime. The
 * conditional in `BoundCollectionsFor` gates it on the declared verb — the collection
 * dual of `CellIsMutable` gating `.set`/`.patch`. This file fails to compile if that
 * gate regresses (either direction). `tsc --noEmit` green IS the assertion.
 */

import type { StreamingProcedure } from "../client";
import { z } from "zod";
import { defineSurface } from "../define";
import type { SurfaceClient } from "./surfaceClient";

const surface = defineSurface({
  collections: {
    // DEFAULT verbs include `keys` — `unenrolledKeys` present.
    full: { keySchema: z.string(), schema: z.object({ v: z.number() }) },
    // `keys` deliberately omitted — no keys stream, so `unenrolledKeys` absent.
    keyless: {
      keySchema: z.string(),
      schema: z.object({ v: z.number() }),
      verbs: ["get"] as const,
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
