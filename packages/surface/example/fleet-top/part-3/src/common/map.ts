/**
 * The surface MAP — the `top` surface typed once, keyed by host at runtime.
 *
 * `defineSurfaceMap({ key, entry, codec, failure })` folds the host key into every
 * entry-member call, so the client reaches any host's cells/collections through
 * one object (`app.entry("boxA").cells.load.use(…)`) and membership is one
 * authoritative collection. The key is a plain string (a hostname), so the
 * codec is the identity pair. The `failure` schema validates the value a failed
 * entry publishes — a failed member cannot exist without one.
 */

import { defineSurfaceMap, type KeyCodec } from "@kolu/surface-map";
import { Schema } from "effect";
import { surface } from "./surface";

const HostKeySchema = Schema.String;

const identityCodec: KeyCodec<string> = {
  encode: (k) => k,
  decode: (s) => s,
};

/** This fleet's domain failure — a plain human `reason` (a real app narrows the
 *  cause; the framework only needs SOME schema-valid value on the failed arm). */
export const hostFailureSchema = Schema.Struct({ reason: Schema.String });
export type HostFailure = typeof hostFailureSchema.Type;

export const hostMap = defineSurfaceMap({
  key: HostKeySchema,
  entry: surface,
  codec: identityCodec,
  failure: hostFailureSchema,
});
