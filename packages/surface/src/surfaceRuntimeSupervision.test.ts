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
  implementSurfaces,
  inMemoryStore,
  superviseTerminalSource,
} from "./server";

const oneCell = defineSurface({
  cells: { c: { schema: z.number(), default: 0 } },
});

const twoCells = defineSurface({
  cells: {
    a: { schema: z.number(), default: 0 },
    b: { schema: z.number(), default: 0 },
  },
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

  it("a connector rejecting with the abort reason on close() is a CLEAN cancellation, not a fault", async () => {
    const store: CellStore<number> = inMemoryStore(0);
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store,
          // The idiomatic signal-respecting shape (`await fetch({ signal })`,
          // the package's own Channel.subscribe): park on abortable work and
          // reject with the signal's reason when close() aborts.
          connect: (_cell, { signal }) =>
            new Promise<void>((_resolve, reject) => {
              signal.addEventListener("abort", () => reject(signal.reason), {
                once: true,
              });
            }),
        },
      },
    });
    await tick();
    await runtime.close();
    // The abort-caused rejection is swallowed (isAbortReason) — the framework
    // aborted the signal itself, so its cooperative rejection is teardown noise,
    // not an owned fault. A clean close resolves done (#1719).
    await expect(runtime.done).resolves.toBeUndefined();
  });

  it("a connector-less surface resolves done on close", async () => {
    const store: CellStore<number> = inMemoryStore(0);
    const runtime = implementSurface(oneCell, { cells: { c: { store } } });
    await runtime.close();
    await expect(runtime.done).resolves.toBeUndefined();
  });

  it("a SYNC disposer rejection is an owned teardown fault that reaches done", async () => {
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store: inMemoryStore(0),
          connect: (): Disposer => () => {
            throw new Error("sync dispose boom");
          },
        },
      },
    });
    await tick();
    // close() ALWAYS resolves (never throws), and the disposer fault is routed to done.
    await expect(runtime.close()).resolves.toBeUndefined();
    await expect(runtime.done).rejects.toThrow("sync dispose boom");
  });

  it("an ASYNC disposer rejection is an owned teardown fault that reaches done", async () => {
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store: inMemoryStore(0),
          connect: (): Disposer => async () => {
            await Promise.resolve();
            throw new Error("async dispose boom");
          },
        },
      },
    });
    await tick();
    await expect(runtime.close()).resolves.toBeUndefined();
    await expect(runtime.done).rejects.toThrow("async dispose boom");
  });

  it("close() releases an independent source even while a sibling connector ignores cancellation", async () => {
    let bDisposed = false;
    const runtime = implementSurface(twoCells, {
      cells: {
        // `a` never settles and never respects abort — the misbehaving source.
        a: {
          store: inMemoryStore(0),
          connect: () => new Promise<void>(() => {}),
        },
        // `b` settles immediately and returns a disposer.
        b: {
          store: inMemoryStore(0),
          connect: (): Disposer => () => {
            bDisposed = true;
          },
        },
      },
    });
    await tick();
    // Do NOT await close() — `a` parks forever, so the whole close never resolves.
    // But `b`'s teardown must run INDEPENDENTLY, not behind a global barrier that
    // `a` holds shut.
    void runtime.close();
    await tick();
    await tick();
    expect(bDisposed).toBe(true);
  });

  it("transactional construction: an invalid LATER cell never starts an earlier connector (singular)", () => {
    let started = false;
    expect(() =>
      implementSurface(twoCells, {
        cells: {
          a: {
            store: inMemoryStore(0),
            connect: () => {
              started = true;
            },
          },
          // `b`'s deps are MISSING → the walk throws AFTER `a` was collected but
          // BEFORE any connector was started.
          // biome-ignore lint/suspicious/noExplicitAny: deliberately omitting a required dep to exercise the fail-fast walk.
        } as any,
      }),
    ).toThrow(/missing deps for cell "b"/);
    expect(started).toBe(false);
  });

  it("transactional construction: an invalid sibling never starts an earlier sibling's connector (plural)", () => {
    let started = false;
    expect(() =>
      implementSurfaces({ one: oneCell, two: oneCell }, {}, {
        one: {
          cells: {
            c: {
              store: inMemoryStore(0),
              connect: () => {
                started = true;
              },
            },
          },
        },
        // `two`'s deps are MISSING → the loop throws after `one` was walked.
        // biome-ignore lint/suspicious/noExplicitAny: deliberately omitting a sibling's deps to exercise the fail-fast walk.
      } as any),
    ).toThrow(/missing deps for surface "two"/);
    expect(started).toBe(false);
  });

  it("superviseTerminalSource: a terminal source ending on its own resolves the composite done (SR5)", async () => {
    const runtime = implementSurface(oneCell, {
      cells: { c: { store: inMemoryStore(0) } },
    });
    const { done } = superviseTerminalSource(runtime, {
      done: Promise.resolve(), // the pump ended (session destroyed)
      close: async () => {},
    });
    await expect(done).resolves.toBeUndefined();
    await runtime.close();
  });

  it("superviseTerminalSource: a terminal source fault rejects the composite done (SR5)", async () => {
    const runtime = implementSurface(oneCell, {
      cells: { c: { store: inMemoryStore(0) } },
    });
    const { done, close } = superviseTerminalSource(runtime, {
      done: Promise.reject(new Error("pump boom")),
      close: async () => {},
    });
    await expect(done).rejects.toThrow("pump boom");
    await close();
  });

  it("superviseTerminalSource: an owned runtime fault faults the composite before close (SR5)", async () => {
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store: inMemoryStore(0),
          connect: async () => {
            throw new Error("connector boom");
          },
        },
      },
    });
    // Terminal parks forever — only the runtime's owned fault can settle `done`.
    const { done } = superviseTerminalSource(runtime, {
      done: new Promise<void>(() => {}),
      close: async () => {},
    });
    await expect(done).rejects.toThrow("connector boom");
  });

  it("superviseTerminalSource: close aborts the terminal FIRST, then releases the runtime; idempotent (SR5)", async () => {
    let terminalAborted = false;
    let disposeCount = 0;
    let resolveTerminal!: () => void;
    const terminalDone = new Promise<void>((r) => {
      resolveTerminal = r;
    });
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store: inMemoryStore(0),
          connect: (): Disposer => () => {
            disposeCount += 1;
          },
        },
      },
    });
    await tick();
    const { done, close } = superviseTerminalSource(runtime, {
      done: terminalDone,
      // The pump's atomic teardown verb: the real pump's per-key pumps settle on
      // signal.reason; model that: close aborts AND awaits the terminal settle.
      close: async () => {
        terminalAborted = true;
        resolveTerminal();
        await terminalDone;
      },
    });
    await close();
    expect(terminalAborted).toBe(true);
    expect(disposeCount).toBe(1); // the runtime was released after the terminal settled
    await close();
    await close();
    expect(disposeCount).toBe(1); // idempotent
    await expect(done).resolves.toBeUndefined();
  });

  it("MULTIPLE teardown faults during close() all surface via AggregateError, not just the first", async () => {
    const runtime = implementSurface(twoCells, {
      cells: {
        a: {
          store: inMemoryStore(0),
          connect: (): Disposer => () => {
            throw new Error("dispose a boom");
          },
        },
        b: {
          store: inMemoryStore(0),
          connect: (): Disposer => () => {
            throw new Error("dispose b boom");
          },
        },
      },
    });
    await tick();
    await runtime.close();
    // Both disposers fault on close — done rejects with an AggregateError that
    // carries BOTH reasons, so a second broken disposer is diagnosable, never
    // silently dropped for losing the first-fault race.
    const err = await runtime.done.then(
      () => undefined,
      (e) => e,
    );
    expect(err).toBeInstanceOf(AggregateError);
    const msgs = (err as AggregateError).errors
      .map((e) => (e as Error).message)
      .sort();
    expect(msgs).toEqual(["dispose a boom", "dispose b boom"]);
  });
});
