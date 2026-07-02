/**
 * Late-bound holder for the `terminalWorkspace` surface's typed mutation ctx — one
 * instance of the shared `createLateBoundSurfaceCtx` factory (the sibling
 * `surfaceCtx.ts` holds the `kolu` ctx). See that factory module for the
 * cycle-break + TDZ-safe-Proxy rationale (#1005).
 *
 * `surface.ts` calls `setWorkspaceSurfaceCtx(implementSurfaces(...).ctx.terminalWorkspace)`
 * once at startup. The sink in `terminalEndpoint/metadata.ts` imports
 * `workspaceSurfaceCtx` from here to publish into the `awareness` collection, so it
 * never forms a bidirectional import edge with `surface.ts`.
 */

import type { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";
import { createLateBoundSurfaceCtx } from "./lateBoundSurfaceCtx.ts";

export const {
  proxy: workspaceSurfaceCtx,
  set: setWorkspaceSurfaceCtx,
  resetForTest: __resetWorkspaceSurfaceCtxForTest,
  noopForTest: noopWorkspaceSurfaceCtxForTest,
} = createLateBoundSurfaceCtx<(typeof terminalWorkspaceSurface)["spec"]>(
  "terminalWorkspace",
);
