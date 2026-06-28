/**
 * Generic late-bound holder for a typed surface mutation ctx — the ONE concept
 * that `surfaceCtx.ts` (the `kolu` surface) and `workspaceSurfaceCtx.ts` (the
 * `terminalWorkspace` surface) each instantiate. With kolu serving three surfaces
 * (kolu, surfaceApp, terminalWorkspace), the holder pattern would otherwise be
 * hand-copied per sibling; this factory keeps the concept count flat as more
 * siblings are served.
 *
 * `surface.ts` builds each surface's ctx at startup and registers it EXACTLY ONCE
 * via the returned `set`, right after `implementSurfaces(...)` returns. Domain
 * modules — `activity.ts`, `session.ts`, `terminalEndpoint/local.ts`,
 * `terminalEndpoint/metadata.ts` — import the returned `proxy` from the per-surface
 * holder module (not from `surface.ts`), so the bidirectional edge that would form
 * between `surface.ts` and every domain module collapses to a one-way arrow
 * (`surface.ts → domain`) plus a one-way registration (`surface.ts → holder`).
 *
 * Without this holder, biome's `noImportCycles` flags every domain module's ctx
 * import, and the production Node ESM loader can land on an import order where
 * `surface.ts`'s top-level `localTerminalEndpoint` reference runs while that
 * binding is still in TDZ — production crashes that vite-node's evaluation order
 * does not reproduce in unit tests (#1005). The `proxy` throws on access before
 * `set` has been called, so a top-level access surfaces at startup rather than
 * yielding `undefined` and crashing later.
 */

import type { SurfaceSpec } from "@kolu/surface/define";
import type { SurfaceCtx } from "@kolu/surface/server";

/** Build a late-bound holder for the surface named `name` (used only in the
 *  guard/Proxy error strings). Returns the throwing `proxy`, the one-time `set`,
 *  and two test seams (`resetForTest` to clear the held ctx between tests,
 *  `noopForTest` to supply a side-effect-free ctx). */
export function createLateBoundSurfaceCtx<S extends SurfaceSpec>(
  name: string,
): {
  proxy: SurfaceCtx<S>;
  set: (ctx: SurfaceCtx<S>) => void;
  resetForTest: () => void;
  noopForTest: () => SurfaceCtx<S>;
} {
  type Ctx = SurfaceCtx<S>;

  let held: Ctx | undefined;

  function set(ctx: Ctx): void {
    // Process singleton — `surface.ts` calls this exactly once at startup.
    // Throwing on a *different* ctx (not on any second call) keeps the invariant
    // honest while tolerating an accidental same-ctx re-registration.
    if (held !== undefined && held !== ctx) {
      throw new Error(
        `${name} surface ctx set twice with different contexts — surface.ts must call this exactly once`,
      );
    }
    held = ctx;
  }

  /** Reset the held ctx to `undefined`. Only for unit tests that supply a fresh
   *  mock ctx per test without hitting the double-call guard. */
  function resetForTest(): void {
    held = undefined;
  }

  /** A no-op ctx for unit tests that touch this surface's publish path but don't
   *  care about the side-effects. Cast via `unknown` because the full spec-typed
   *  Ctx would require listing every cell/collection/event; the cast is localised
   *  here so callers stay readable. */
  function noopForTest(): Ctx {
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

  const proxy: Ctx = new Proxy({} as Ctx, {
    get(_, prop) {
      if (!held) {
        throw new Error(
          `${name} surface ctx accessed before surface.ts initialized it (.${String(prop)})`,
        );
      }
      return Reflect.get(held, prop);
    },
  });

  return { proxy, set, resetForTest, noopForTest };
}
