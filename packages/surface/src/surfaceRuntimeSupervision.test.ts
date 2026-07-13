/**
 * The supervision contract of a `SurfaceRuntime` (SRT-PR1). `implementSurface`
 * returns `{ router, ctx, done, close }`; this pins the negative properties the
 * plan names:
 *
 *   - an OWNED FAULT reaches `done` (a cell connector rejecting is observed,
 *     never floated as an unhandled rejection);
 *   - `close()` is idempotent (calling it twice is harmless);
 *   - `close()` releases every owned source — it ABORTS each connector (the
 *     connector's signal fires) and runs the disposer it returned;
 *   - a clean `close()` resolves `done`;
 *   - a connector receives an abort signal.
 *
 * These are the #1719 ownership doctrine applied at the runtime seam: abort
 * first, then observe the settle — no unowned async work escapes supervision.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineSurface } from "./define";
import {
  type CellStore,
  type Disposer,
  implementSurface,
  inMemoryStore,
} from "./server";

const oneCell = defineSurface({
  cells: { c: { schema: z.number(), default: 0 } },
});

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

describe("SurfaceRuntime supervision — done / close", () => {
  it("an owned cell-connector fault reaches done (never floats)", async () => {
    const store: CellStore<number> = inMemoryStore(0);
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store,
          connect: async () => {
            throw new Error("connector boom");
          },
        },
      },
    });
    await expect(runtime.done).rejects.toThrow("connector boom");
  });

  it("close() aborts the connector's signal and runs its disposer", async () => {
    const store: CellStore<number> = inMemoryStore(0);
    let sawSignal: AbortSignal | undefined;
    let disposed = false;
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store,
          connect: (_cell, { signal }): Disposer => {
            sawSignal = signal;
            return () => {
              disposed = true;
            };
          },
        },
      },
    });
    // The connector ran and received a live (not-yet-aborted) signal.
    await tick();
    expect(sawSignal).toBeInstanceOf(AbortSignal);
    expect(sawSignal?.aborted).toBe(false);
    expect(disposed).toBe(false);

    await runtime.close();
    expect(sawSignal?.aborted).toBe(true);
    expect(disposed).toBe(true);
    // A clean teardown resolves done.
    await expect(runtime.done).resolves.toBeUndefined();
  });

  it("close() is idempotent — repeated close is harmless", async () => {
    const store: CellStore<number> = inMemoryStore(0);
    let disposeCount = 0;
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store,
          connect: (): Disposer => () => {
            disposeCount += 1;
          },
        },
      },
    });
    await runtime.close();
    await runtime.close();
    await runtime.close();
    expect(disposeCount).toBe(1);
    await expect(runtime.done).resolves.toBeUndefined();
  });

  it("a connector-less surface resolves done on close", async () => {
    const store: CellStore<number> = inMemoryStore(0);
    const runtime = implementSurface(oneCell, { cells: { c: { store } } });
    await runtime.close();
    await expect(runtime.done).resolves.toBeUndefined();
  });
});
