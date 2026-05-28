/**
 * Late-bound holder for the typed surface mutation context.
 *
 * `surface.ts` calls `setSurfaceCtx(built)` once at startup, right after
 * `implementSurface(...)` returns its `{ router, ctx }` pair. Domain
 * modules — `activity.ts`, `session.ts`, `terminalBackend/local.ts`,
 * `terminalBackend/metadata.ts` — import `surfaceCtx` from here instead
 * of from `surface.ts`. The bidirectional edge that used to form between
 * `surface.ts` and every domain module collapses to a one-way arrow
 * (`surface.ts → domain`) plus a one-way registration
 * (`surface.ts → surfaceCtx.ts`).
 *
 * Without this holder, biome's `noImportCycles` flags every domain
 * module's `surfaceCtx` import, and the production Node ESM loader can
 * land on an import order where `surface.ts`'s top-level
 * `getTerminalBackendFor({ kind: "local" })` runs while
 * `localTerminalBackend` is still in TDZ — production crashes that
 * vite-node's evaluation order does not reproduce in unit tests (#1005).
 *
 * The Proxy throws on access before `setSurfaceCtx` has been called.
 * If a domain module ever moves a `surfaceCtx.X` access from a function
 * body to the module top level, the throw surfaces it at startup rather
 * than yielding `undefined` and crashing later.
 */

import type { SurfaceCtx } from "@kolu/surface/server";
import type { surface } from "kolu-common/surface";

type Ctx = SurfaceCtx<(typeof surface)["spec"]>;

let held: Ctx | undefined;

export function setSurfaceCtx(ctx: Ctx): void {
  held = ctx;
}

export const surfaceCtx: Ctx = new Proxy({} as Ctx, {
  get(_, prop) {
    if (!held) {
      throw new Error(
        `surfaceCtx accessed before surface.ts initialized it (.${String(prop)})`,
      );
    }
    return Reflect.get(held, prop);
  },
});
