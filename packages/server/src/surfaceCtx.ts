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
import type { koluSurface } from "kolu-common/surface";

// Domain modules mutate only kolu's OWN primitives (preferences, activityFeed,
// session, terminalList, terminalMetadata, terminalExit) — surface-app's
// buildInfo/identity live on the sibling `surfaceApp` surface and are driven by
// the runtime (the buildInfo cell's `.connect`), not by domain code. So this
// holder is typed against the `kolu` surface ctx (`implementSurfaces(...).ctx.kolu`).
type Ctx = SurfaceCtx<(typeof koluSurface)["spec"]>;

let held: Ctx | undefined;

export function setSurfaceCtx(ctx: Ctx): void {
  // Process singleton — `surface.ts` calls this exactly once at startup.
  // Throwing on a *different* ctx (rather than on any second call) keeps
  // the invariant honest while staying tolerant of an accidental same-ctx
  // re-registration from a future test or hot-reload scenario.
  if (held !== undefined && held !== ctx) {
    throw new Error(
      "setSurfaceCtx called twice with different contexts — surface.ts must call this exactly once",
    );
  }
  held = ctx;
}

/** Reset the held ctx to `undefined`. Only for use in unit tests that
 *  need to supply a fresh mock ctx per test without hitting the
 *  double-call guard. Production code must never call this. */
export function __resetSurfaceCtxForTest(): void {
  held = undefined;
}

/** A no-op ctx for unit tests that exercise code paths touching
 *  `surfaceCtx` but don't care about surface publish side-effects
 *  (e.g. metadata publish-routing tests, session persistence tests).
 *  Cast via `unknown` because the full spec-typed Ctx would require
 *  listing every cell/collection/event; the cast is localised here
 *  so callers stay readable. */
export function noopSurfaceCtxForTest(): Ctx {
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
