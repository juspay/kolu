/**
 * Late-bound holder for the `kolu` surface's typed mutation ctx — one instance of
 * the shared `createLateBoundSurfaceCtx` factory (the sibling
 * `workspaceSurfaceCtx.ts` holds the `terminalWorkspace` ctx). See that factory
 * module for the cycle-break + TDZ-safe-Proxy rationale (#1005).
 *
 * `surface.ts` calls `setSurfaceCtx(implementSurfaces(...).ctx.kolu)` once at
 * startup. Domain modules mutate only kolu's OWN primitives (preferences,
 * activityFeed, session, terminalList, authored, terminalExit) — surface-app's
 * buildInfo/identity live on the sibling `surfaceApp` surface and are driven by the
 * runtime (the buildInfo cell's `.connect`), not by domain code — so this holder is
 * typed against the `kolu` surface ctx.
 */

import type { koluSurface } from "kolu-common/surface";
import { createLateBoundSurfaceCtx } from "./lateBoundSurfaceCtx.ts";

export const {
  proxy: surfaceCtx,
  set: setSurfaceCtx,
  resetForTest: __resetSurfaceCtxForTest,
  noopForTest: noopSurfaceCtxForTest,
} = createLateBoundSurfaceCtx<(typeof koluSurface)["spec"]>("kolu");
