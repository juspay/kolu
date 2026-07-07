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
import { defineSurfaceMap } from "@kolu/surface-map";
import { z } from "zod";
import { surfaces } from "./surface.ts";

export const surfacesWithPadi = {
  ...surfaces,
  padi: padiSurface,
} as const;

/** The branded per-host key — a padi host a tab can select. zod's `.brand()` is the
 *  SOLE producer (a raw string is a type error where a `HostKey` is expected, P4 at
 *  the typed API); the wire handler re-validates via the same schema (P5). */
export const HostKeySchema = z.string().brand("HostKey");
export type HostKey = z.infer<typeof HostKeySchema>;

/** The keyed map of padi surfaces — ONE entry surface (`padiSurface`) served N times,
 *  keyed by host. kolu-server serves it (`serveHostMap` over the warm ssh pool) and
 *  the client connects it (`connectSurfaceMap`); `padi` on the wire becomes this map's
 *  contract (the key-folded members + the `entries` membership collection). With the
 *  host env unset the map has exactly one member (the local host) — pixel-identical. */
export const padiHostMap = defineSurfaceMap(HostKeySchema, padiSurface);

/** The canonical local-host key — the pool's implicit, UNREMOVABLE default member.
 *  Value `"local"` (matching the client daemon-status `LOCAL_HOST` and padi's
 *  `LOCAL_HOST_ID`). Branded, so it is a valid `HostKey` everywhere the map is keyed. */
export const LOCAL_HOST: HostKey = HostKeySchema.parse("local");
