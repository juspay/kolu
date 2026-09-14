/**
 * Late-bound holder for the `padi` surface's typed mutation ctx — one instance of
 * the shared `createLateBoundSurfaceCtx` factory. See that factory module for the
 * cycle-break + TDZ-safe-Proxy rationale (#1005).
 *
 * kolu-server's `surface.ts` calls `setPadiSurfaceCtx(implementSurfaces(...).ctx
 * .padi)` once at startup. Every padi domain writer imports `padiSurfaceCtx` from
 * here — the composed-terminal publish seam (`terminalEndpoint/metadata.ts` →
 * `terminals` collection + `urgency` cell), the exit publish (`local.ts` →
 * `terminalExit` event), the session writer (`session.ts` → `session` cell), and
 * the MRU trackers (`activity.ts` → `activityFeed` cell) — so none forms a
 * bidirectional import edge with `surface.ts`. This is padi's OWN ctx: no padi
 * module reaches back into a kolu-server-owned `koluSurface` ctx (the reverse-seal
 * invariant, `server/src/seal.test.ts`).
 */

import type { padiSurface } from "@kolu/padi-client/surface";
import { createLateBoundSurfaceCtx } from "./lateBoundSurfaceCtx.ts";

export const {
  proxy: padiSurfaceCtx,
  set: setPadiSurfaceCtx,
  resetForTest: __resetPadiSurfaceCtxForTest,
  noopForTest: noopPadiSurfaceCtxForTest,
} = createLateBoundSurfaceCtx<(typeof padiSurface)["spec"]>("padi");
