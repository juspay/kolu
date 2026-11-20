import { RpcClientError } from "effect/rpc/RpcClientError";
import { SocketReadError } from "effect/socket/Socket";
import { Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeReattachingStream } from "./reattachingStream";

const toastSpy = { error: vi.fn() };
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: (...a: unknown[]) => toastSpy.error(...a),
    warning: () => {},
    info: () => {},
  }),
}));

function streamThat<T>(
  items: T[],
  failWith?: unknown,
): Stream.Stream<T, unknown> {
  const emitted: Stream.Stream<T, unknown> = Stream.fromIterable(items);
  return failWith === undefined
    ? emitted
    : Stream.concat(emitted, Stream.fail(failWith));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function start(
  ...args: Parameters<typeof consumeReattachingStream<string>>
): Fiber.Fiber<void, never> {
  return Effect.runFork(consumeReattachingStream(...args).pipe(Effect.orDie));
}

const tile = (exited = false) => ({ hasExited: () => exited });

describe("consumeReattachingStream", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    toastSpy.error.mockReset();
  });

  it("abnormal end → re-attaches and re-subscribes with fresh items", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const items: string[] = [];
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(streamThat(["stale"], new Error("padi died")))
      .mockReturnValueOnce(streamThat(["fresh-snapshot", "live"]));

    start(
      streamFn,
      (item) => {
        items.push(item);
      },
      onReattach,
      "test",
      tile(),
    );

    await new Promise((r) => setTimeout(r, 350));
    for (let i = 0; i < 10; i++) await flush();

    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(items).toEqual(["stale", "fresh-snapshot", "live"]);
  });

  it("graceful end + the tile KNOWS the PTY exited → does NOT loop or re-attach", async () => {
    const items: string[] = [];
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat(["a", "b"]));

    start(
      streamFn,
      (item) => {
        items.push(item);
      },
      onReattach,
      "test",
      tile(true),
    );

    for (let i = 0; i < 10; i++) await flush();

    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(onReattach).not.toHaveBeenCalled();
    expect(items).toEqual(["a", "b"]);
  });

  it("clean end while the terminal is still LIVE → one re-attach through onReattach", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const items: string[] = [];
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(streamThat(["stale"]))
      .mockReturnValueOnce(
        Stream.concat(streamThat(["fresh-snapshot", "live"]), Stream.never),
      );

    start(
      streamFn,
      (item) => {
        items.push(item);
      },
      onReattach,
      "test",
      tile(),
    );

    await new Promise((r) => setTimeout(r, 800));
    for (let i = 0; i < 10; i++) await flush();

    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(items).toEqual(["stale", "fresh-snapshot", "live"]);
  });

  it("the exit facts landing DURING the settle window cancel the re-attach", async () => {
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat(["a"]));
    let exited = false;

    start(streamFn, () => {}, onReattach, "test", {
      hasExited: () => exited,
    });

    await new Promise((r) => setTimeout(r, 50));
    exited = true;
    await new Promise((r) => setTimeout(r, 600));

    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(onReattach).not.toHaveBeenCalled();
  });

  it("a re-attach answered `TerminalNotFound` ENDS the loop — no storm", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(streamThat(["last"]))
      .mockReturnValue(
        streamThat<string>([], { _tag: "TerminalNotFound", id: "t1" }),
      );

    start(streamFn, () => {}, onReattach, "test", tile());

    await new Promise((r) => setTimeout(r, 1200));
    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("a SECOND clean end while live is LOUD, and the loop persists (kolu#2101 K1)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat(["snapshot"]));

    const alive = await onVirtualClock(
      [streamFn, () => undefined, onReattach, "test", tile()],
      (fiber) =>
        Effect.gen(function* () {
          for (let i = 0; i < 20; i++) yield* advance(600);
          expect(err).not.toHaveBeenCalled();
          expect(toastSpy.error).not.toHaveBeenCalled();
          expect(streamFn.mock.calls.length).toBeGreaterThan(2);
          return fiber.pollUnsafe() === undefined;
        }),
    );

    expect(alive).toBe(true);
    expect(onReattach.mock.calls.length).toBeGreaterThan(1);
  });

  it("clean ends with NO frame at all spend the budget and speak, without dying", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat<string>([]));

    const alive = await onVirtualClock(
      [streamFn, () => undefined, vi.fn(), "test", tile()],
      (fiber) =>
        Effect.gen(function* () {
          yield* advance(600);
          expect(err).not.toHaveBeenCalled();
          yield* advance(600);
          expect(err).toHaveBeenCalledTimes(1);
          expect(toastSpy.error).toHaveBeenCalledTimes(1);
          return fiber.pollUnsafe() === undefined;
        }),
    );

    expect(alive).toBe(true);
  });

  it("a THROW from the frame handler still DIES loud — not retried", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(Stream.concat(streamThat(["boom"]), Stream.never));

    const fiber = Effect.runFork(
      consumeReattachingStream(
        streamFn,
        () => {
          throw new Error("attach opened without a measured grid");
        },
        onReattach,
        "test",
        tile(),
      ),
    );
    const exit = await Effect.runPromise(Fiber.await(fiber));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(onReattach).not.toHaveBeenCalled();
  });

  it("a THROW from the thunk still DIES loud — not retried", async () => {
    const onReattach = vi.fn();
    const streamFn = vi.fn<() => Stream.Stream<string, unknown>>(() => {
      throw new Error("terminal t1: attach opened without a measured grid");
    });

    const fiber = Effect.runFork(
      consumeReattachingStream(
        streamFn,
        () => undefined,
        onReattach,
        "t",
        tile(),
      ),
    );
    const exit = await Effect.runPromise(Fiber.await(fiber));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(onReattach).not.toHaveBeenCalled();
  });

  it("a throwing onReattach does NOT cost the re-attach — the promise holds", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onReattach = vi.fn(() => {
      throw new Error("xterm: terminal has been disposed");
    });
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(streamThat<string>([], new Error("padi died")))
      .mockReturnValue(Stream.concat(streamThat(["fresh"]), Stream.never));

    const fiber = start(streamFn, () => undefined, onReattach, "test", tile());

    await new Promise((r) => setTimeout(r, 500));
    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(err).toHaveBeenCalledTimes(1);
    expect(fiber.pollUnsafe()).toBe(undefined);
    fiber.interruptUnsafe();
  });

  it("interrupt mid-stream → the loop stops silently, no re-attach", async () => {
    const items: string[] = [];
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(Stream.concat(streamThat(["a"]), Stream.never));

    const fiber = start(
      streamFn,
      (item) => {
        items.push(item);
      },
      onReattach,
      "test",
      tile(),
    );

    for (let i = 0; i < 5; i++) await flush();
    expect(items).toEqual(["a"]);

    fiber.interruptUnsafe();
    for (let i = 0; i < 10; i++) await flush();

    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(onReattach).not.toHaveBeenCalled();
  });

  it("interrupting during the BACKOFF stops the loop — the sleep is interruptible", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat<string>([], new Error("padi died")));

    const fiber = start(streamFn, () => {}, onReattach, "test", tile());

    await new Promise((r) => setTimeout(r, 50));
    expect(streamFn).toHaveBeenCalledTimes(1);
    fiber.interruptUnsafe();

    await new Promise((r) => setTimeout(r, 350));
    expect(streamFn).toHaveBeenCalledTimes(1);
  });

  it("waits ~300ms between a failed attempt and the re-subscribe (backoff)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(streamThat<string>([], new Error("padi died")))
      .mockReturnValueOnce(streamThat(["fresh"]));

    start(streamFn, () => {}, onReattach, "test", tile());

    await new Promise((r) => setTimeout(r, 50));
    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(streamFn).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 350));
    expect(streamFn).toHaveBeenCalledTimes(2);
  });

  const drain = Effect.forEach(
    [1, 2, 3, 4, 5, 6, 7, 8],
    () => Effect.yieldNow,
    {
      discard: true,
    },
  );

  function onVirtualClock<A>(
    args: Parameters<typeof consumeReattachingStream<string>>,
    body: (
      fiber: Fiber.Fiber<Exit.Exit<void, unknown>, never>,
    ) => Effect.Effect<A, never, never>,
  ): Promise<A> {
    return Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.exit(consumeReattachingStream(...args)),
        );
        yield* drain;
        const out = yield* body(fiber);
        yield* Fiber.interrupt(fiber);
        return out;
      }).pipe(Effect.provide(TestClock.layer())),
    );
  }

  const advance = (ms: number) =>
    TestClock.adjust(ms).pipe(Effect.flatMap(() => drain));

  it("(i) a stream that OPENS and never yields → one re-attach at the deadline, then the loud verdict", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(Stream.never);

    const alive = await onVirtualClock(
      [streamFn, () => undefined, onReattach, "test", tile()],
      (fiber) =>
        Effect.gen(function* () {
          yield* advance(44_999);
          expect(streamFn).toHaveBeenCalledTimes(1);
          expect(onReattach).not.toHaveBeenCalled();

          yield* advance(1);
          expect(onReattach).toHaveBeenCalledTimes(1);
          expect(String(warn.mock.calls[0]?.[0])).toContain("re-attaching");
          expect(streamFn).toHaveBeenCalledTimes(1);
          yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(2);

          yield* advance(45_000);
          expect(err).toHaveBeenCalledTimes(1);
          expect(String(err.mock.calls[0]?.[0])).toContain("opened silent 2");
          expect(streamFn).toHaveBeenCalledTimes(2);
          return fiber.pollUnsafe() === undefined;
        }),
    );

    expect(alive).toBe(true);
    expect(toastSpy.error).toHaveBeenCalledTimes(1);
  });

  it("(ii) a healthy-but-IDLE stream is never touched — the deadline is FIRST-frame only", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(Stream.concat(streamThat(["snapshot"]), Stream.never));

    const alive = await onVirtualClock(
      [streamFn, () => undefined, onReattach, "test", tile()],
      (fiber) =>
        Effect.gen(function* () {
          yield* advance(6 * 60 * 60 * 1_000);
          return fiber.pollUnsafe() === undefined;
        }),
    );

    expect(alive).toBe(true);
    expect(onReattach).not.toHaveBeenCalled();
    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("(iii) a first frame at 9_999ms beats the deadline — the boundary, exactly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const items: string[] = [];
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(
        Stream.concat(
          Stream.fromEffect(Effect.as(Effect.sleep(9_999), "snapshot")),
          Stream.never,
        ),
      );

    const alive = await onVirtualClock(
      [
        streamFn,
        (item) => {
          items.push(item);
          return undefined;
        },
        onReattach,
        "test",
        tile(),
      ],
      (fiber) =>
        Effect.gen(function* () {
          yield* advance(9_999);
          expect(items).toEqual(["snapshot"]);
          yield* advance(1);
          yield* advance(60 * 60 * 1_000);
          return fiber.pollUnsafe() === undefined;
        }),
    );

    expect(alive).toBe(true);
    expect(onReattach).not.toHaveBeenCalled();
    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  const slowFirstFrame = (ms: number) =>
    Stream.concat(
      Stream.fromEffect(Effect.as(Effect.sleep(ms), "snapshot")),
      Stream.never,
    );

  it("(K1a) a healthy remote-shaped first frame at 25s PAINTS — the deadline is not a verdict on slow", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onReattach = vi.fn();
    const items: string[] = [];
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(slowFirstFrame(25_000));

    const alive = await onVirtualClock(
      [
        streamFn,
        (item) => {
          items.push(item);
          return undefined;
        },
        onReattach,
        "test",
        tile(),
      ],
      (fiber) =>
        Effect.gen(function* () {
          yield* advance(25_000);
          return fiber.pollUnsafe() === undefined;
        }),
    );

    expect(items).toEqual(["snapshot"]);
    expect(alive).toBe(true);
    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(onReattach).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    expect(toastSpy.error).not.toHaveBeenCalled();
  });

  it("(K1) the deadline is a CEILING: a first frame slower than it can never land — measured", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const items: string[] = [];
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(slowFirstFrame(60_000));

    await onVirtualClock(
      [
        streamFn,
        (item) => {
          items.push(item);
          return undefined;
        },
        vi.fn(),
        "test",
        tile(),
      ],
      () =>
        Effect.gen(function* () {
          yield* advance(10 * 60 * 1_000);
          return undefined;
        }),
    );

    expect(items).toEqual([]);
    expect(streamFn.mock.calls.length).toBeGreaterThan(1);
  });

  it("(K1b) a genuine park: re-attach at 45s, loud verdict at 90.3s, then a demoted cadence", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(Stream.never);

    const alive = await onVirtualClock(
      [streamFn, () => undefined, onReattach, "test", tile()],
      (fiber) =>
        Effect.gen(function* () {
          yield* advance(44_999);
          expect(onReattach).not.toHaveBeenCalled();

          yield* advance(1);
          expect(onReattach).toHaveBeenCalledTimes(1);
          expect(String(warn.mock.calls[0]?.[0])).toContain("re-attaching");
          expect(err).not.toHaveBeenCalled();
          yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(2);

          yield* advance(45_000);
          expect(err).toHaveBeenCalledTimes(1);
          expect(toastSpy.error).toHaveBeenCalledTimes(1);
          expect(fiber.pollUnsafe()).toBe(undefined);

          yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(2);
          yield* advance(30_000);
          expect(streamFn).toHaveBeenCalledTimes(3);
          return fiber.pollUnsafe() === undefined;
        }),
    );

    expect(alive).toBe(true);
  });

  it("(K1) a first frame REFILLS both budgets — max-2-then-loud holds per EPISODE", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(Stream.never)
      .mockReturnValueOnce(
        Stream.concat(
          streamThat(["snapshot"]),
          Stream.fromEffect(
            Effect.flatMap(Effect.sleep(1_000), () =>
              Effect.fail(new Error("padi died")),
            ),
          ),
        ),
      )
      .mockReturnValue(Stream.never);

    await onVirtualClock(
      [streamFn, () => undefined, vi.fn(), "test", tile()],
      () =>
        Effect.gen(function* () {
          yield* advance(45_000 + 300);
          expect(streamFn).toHaveBeenCalledTimes(2);
          yield* advance(1_000 + 300);
          expect(streamFn).toHaveBeenCalledTimes(3);

          yield* advance(45_000);
          expect(err).not.toHaveBeenCalled();
          expect(toastSpy.error).not.toHaveBeenCalled();
          yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(4);

          yield* advance(45_000);
          expect(err).toHaveBeenCalledTimes(1);
          expect(toastSpy.error).toHaveBeenCalledTimes(1);
          return undefined;
        }),
    );

    expect(warn.mock.calls.length).toBeGreaterThan(0);
  });

  it("(K1c) a heartbeat failure inside the first-frame window spends NEITHER budget", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const heartbeatFailure = () =>
      new RpcClientError({
        reason: new SocketReadError({ cause: new Error("ping timeout") }),
      });
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(
        Stream.fromEffect(
          Effect.flatMap(Effect.sleep(5_000), () =>
            Effect.fail(heartbeatFailure()),
          ),
        ),
      )
      .mockReturnValueOnce(
        Stream.fromEffect(
          Effect.flatMap(Effect.sleep(5_000), () =>
            Effect.fail(heartbeatFailure()),
          ),
        ),
      )
      .mockReturnValueOnce(Stream.never)
      .mockReturnValueOnce(streamThat<string>([]))
      .mockReturnValue(Stream.never);

    await onVirtualClock(
      [streamFn, () => undefined, vi.fn(), "test", tile()],
      () =>
        Effect.gen(function* () {
          yield* advance(5_000 + 300);
          yield* advance(5_000 + 300);
          expect(streamFn).toHaveBeenCalledTimes(3);
          expect(err).not.toHaveBeenCalled();

          yield* advance(45_000);
          expect(err).not.toHaveBeenCalled();
          expect(toastSpy.error).not.toHaveBeenCalled();
          yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(4);

          yield* advance(300);
          yield* advance(300);
          expect(err).not.toHaveBeenCalled();
          expect(streamFn).toHaveBeenCalledTimes(5);

          yield* advance(45_000);
          expect(err).toHaveBeenCalledTimes(1);
          expect(toastSpy.error).toHaveBeenCalledTimes(1);
          return undefined;
        }),
    );
  });

  it("(K3) a sustained mid-chain wedge gets a verdict at 200 fruitless cycles, then slows down", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // Every attach fails immediately: the fastest fruitless cycle there is —
    // one failure plus one 300ms backoff.
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat<string>([], new Error("mid-chain wedge")));

    const alive = await onVirtualClock(
      [streamFn, () => undefined, vi.fn(), "test", tile()],
      (fiber) =>
        Effect.gen(function* () {
          // 199 cycles: churning, console-only, nothing said to the user.
          for (let i = 0; i < 198; i++) yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(199);
          expect(err).not.toHaveBeenCalled();
          expect(toastSpy.error).not.toHaveBeenCalled();

          // The 200th — t=59_700, ~60s of unbroken fruitlessness.
          yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(200);
          expect(err).toHaveBeenCalledTimes(1);
          expect(toastSpy.error).toHaveBeenCalledTimes(1);

          // Demoted: 300ms buys nothing now, 30s buys one attempt.
          yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(200);
          yield* advance(30_000);
          expect(streamFn).toHaveBeenCalledTimes(201);
          // And said ONCE, not once per cycle.
          expect(err).toHaveBeenCalledTimes(1);
          expect(toastSpy.error).toHaveBeenCalledTimes(1);
          return fiber.pollUnsafe() === undefined;
        }),
    );

    expect(alive).toBe(true); // loud persistence, not execution
    expect(warn.mock.calls.length).toBeGreaterThan(100);
  });

  it("(K3) a two-cycle transient stays QUIET — the unbounded-by-design lane is untouched", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(streamThat<string>([], new Error("blip")))
      .mockReturnValueOnce(streamThat<string>([], new Error("blip")))
      .mockReturnValue(Stream.concat(streamThat(["snapshot"]), Stream.never));

    await onVirtualClock(
      [streamFn, () => undefined, vi.fn(), "test", tile()],
      () =>
        Effect.gen(function* () {
          yield* advance(2_000);
          return undefined;
        }),
    );

    expect(streamFn).toHaveBeenCalledTimes(3);
    expect(err).not.toHaveBeenCalled();
    expect(toastSpy.error).not.toHaveBeenCalled();
  });
});
