/**
 * R8 — late-bound holder for the COMPOSED terminal-workspace surface's mutation
 * context, the sibling of `./surfaceCtx.ts`.
 *
 * R8 composes `terminalWorkspaceSurface` as a third member of the surface
 * kolu-server serves the browser (beside `koluSurface` + `surfaceApp`). The
 * server's sensors mutate ONE internal record per terminal, then publish two
 * projections: kolu's own fields onto `koluSurface.terminalMetadata` (via
 * `surfaceCtx`) and the live `AwarenessValue` onto
 * `terminalWorkspaceSurface.awareness` (via THIS ctx). Splitting the holder in
 * two keeps each domain module importing only the ctx it writes, and keeps the
 * one-way `surface.ts → domain` arrow that breaks the #1005 cycle.
 *
 * The Proxy throws on access before `surface.ts` registers the real ctx, so a
 * stray top-level access surfaces at startup rather than yielding `undefined`.
 */

import type { SurfaceCtx } from "@kolu/surface/server";
import type { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";

type Ctx = SurfaceCtx<(typeof terminalWorkspaceSurface)["spec"]>;

let held: Ctx | undefined;

export function setWorkspaceSurfaceCtx(ctx: Ctx): void {
  if (held !== undefined && held !== ctx) {
    throw new Error(
      "setWorkspaceSurfaceCtx called twice with different contexts — surface.ts must call this exactly once",
    );
  }
  held = ctx;
}

/** Reset for unit tests that supply a fresh mock ctx per test. */
export function __resetWorkspaceSurfaceCtxForTest(): void {
  held = undefined;
}

/** A no-op ctx for unit tests that drive the metadata publish path (which, after
 *  R8, also pushes the awareness projection through this ctx) but don't care about
 *  the awareness collection's side effects. Mirrors `noopSurfaceCtxForTest`. */
export function noopWorkspaceSurfaceCtxForTest(): Ctx {
  const noop = () => {};
  const noopReadAll = () => new Map();
  const noopReadOne = () => undefined;
  return {
    cells: new Proxy({} as Ctx["cells"], {
      get: () => ({ get: noopReadOne, set: noop, patch: noop }),
    }),
    collections: new Proxy({} as Ctx["collections"], {
      get: () => ({
        upsert: noop,
        remove: noop,
        readAll: noopReadAll,
        readOne: noopReadOne,
      }),
    }),
    events: new Proxy({} as Ctx["events"], {
      get: () => ({ publish: noop }),
    }),
  } as unknown as Ctx;
}

export const workspaceSurfaceCtx: Ctx = new Proxy({} as Ctx, {
  get(_, prop) {
    if (!held) {
      throw new Error(
        `workspaceSurfaceCtx accessed before surface.ts initialized it (.${String(prop)})`,
      );
    }
    return Reflect.get(held, prop);
  },
});
