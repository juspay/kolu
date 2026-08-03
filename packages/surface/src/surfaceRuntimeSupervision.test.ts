/**
 * The supervision contract of a `SurfaceRuntime` (SRT-PR1). `implementSurface`
 * returns `{ group, handlers, ctx, done, close }`; this pins the negative
 * properties the plan names:
 *
 *   - an OWNED FAULT reaches `done` (a cell connector failing is observed,
 *     never floated as an unhandled rejection);
 *   - `close()` is idempotent (calling it twice is harmless);
 *   - `close()` releases every owned source — it INTERRUPTS each connector,
 *     which runs the finalizers its scope holds;
 *   - a clean `close()` resolves `done`;
 *   - a connector's own interruption is end-of-life, never a fault.
 *
 * These are the #1719 ownership doctrine applied at the runtime seam: abort
 * first, then observe the settle. What changed with the connector seam is WHO
 * sequences that: a fiber's exit already includes its finalizers, so "interrupt,
 * then await the exit" is the whole doctrine, and the framework no longer
 * hand-orders abort → settle → dispose. Cancellation is interruption; there is no
 * AbortSignal in this file any more, and no `Disposer`.
 */

import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defineSurface } from "./define";
import {
  type CellStore,
  implementSurface,
  implementSurfaces,
  inMemoryStore,
  superviseTerminalSource,
} from "./server";

const oneCell = defineSurface({
  cells: { c: { schema: Schema.Number, default: 0 } },
});

