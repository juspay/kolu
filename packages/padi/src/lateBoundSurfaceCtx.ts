import type { SurfaceSpec } from "@kolu/surface/define";
import type { SurfaceCtx } from "@kolu/surface/server";

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
    if (held !== undefined && held !== ctx) {
      throw new Error(
        `${name} surface ctx set twice with different contexts — surface.ts must call this exactly once`,
      );
    }
    held = ctx;
  }

  function resetForTest(): void {
    held = undefined;
  }

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
