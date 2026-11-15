import { RpcClientError } from "effect/rpc/RpcClientError";
import { SocketReadError } from "effect/socket/Socket";
import { Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeReattachingStream } from "./reattachingStream";

/** The loud verdict's user-visible half. Same shape as `publishGrid.test.ts`'s
 *  mock — the arrow defers the `toastSpy` read past module init, so the hoisted
 *  factory is safe. */
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

/** Emit each of `items`, then either END cleanly or FAIL with `failWith`. */
function streamThat<T>(
  items: T[],
  failWith?: unknown,
): Stream.Stream<T, unknown> {
  const emitted: Stream.Stream<T, unknown> = Stream.fromIterable(items);
  return failWith === undefined
    ? emitted
    : Stream.concat(emitted, Stream.fail(failWith));
}

/** Resolve pending microtasks so the fire-and-forget fiber advances. */
const flush = () => new Promise((r) => setTimeout(r, 0));

/** Run the loop the way its one production caller does: one fiber, interrupted
 *  to stop it. The `AbortSignal` this helper used to take is gone — teardown is
 *  fiber interruption (D10/#18), and there is nothing left to thread. */
function start(
  ...args: Parameters<typeof consumeReattachingStream<string>>
): Fiber.Fiber<void, never> {
  return Effect.runFork(consumeReattachingStream(...args).pipe(Effect.orDie));
}

