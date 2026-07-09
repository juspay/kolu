/**
 * The surface MAP — the `top` surface typed once, keyed by host at runtime.
 *
 * `defineSurfaceMap(keySchema, entry, codec)` folds the host key into every
 * entry-member call, so the client reaches any host's cells/collections through
 * one object (`app.entry("boxA").cells.load.use(…)`) and membership is one
 * authoritative collection. The key is a plain string (a hostname), so the
 * codec is the identity pair.
 */

import { defineSurfaceMap, type KeyCodec } from "@kolu/surface-map";
import { z } from "zod";
import { surface } from "./surface";

const HostKeySchema = z.string();

const identityCodec: KeyCodec<string> = {
  encode: (k) => k,
  decode: (s) => s,
};

export const hostMap = defineSurfaceMap(HostKeySchema, surface, identityCodec);
