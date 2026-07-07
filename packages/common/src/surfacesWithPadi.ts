/**
 * The composed sibling registry: the app's `surfaces` PLUS the `padi`
 * terminal-workspace surface. This is the ONE map kolu-server serves
 * (`composeSurfaceContracts` widens the wire contract; `implementSurfaces`
 * serves the deps) and the client dials (`connectSurfaces<contract, typeof
 * surfacesWithPadi>`).
 *
 * Composing the app's registry with padi's authored surface is an APP concern,
 * so it lives here in kolu-common and imports `padiSurface` FROM `@kolu/padi`
 * (the post-flip arrow: the app consumes padi; padi never depends back on the
 * app — the seal's fifth arm enforces that). It sits in its OWN module, NOT in
 * `./surface.ts`, so the heavily-imported `kolu-common/surface` stays free of
 * the `@kolu/padi` dependency — only the two files that actually dial/serve the
 * combined map (client `wire.ts`, server `surface.ts`) reach for it.
 *
 * The padi-LESS `surfaces` (in `./surface.ts`) is what `kolu-common/contract`
 * composes and the client's own contract consumes; kolu-server extends the
 * SERVED contract with this padi-ful map locally.
 */

import { padiSurface } from "@kolu/padi/surface";
import { defineSurfaceMap, type KeyCodec } from "@kolu/surface-map";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  HostKeySchema,
} from "./hostKey.ts";
import { surfaces } from "./surface.ts";

// The key + local-host constant live in the padi-LESS `./hostKey.ts` (so
// `contract.ts` can type the `hosts.*` root RPCs without pulling `@kolu/padi`); re-export
// them here beside the map so consumers still reach them through one module.
export { type HostKey, HostKeySchema, LOCAL_HOST } from "./hostKey.ts";

export const surfacesWithPadi = {
  ...surfaces,
  padi: padiSurface,
} as const;

/** `HostKey`'s string codec, for `defineSurfaceMap` — a discriminated-sum OBJECT is
 *  not a valid collection key/channel name by itself (`@kolu/surface-map`'s wire
 *  `mapKey`, the `entries` membership collection, and every per-key channel name are
 *  all plain strings), so this pairs `encodeHostKey`/`decodeHostKey` into the codec
 *  the map bridges through. */
const hostKeyCodec: KeyCodec<HostKey> = {
  encode: encodeHostKey,
  decode: decodeHostKey,
};

/** The keyed map of padi surfaces — ONE entry surface (`padiSurface`) served N times,
 *  keyed by host. kolu-server serves it (`serveHostMap` over the warm ssh pool) and
 *  the client connects it (`connectSurfaceMap`); `padi` on the wire becomes this map's
 *  contract (the key-folded members + the `entries` membership collection). With the
 *  host env unset the map has exactly one member (the local host) — pixel-identical. */
export const padiHostMap = defineSurfaceMap(
  HostKeySchema,
  padiSurface,
  hostKeyCodec,
);