const twoCells = defineSurface({
  cells: {
    a: { schema: Schema.Number, default: 0 },
    b: { schema: Schema.Number, default: 0 },
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
          connect: () =>
            Effect.fail(new Error("connector boom")),
        },
      },
    });
    await expect(runtime.done).rejects.toThrow("connector boom");
  });

  it("close() interrupts the connector and runs the finalizers its scope holds", async () => {
    const store: CellStore<number> = inMemoryStore(0);
    let installed = false;
    let disposed = false;
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store,
          connect: () =>
            Effect.asVoid(
              Effect.acquireRelease(
                Effect.sync(() => {
                  installed = true;
                }),
                () =>
                  Effect.sync(() => {
                    disposed = true;
                  }),
              ),
            ),
        },
      },
    });
    // The connector's acquire ran on the CONSTRUCTING stack — the property the
    // reactor's synchronous publish rests on — and its release has not.
    expect(installed).toBe(true);
    expect(disposed).toBe(false);

    await runtime.close();
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
          connect: () =>
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                disposeCount += 1;
              }),
            ),
        },
      },
    });
    await runtime.close();
    await runtime.close();
    await runtime.close();
    expect(disposeCount).toBe(1);
    await expect(runtime.done).resolves.toBeUndefined();
  });

  it("a connector parked on abortable work ends CLEANLY on close(), never as a fault", async () => {
    const store: CellStore<number> = inMemoryStore(0);
    let readAborted = false;
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store,
          // The idiomatic Promise-shaped shape (`await fetch({ signal })`, the
          // reactor's poll `read`): park on abortable work, driven by the FIBER's
          // own interruption signal. The whole "was that rejection our own
          // teardown?" question is gone — an interrupted fiber cannot masquerade
          // as a failure, so there is nothing to classify and nothing to swallow.
          connect: () =>
            Effect.tryPromise({
              try: (signal) =>
                new Promise<void>((_resolve, reject) => {
                  signal.addEventListener(
                    "abort",
                    () => {
                      readAborted = true;
                      reject(signal.reason);
                    },
                    { once: true },
                  );
                }),
              catch: (err) => err,
            }),
        },
      },
    });
    await tick();
    await runtime.close();
    expect(readAborted).toBe(true);
    await expect(runtime.done).resolves.toBeUndefined();
  });

  it("a connector-less surface resolves done on close", async () => {
    const store: CellStore<number> = inMemoryStore(0);
    const runtime = implementSurface(oneCell, { cells: { c: { store } } });
    await runtime.close();
    await expect(runtime.done).resolves.toBeUndefined();
  });

  it("a SYNC finalizer throw is an owned teardown fault that reaches done", async () => {
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store: inMemoryStore(0),
          connect: () =>
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                throw new Error("sync dispose boom");
              }),
            ),
        },
      },
    });
    await tick();
    // close() ALWAYS resolves (never throws), and the finalizer's defect is
    // routed to done — it rides the same fiber exit the connector's own failure
    // would, which is why one await observes both.
    await expect(runtime.close()).resolves.toBeUndefined();
    await expect(runtime.done).rejects.toThrow("sync dispose boom");
  });

  it("an ASYNC finalizer rejection is an owned teardown fault that reaches done", async () => {
    const runtime = implementSurface(oneCell, {
      cells: {
        c: {
          store: inMemoryStore(0),
          connect: () =>
            Effect.addFinalizer(() =>
              Effect.promise(async () => {
                await Promise.resolve();
                throw new Error("async dispose boom");
              }),
            ),
        },
      },
    });
    await tick();
    await expect(runtime.close()).resolves.toBeUndefined();
    await expect(runtime.done).rejects.toThrow("async dispose boom");
  });

  it("close() releases an independent source even while a sibling connector refuses cancellation", async () => {
    let bDisposed = false;
    const runtime = implementSurface(twoCells, {
      cells: {
        // `a` never settles and refuses interruption — the misbehaving source.
        // (Refusing takes an explicit `uninterruptible`: under the connector seam
        // "ignores cancellation" is no longer something a connector can drift
        // into, only something it can declare.)
        a: {
          store: inMemoryStore(0),
          connect: () =>
            Effect.uninterruptible(Effect.promise(() => new Promise<void>(() => {}))),
        },
        // `b` settles immediately and registers a finalizer.
        b: {
          store: inMemoryStore(0),
          connect: () =>
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                bDisposed = true;
              }),
            ),
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

  it("a connector that throws while BUILDING its effect faults done, never implementSurface", async () => {
    // A badly-behaved consumer connector — it throws on the way to returning an
    // Effect, not inside one. Building the connector INSIDE the fiber
    // (`Effect.suspend`) is what keeps that a fault on the source's own exit
    // rather than a throw out of `implementSurface` that would orphan every
    // connector already started in the same pass.
    let bStarted = false;
    const runtime = implementSurface(twoCells, {
      cells: {
        a: {
          store: inMemoryStore(0),
          connect: () => {
            throw new Error("builder boom");
          },
        },
        b: {
          store: inMemoryStore(0),
          connect: () =>
            Effect.sync(() => {
              bStarted = true;
            }),
        },
      },
    });
    // `b` still started — `a`'s throw stayed inside `a`'s fiber.
    expect(bStarted).toBe(true);
    await expect(runtime.done).rejects.toThrow("builder boom");
    await runtime.close();
  });

  it("transactional construction: an invalid LATER cell never starts an earlier connector (singular)", () => {
    let started = false;
    expect(() =>
      implementSurface(twoCells, {
        cells: {
          a: {
            store: inMemoryStore(0),
            connect: () =>
              Effect.sync(() => {
                started = true;
              }),
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
              connect: () =>
                Effect.sync(() => {
                  started = true;
                }),
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
          connect: () =>
            Effect.fail(new Error("connector boom")),
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
          connect: () =>
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                disposeCount += 1;
              }),
            ),
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

  it("superviseTerminalSource: a terminal close failure still releases the runtime and surfaces the original failure", async () => {
    const terminalFailure = new Error("terminal close boom");
    let runtimeClosed = false;
    const { close } = superviseTerminalSource(
      {
        done: new Promise<void>(() => {}),
        close: async () => {
          runtimeClosed = true;
        },
      },
      {
        done: new Promise<void>(() => {}),
        close: async () => {
          throw terminalFailure;
        },
      },
    );

    await expect(close()).rejects.toBe(terminalFailure);
    expect(runtimeClosed).toBe(true);
  });

  it("superviseTerminalSource: terminal and runtime close failures surface together", async () => {
    const terminalFailure = new Error("terminal close boom");
    const runtimeFailure = new Error("runtime close boom");
    const { close } = superviseTerminalSource(
      {
        done: new Promise<void>(() => {}),
        close: async () => {
          throw runtimeFailure;
        },
      },
      {
        done: new Promise<void>(() => {}),
        close: async () => {
          throw terminalFailure;
        },
      },
    );

    const failure = await close().catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      terminalFailure,
      runtimeFailure,
    ]);
  });

  it("MULTIPLE teardown faults during close() all surface via AggregateError, not just the first", async () => {
    const runtime = implementSurface(twoCells, {
      cells: {
        a: {
          store: inMemoryStore(0),
          connect: () =>
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                throw new Error("dispose a boom");
              }),
            ),
        },
        b: {
          store: inMemoryStore(0),
          connect: () =>
            Effect.addFinalizer(() =>
              Effect.sync(() => {
                throw new Error("dispose b boom");
              }),
            ),
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
