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
import { mirroredSurface } from "@kolu/surface-nix-host/connection";
import { surfaces } from "./surface.ts";

// The padi sibling the client dials is the MIRRORED surface — `padiSurface` plus
// the framework `connection` cell kolu-server's re-serve already adds (W2.1). It
// declares `liveWhen: state === "connected"`, so a bound host's readiness (server↔
// padi connected-ness) folds into `padi.health().live` BY CONSTRUCTION, per
// binding — the per-host readiness signal the W4 switch reads (the shared,
// single-host `padiLink` cell it replaces could never carry N hosts). The server
// splices this exact `WithConnection<padiSurface>` router off each host's re-serve,
// so client and server specs match; a single-host tab is byte-identical (the cell
// just reads `connected`).
export const surfacesWithPadi = {
  ...surfaces,
  padi: mirroredSurface(padiSurface),
} as const;