/** The tile fact the loop reads back on a clean end. `exited` is the PTY-exit
 *  case (a graceful end is real); the default is a LIVE terminal. */
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
    // 1st stream FAILS after its frame → abnormal mid-chain end; 2nd emits then
    // ends cleanly, stopping the loop.
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

    // Drain the loop, waiting past the real-timer 300ms backoff that sits
    // between the failed first attempt and the re-subscribe.
    await new Promise((r) => setTimeout(r, 350));
    for (let i = 0; i < 10; i++) await flush();

    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(streamFn).toHaveBeenCalledTimes(2);
    // The stale first stream's frame flowed to onItem; then the fresh
    // re-subscribe's frames flowed too — the reattach never spliced, it re-served.
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

    expect(streamFn).toHaveBeenCalledTimes(1); // clean end → no re-subscribe
    expect(onReattach).not.toHaveBeenCalled();
    expect(items).toEqual(["a", "b"]);
  });

  // ── The manufactured clean end (kolu#2101, deploy #2) ────────────────────
  //
  // The frozen panes: a kaval-side attach subscription ended with no `overflow`
  // frame while the PTY kept running, padi relayed that as a graceful end, and
  // every retry layer — which retries FAILURES only — read it as "the PTY
  // exited". Pre-fix this loop did nothing at all here (the case above), so the
  // tile waited forever for a `terminalExit` that was never coming: blank pane,
  // live title, no verdict.

  it("clean end while the terminal is still LIVE → one re-attach through onReattach", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const items: string[] = [];
    const onReattach = vi.fn();
    // 1st stream ends CLEANLY after its frame — no failure anywhere. 2nd stays
    // open, which is what a healthy re-attach looks like.
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

    // Past the exit-settle window AND the re-subscribe backoff (300 + 300).
    await new Promise((r) => setTimeout(r, 800));
    for (let i = 0; i < 10; i++) await flush();

    expect(streamFn).toHaveBeenCalledTimes(2);
    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(items).toEqual(["stale", "fresh-snapshot", "live"]);
  });

  it("the exit facts landing DURING the settle window cancel the re-attach", async () => {
    // The end frame and the exit publishes race over one socket, so a real exit
    // routinely ends the stream before the tile has been told. Learning it
    // inside the settle window must cost nothing: no reset, no RPC.
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat(["a"]));
    let exited = false;

    start(streamFn, () => {}, onReattach, "test", {
      hasExited: () => exited,
    });

    await new Promise((r) => setTimeout(r, 50)); // inside the 300ms settle
    exited = true;
    await new Promise((r) => setTimeout(r, 600)); // well past settle + backoff

    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(onReattach).not.toHaveBeenCalled();
  });

  it("a re-attach answered `TerminalNotFound` ENDS the loop — no storm", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const onReattach = vi.fn();
    // The PTY really had exited; the tile just hadn't been told. padi answers
    // the re-attach with the DECLARED `TerminalNotFound` — undeclared on a
    // stream member, so it arrives as a bare tagged value (rpc/declaredErrors).
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(streamThat(["last"]))
      .mockReturnValue(
        streamThat<string>([], { _tag: "TerminalNotFound", id: "t1" }),
      );

    start(streamFn, () => {}, onReattach, "test", tile());

    await new Promise((r) => setTimeout(r, 1200)); // room for several retries
    expect(streamFn).toHaveBeenCalledTimes(2); // re-attached ONCE, then stopped
    expect(info).toHaveBeenCalledTimes(1);
  });

  it("a SECOND clean end while live is LOUD, and the loop persists (kolu#2101 K1)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onReattach = vi.fn();
    // A chain that manufactures ends: every attach ends cleanly, the PTY never
    // exits. Note the frame — so the FIRST end refills the budgets and the
    // second end of the following episode is the one that speaks.
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat(["snapshot"]));

    const alive = await onVirtualClock(
      [streamFn, () => undefined, onReattach, "test", tile()],
      (fiber) =>
        Effect.gen(function* () {
          // Each cycle: end → 300ms exit settle → 300ms backoff. A delivered
          // frame refills, so every end is "the first of its episode" and stays
          // quiet, exactly as a chain that keeps delivering should.
          for (let i = 0; i < 20; i++) yield* advance(600);
          expect(err).not.toHaveBeenCalled();
          expect(toastSpy.error).not.toHaveBeenCalled();
          expect(streamFn.mock.calls.length).toBeGreaterThan(2);
          return fiber.pollUnsafe() === undefined;
        }),
    );

    // It used to `Effect.die` on the second end — executing a tile whose PTY was
    // demonstrably still delivering snapshots.
    expect(alive).toBe(true);
    expect(onReattach.mock.calls.length).toBeGreaterThan(1);
  });

  it("clean ends with NO frame at all spend the budget and speak, without dying", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // Nothing delivered, ever: the budget cannot refill, so the second end is
    // the verdict.
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat<string>([]));

    const alive = await onVirtualClock(
      [streamFn, () => undefined, vi.fn(), "test", tile()],
      (fiber) =>
        Effect.gen(function* () {
          yield* advance(600); // end #1: settle + backoff
          expect(err).not.toHaveBeenCalled();
          yield* advance(600); // end #2: the budget is out
          expect(err).toHaveBeenCalledTimes(1);
          expect(toastSpy.error).toHaveBeenCalledTimes(1);
          return fiber.pollUnsafe() === undefined;
        }),
    );

    expect(alive).toBe(true);
  });

  it("a THROW from the frame handler still DIES loud — not retried", async () => {
    // The negative pin. There is no refusal channel any more, so EVERY value a
    // handler can produce is a consumed frame; a breach of an invariant nothing
    // can repair still throws, and must still skip every recovery path
    // (channel 1). Same rule as the thunk's measured-grid assert.
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
    expect(streamFn).toHaveBeenCalledTimes(1); // never retried
    expect(onReattach).not.toHaveBeenCalled(); // and never reset the screen
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
    // `onReattach` is the caller's screen reset (`xterm.reset()` on a terminal
    // that may already be disposed). Run bare it is a DEFECT, so the loop would
    // die having just WIPED the pane — blank pane, live agent, the exact
    // rendering this module exists to kill — while the comment one line above it
    // promises "fired ⇒ a re-subscribe follows". Contained, the promise holds.
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
    expect(streamFn).toHaveBeenCalledTimes(2); // re-subscribed anyway
    expect(err).toHaveBeenCalledTimes(1); // and said so, loudly
    expect(fiber.pollUnsafe()).toBe(undefined); // still alive
    fiber.interruptUnsafe();
  });

  // The successor of the old "expected cleanup error" case. There is no such
  // error to classify any more: teardown is a fiber INTERRUPT, and an
  // interruption is not a failure — so an unmount can no longer be mistaken for
  // a mid-chain death by any predicate, because it never reaches the failure
  // handler at all (D10/#18).
  it("interrupt mid-stream → the loop stops silently, no re-attach", async () => {
    const items: string[] = [];
    const onReattach = vi.fn();
    // Never ends on its own: only the interrupt can stop it.
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

    expect(streamFn).toHaveBeenCalledTimes(1); // stopped, never re-subscribed
    expect(onReattach).not.toHaveBeenCalled();
  });

  it("interrupting during the BACKOFF stops the loop — the sleep is interruptible", async () => {
    // The successor of "signal already aborted → streamFn is never invoked".
    // That case tested a pre-armed abort against a hand-rolled `open()` guard;
    // the guard is gone, and what replaces it is stronger: the backoff is an
    // `Effect.sleep` inside the retry schedule, so an interrupt lands DURING it
    // and no re-subscribe ever happens. The old `clearTimeout` bookkeeping the
    // abort listener did is what this deletes.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat<string>([], new Error("padi died")));

    const fiber = start(streamFn, () => {}, onReattach, "test", tile());

    await new Promise((r) => setTimeout(r, 50)); // failed once, now sleeping
    expect(streamFn).toHaveBeenCalledTimes(1);
    fiber.interruptUnsafe();

    await new Promise((r) => setTimeout(r, 350)); // well past the backoff
    expect(streamFn).toHaveBeenCalledTimes(1); // never re-subscribed
  });

  it("waits ~300ms between a failed attempt and the re-subscribe (backoff)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValueOnce(streamThat<string>([], new Error("padi died")))
      .mockReturnValueOnce(streamThat(["fresh"]));

    start(streamFn, () => {}, onReattach, "test", tile());

    // Let the first attempt fail + onReattach fire, but DON'T yet cross the
    // backoff. Real timers, not fake ones: the attempt runs on an Effect fiber
    // whose scheduler is not the one `vi.useFakeTimers()` controls, so faking
    // time here would stall the failure that arms the backoff in the first place.
    await new Promise((r) => setTimeout(r, 50));
    expect(onReattach).toHaveBeenCalledTimes(1);
    expect(streamFn).toHaveBeenCalledTimes(1); // still inside the backoff

    // Crossing 300ms triggers the re-subscribe.
    await new Promise((r) => setTimeout(r, 350));
    expect(streamFn).toHaveBeenCalledTimes(2);
  });

  // ── The SILENT open (kolu#2101 H3) ──────────────────────────────────────
  //
  // The fourth way an attach stops being useful, and the only one with no event
  // to classify: the stream opens, the transport never fails, nothing ends, and
  // no frame ever arrives. After a laptop wake, a pane sat blank while the host
  // showed zero lines for it — the fiber simply parked on a subscription the
  // protocol had re-dialled out from under it.
  //
  // These run on Effect's own TestClock rather than real timers: the deadline is
  // ten seconds, one case asserts nothing happens over HOURS, and one is a
  // one-millisecond boundary. `vi.useFakeTimers()` cannot serve any of that —
  // the loop runs on an Effect fiber whose scheduler is not the one vitest
  // patches (the note on the backoff test above) — but a TestClock IS that
  // scheduler's clock, so `TestClock.adjust` moves exactly the sleeps under
  // test and nothing else.

  /** Let every fiber woken by an `adjust` run to its next suspension. `adjust`
   *  yields once per wakeup, which is not enough for a wake that has to travel
   *  stream → handler → race → retry schedule. */
  const drain = Effect.forEach(
    [1, 2, 3, 4, 5, 6, 7, 8],
    () => Effect.yieldNow,
    {
      discard: true,
    },
  );

  /** Drive the loop under a virtual clock. `body` receives the running fiber
   *  and moves time; whatever it returns comes back to the test. */
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

  /** Move virtual time and let everything it woke settle. */
  const advance = (ms: number) =>
    TestClock.adjust(ms).pipe(Effect.flatMap(() => drain));

  it("(i) a stream that OPENS and never yields → one re-attach at the deadline, then the loud verdict", async () => {
    // PRE-FIX (the same fixture against a `consumeReattachingStream` whose
    // attempt is not raced against the deadline) this reproduced today's blank
    // pane exactly. Measured at the deadline AND a further hour of virtual time:
    //
    //   { onReattachCalls: 0, streamFnCalls: 1, consoleWarnCalls: 0,
    //     consoleErrorCalls: 0, fiberStillParked: true }
    //
    // Nothing logged, nothing toasted, nothing retried, the fiber still parked:
    // a blank pane over a live agent, forever.
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
          // One millisecond short of the deadline: nothing has happened.
          yield* advance(44_999);
          expect(streamFn).toHaveBeenCalledTimes(1);
          expect(onReattach).not.toHaveBeenCalled();

          // The deadline fires → channel 2 → the reset, then the 300ms backoff,
          // then exactly one re-subscribe.
          yield* advance(1);
          expect(onReattach).toHaveBeenCalledTimes(1);
          expect(String(warn.mock.calls[0]?.[0])).toContain("re-attaching");
          expect(streamFn).toHaveBeenCalledTimes(1); // still inside the backoff
          yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(2);

          // The successor is silent too: the budget is spent, so the loop says
          // so — once — and drops to the demoted cadence instead of dying.
          yield* advance(45_000);
          expect(err).toHaveBeenCalledTimes(1);
          expect(String(err.mock.calls[0]?.[0])).toContain("opened silent 2");
          expect(streamFn).toHaveBeenCalledTimes(2); // demoted: 30s, not 300ms
          return fiber.pollUnsafe() === undefined;
        }),
    );

    expect(alive).toBe(true);
    expect(toastSpy.error).toHaveBeenCalledTimes(1);
  });

  it("(ii) a healthy-but-IDLE stream is never touched — the deadline is FIRST-frame only", async () => {
    // The negative that keeps the deadline honest. An idle terminal emits
    // nothing for hours and that is the healthy majority of panes; an
    // inter-frame deadline would blank every one of them.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(Stream.concat(streamThat(["snapshot"]), Stream.never));

    const alive = await onVirtualClock(
      [streamFn, () => undefined, onReattach, "test", tile()],
      (fiber) =>
        Effect.gen(function* () {
          yield* advance(6 * 60 * 60 * 1_000); // six hours of silence
          return fiber.pollUnsafe() === undefined;
        }),
    );

    expect(alive).toBe(true); // still attached, still waiting for bytes
    expect(onReattach).not.toHaveBeenCalled();
    expect(streamFn).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
  });

  it("(iii) a first frame at 9_999ms beats the deadline — the boundary, exactly", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const items: string[] = [];
    // A snapshot that takes 9_999ms to arrive — the slowest frame the deadline
    // still calls alive.
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
          // The watcher wakes at 10_000, reads the latch the frame set, and
          // parks for good.
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

  // ── The deadline must never EXECUTE a healthy pane (kolu#2101 K1) ────────
  //
  // The deadline shipped derived from TRANSPORT margins only: one fence retry
  // plus "a hop". The remote shape is browser→kolu-server→ssh→padi→kaval, plus
  // padi's own 150+300+600ms re-open ladder right after reconvergence, plus a
  // snapshot serialization that scales with scrollback and cannot be bounded at
  // all. At 10s with a budget of 1, a legitimately slow first frame was
  // executed at ~20.3s with no signposted recovery for that tile.
  //
  // The measurement that sets the constant is in the first test below: the
  // deadline's re-attach is DESTRUCTIVE. `Effect.raceFirst` interrupts the
  // loser, and interrupting the consume runs the stream's finalizers — which IS
  // the unsubscribe — so the in-flight snapshot the host is serializing is
  // abandoned and the successor starts from zero. The deadline is therefore a
  // hard CEILING on legitimate first-frame latency, not a free nudge, and it
  // has to sit above every arrival time we are willing to call alive.

  /** A first frame that takes `ms` to arrive on an otherwise HEALTHY stream —
   *  the remote shape: a big scrollback serialized over an ssh hop. */
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
    // 25s: more than 2× the old 10s deadline, and well inside what a loaded
    // remote host can honestly take (heartbeat worst case alone is ~25s).
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

    expect(items).toEqual(["snapshot"]); // it PAINTED
    expect(alive).toBe(true);
    expect(streamFn).toHaveBeenCalledTimes(1); // never re-attached
    expect(onReattach).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    expect(toastSpy.error).not.toHaveBeenCalled();
  });

  it("(K1) the deadline is a CEILING: a first frame slower than it can never land — measured", async () => {
    // The measurement behind the constant. A chain whose honest first-frame
    // time exceeds the deadline converges NEVER: every attempt is torn down at
    // the deadline and its successor restarts the serialization from zero. So
    // the deadline cannot be read as "re-attach cheaply and race the in-flight
    // snapshot" — there is no in-flight snapshot left to race.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const items: string[] = [];
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(slowFirstFrame(60_000)); // > FIRST_FRAME_DEADLINE_MS

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
          yield* advance(10 * 60 * 1_000); // ten minutes of trying
          return undefined;
        }),
    );

    expect(items).toEqual([]); // nothing ever painted
    expect(streamFn.mock.calls.length).toBeGreaterThan(1); // it kept trying
  });

  it("(K1b) a genuine park: re-attach at 45s, loud verdict at 90.3s, then a demoted cadence", async () => {
    // Falsifier (b) with its bound STATED: the H3 park fixture (a stream that
    // opens and says nothing at all) is still caught — repair attempt at 45s,
    // user-visible verdict at 90.3s — and the loop PERSISTS instead of dying.
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

          // t=45_000 — the deadline fires, channel 2, reset + backoff.
          yield* advance(1);
          expect(onReattach).toHaveBeenCalledTimes(1);
          expect(String(warn.mock.calls[0]?.[0])).toContain("re-attaching");
          expect(err).not.toHaveBeenCalled();
          yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(2);

          // t=90_300 — the second silent open. The budget is spent, so the
          // verdict is SAID (once, loudly) and the loop keeps its promise.
          yield* advance(45_000);
          expect(err).toHaveBeenCalledTimes(1);
          expect(toastSpy.error).toHaveBeenCalledTimes(1);
          expect(fiber.pollUnsafe()).toBe(undefined); // NOT executed

          // …and demoted: the next attempt is 30s away, not 300ms.
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
      // 1: silent → deadline at 45_000, budget 0→1
      .mockReturnValueOnce(Stream.never)
      // 2: PAINTS, then dies mid-chain a second later → the refill
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
      // 3 and 4: silent again — a NEW episode, so 3 must buy a re-attach
      .mockReturnValue(Stream.never);

    await onVirtualClock(
      [streamFn, () => undefined, vi.fn(), "test", tile()],
      () =>
        Effect.gen(function* () {
          yield* advance(45_000 + 300); // attempt 2 opens and paints
          expect(streamFn).toHaveBeenCalledTimes(2);
          yield* advance(1_000 + 300); // it dies; attempt 3 opens
          expect(streamFn).toHaveBeenCalledTimes(3);

          // Attempt 3's deadline. PRE-REFILL this would be the second silent
          // open of the loop and the verdict; post-refill it is the FIRST of a
          // fresh episode, so it buys a re-attach and says nothing loud.
          yield* advance(45_000);
          expect(err).not.toHaveBeenCalled();
          expect(toastSpy.error).not.toHaveBeenCalled();
          yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(4);

          // Attempt 4 is the episode's second silent open — now it is loud.
          yield* advance(45_000);
          expect(err).toHaveBeenCalledTimes(1);
          expect(toastSpy.error).toHaveBeenCalledTimes(1);
          return undefined;
        }),
    );

    expect(warn.mock.calls.length).toBeGreaterThan(0);
  });

  it("(K1c) a heartbeat failure inside the first-frame window spends NEITHER budget", async () => {
    // Stable Effect broadcasts a missed heartbeat as a channel-2 transport
    // failure. Re-subscription must not spend either first-frame budget.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const heartbeatFailure = () =>
      new RpcClientError({
        reason: new SocketReadError({ cause: new Error("ping timeout") }),
      });
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      // 1 & 2: two heartbeat failures, both INSIDE the first-frame window
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
      // 3: silent → the deadline budget's FIRST spend
      .mockReturnValueOnce(Stream.never)
      // 4: a clean end while live → the clean-end budget's FIRST spend
      .mockReturnValueOnce(streamThat<string>([]))
      // 5: silent again → NOW the deadline budget is spent
      .mockReturnValue(Stream.never);

    await onVirtualClock(
      [streamFn, () => undefined, vi.fn(), "test", tile()],
      () =>
        Effect.gen(function* () {
          yield* advance(5_000 + 300); // heartbeat failure #1 → attempt 2
          yield* advance(5_000 + 300); // heartbeat failure #2 → attempt 3
          expect(streamFn).toHaveBeenCalledTimes(3);
          expect(err).not.toHaveBeenCalled();

          yield* advance(45_000); // attempt 3's deadline — budget 0→1
          expect(err).not.toHaveBeenCalled();
          expect(toastSpy.error).not.toHaveBeenCalled();
          yield* advance(300);
          expect(streamFn).toHaveBeenCalledTimes(4);

          yield* advance(300); // attempt 4's clean end + exit settle
          yield* advance(300);
          expect(err).not.toHaveBeenCalled(); // clean-end budget 0→1, quiet
          expect(streamFn).toHaveBeenCalledTimes(5);

          yield* advance(45_000); // attempt 5 silent → the verdict, at last
          expect(err).toHaveBeenCalledTimes(1);
          expect(toastSpy.error).toHaveBeenCalledTimes(1);
          return undefined;
        }),
    );
  });

  // ── The fruitless-cycle verdict (kolu#2101 K3-client) ───────────────────
  //
  // The 300ms macro-retry that absorbs a server-side budget exhaustion is
  // unbounded BY DESIGN and stays so — a genuine transient must not be
  // punished. What it lacked was loudness: a persistently wedged chain churned
  // to console forever, the one attach lane with neither ceiling nor verdict.
  // Same policy as K1, different lane: the budgets above catch the SLOW
  // fruitless shape (silence), this catches the FAST one (churn).

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
