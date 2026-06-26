/**
 * Late-bound holder for the `terminalWorkspace` surface's typed mutation ctx —
 * the sibling of `./surfaceCtx.ts` (which holds the `kolu` surface's ctx).
 *
 * `surface.ts` calls `setWorkspaceSurfaceCtx(built.terminalWorkspace)` once at
 * startup, right after `implementSurfaces(...)` returns. The sink in
 * `terminalEndpoint/metadata.ts` imports `workspaceSurfaceCtx` from here to
 * publish into the `awareness` collection, so it never forms a bidirectional
 * import edge with `surface.ts` — the same cycle-break (and TDZ-safe Proxy) the
 * `kolu` ctx holder uses (#1005).
 *
 * The Proxy throws on access before `setWorkspaceSurfaceCtx` has been called, so
 * a top-level access surfaces at startup rather than yielding `undefined`.
 */

import type { SurfaceCtx } from "@kolu/surface/server";
import type { terminalWorkspaceSurface } from "@kolu/terminal-workspace/surface";

type Ctx = SurfaceCtx<(typeof terminalWorkspaceSurface)["spec"]>;

let held: Ctx | undefined;

export function setWorkspaceSurfaceCtx(ctx: Ctx): void {
  // Process singleton — `surface.ts` calls this exactly once at startup.
  // Throwing on a *different* ctx (not on any second call) keeps the invariant
  // honest while tolerating an accidental same-ctx re-registration.
  if (held !== undefined && held !== ctx) {
    throw new Error(
      "setWorkspaceSurfaceCtx called twice with different contexts — surface.ts must call this exactly once",
    );
  }
  held = ctx;
}

/** Reset the held ctx to `undefined`. Only for unit tests that supply a fresh
 *  mock ctx per test without hitting the double-call guard. */
export function __resetWorkspaceSurfaceCtxForTest(): void {
  held = undefined;
}

/** A no-op ctx for unit tests that touch `workspaceSurfaceCtx` (the awareness
 *  publish path) but don't care about surface publish side-effects. Cast via
 *  `unknown` because the full spec-typed Ctx would require listing every
 *  cell/collection; the cast is localised here so callers stay readable. */
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
