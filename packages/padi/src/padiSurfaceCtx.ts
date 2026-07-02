/**
 * Late-bound holder for the `padi` surface's typed mutation ctx — one instance of
 * the shared `createLateBoundSurfaceCtx` factory (the siblings `surfaceCtx.ts`
 * hold the `kolu` ctx, `workspaceSurfaceCtx.ts` the `terminalWorkspace` ctx). See
 * that factory module for the cycle-break + TDZ-safe-Proxy rationale (#1005).
 *
 * `surface.ts` calls `setPadiSurfaceCtx(implementSurfaces(...).ctx.padi)` once at
 * startup (W1.R1). The composed-terminal publish seam
 * (`terminalEndpoint/metadata.ts`) imports `padiSurfaceCtx` from here to publish
 * onto the `terminals` collection and the `urgency` cell, so it never forms a
 * bidirectional import edge with `surface.ts`.
 */

import type { padiSurface } from "./surface.ts";
import { createLateBoundSurfaceCtx } from "./lateBoundSurfaceCtx.ts";

export const {
  proxy: padiSurfaceCtx,
  set: setPadiSurfaceCtx,
  resetForTest: __resetPadiSurfaceCtxForTest,
  noopForTest: noopPadiSurfaceCtxForTest,
} = createLateBoundSurfaceCtx<(typeof padiSurface)["spec"]>("padi");
