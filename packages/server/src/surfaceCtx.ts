/**
 * Late-bound holder for the runtime surface context.
 *
 * Decouples domain modules (`session.ts`, `activity.ts`,
 * `terminalBackend/local.ts`, `terminalBackend/metadata.ts`) from
 * `surface.ts`'s declaration block. Those modules need to publish into
 * the surface (`surfaceCtx.cells.X.set(...)`, `.collections.Y.upsert(...)`,
 * `.events.Z.publish(...)`); `surface.ts` in turn imports them to wire
 * up cell stores, collection readers, and exit-channel sources. Both
 * arrows reaching across the same boundary formed six import cycles
 * (`noImportCycles` lint).
 *
 * The holder is the single arrow now: domain modules import from here,
 * `surface.ts` populates here via `setSurfaceCtx(...)` once the
 * `implementSurface(...)` block returns. `surface.ts` still depends on
 * the domain modules — but the back-arrow is gone.
 *
 * Access happens at runtime (inside function bodies); the proxy
 * forwards each property read to the populated handle. Reading before
 * `setSurfaceCtx` runs throws a clear error — that would be a
 * programmer mistake (a domain module called into the surface during
 * its own module-init), not a runtime condition to swallow.
 */

import type { SurfaceCtx } from "@kolu/surface/server";
import type { surface } from "kolu-common/surface";

type Ctx = SurfaceCtx<typeof surface.spec>;

let held: Ctx | null = null;

/** Populate the holder. Called once, from `surface.ts`. */
export function setSurfaceCtx(ctx: Ctx): void {
  held = ctx;
}

/** Typed mutation accessors — `.cells`, `.collections`, `.events`.
 *  Forwards to the populated handle on every access. */
export const surfaceCtx: Ctx = new Proxy({} as Ctx, {
  get(_, prop) {
    if (!held) {
      throw new Error(
        `surfaceCtx accessed before setSurfaceCtx ran (prop=${String(prop)}). ` +
          `A domain module is reaching into the surface during its own module init.`,
      );
    }
    return held[prop as keyof Ctx];
  },
});

/** Test-only: install a no-op surface ctx so domain unit tests that
 *  call `updateServerMetadata`, `saveSession`, etc. don't crash on the
 *  surface publish side-effect they don't care about. Previously, the
 *  old `surface.ts ↔ domain` import cycle accidentally bootstrapped a
 *  real ctx whenever a domain module loaded — those tests rode on that
 *  side-effect without naming it. Naming it here is the price of
 *  breaking the cycle. */
export function installNoopSurfaceCtxForTesting(): void {
  const noopCellLike = {
    get: () => undefined,
    set: () => {},
    patch: () => {},
  };
  const noopCollectionLike = {
    upsert: () => {},
    remove: () => {},
    snapshot: () => new Map(),
  };
  const noopEventLike = { publish: () => {} };
  held = new Proxy({} as Ctx, {
    get(_, ns) {
      if (ns === "cells") return new Proxy({}, { get: () => noopCellLike });
      if (ns === "collections")
        return new Proxy({}, { get: () => noopCollectionLike });
      if (ns === "events") return new Proxy({}, { get: () => noopEventLike });
      return undefined;
    },
  });
}
