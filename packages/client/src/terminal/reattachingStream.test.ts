import { Effect, Exit, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  consumeReattachingStream,
  StaleSnapshotGrid,
} from "./reattachingStream";

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

  it("a SECOND clean end while live spends the budget and DIES loudly", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    // A chain that manufactures ends: every attach ends cleanly, the PTY never
    // exits. One re-attach is bought; the next end is a defect, not a third
    // attempt — retrying it every 300ms would blank the pane on every loop.
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(streamThat(["snapshot"]));

    const fiber = Effect.runFork(
      consumeReattachingStream(streamFn, () => {}, onReattach, "test", tile()),
    );
    const exit = await Effect.runPromise(Fiber.await(fiber));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(streamFn).toHaveBeenCalledTimes(2); // never a third
    expect(onReattach).toHaveBeenCalledTimes(1);
  });

  // ── The stale-grid refusal (kolu#2101, deploy #2 incident #3) ───────────
  //
  // A snapshot answers the grid the attempt ASKED at. If the pane has resized
  // since, painting it wraps scrollback at the wrong width — damage no later
  // repaint undoes — so the handler refuses the frame. That refusal is a
  // RECOVERABLE race with a documented repair (reset, reopen at the current
  // grid). Spelled as a `throw` it was a DEFECT the failure-only retry never
  // saw: the loop died, the pane went permanently blank over a live agent, and
  // the toast said "reopening". These pin the channel, not the wording.

  /** One pane driven the way `Terminal.tsx` drives it: the thunk captures the
   *  grid it opens at, the frame handler refuses a snapshot that answers any
   *  other grid, and `onReattach` is the screen reset. `perturb` runs at open
   *  time and models a grid that moves WHILE the request is in flight (a
   *  reload's column settle, another client's resize landing on the shared pty). */
  function pane(opts: {
    startAt: number;
    perturbTo?: number[];
    onOpen?: (cols: number) => void;
  }) {
    let paneCols = opts.startAt;
    let requestedCols = 0;
    const perturbations = [...(opts.perturbTo ?? [])];
    const refusals: string[] = [];
    const painted: string[] = [];
    const onReattach = vi.fn();
    const streamFn = vi.fn<() => Stream.Stream<string, unknown>>(() => {
      requestedCols = paneCols; // the thunk reads the CURRENT grid, every open
      opts.onOpen?.(requestedCols);
      const settle = perturbations.shift();
      if (settle !== undefined) paneCols = settle; // …and it moves in flight
      return Stream.concat(
        streamThat([`snapshot@${requestedCols}`]),
        Stream.never, // a healthy attach stays open
      );
    });
    const onItem = (item: string): StaleSnapshotGrid | undefined => {
      if (item.startsWith("snapshot@") && requestedCols !== paneCols) {
        refusals.push(item);
        return new StaleSnapshotGrid({
          terminalId: "t1",
          requested: { cols: requestedCols, rows: 24 },
          current: { cols: paneCols, rows: 24 },
        });
      }
      painted.push(item);
      return undefined;
    };
    return {
      streamFn,
      onItem,
      onReattach,
      refusals,
      painted,
      cols: () => paneCols,
      resizeTo: (cols: number) => {
        paneCols = cols;
      },
    };
  }

  it("resize between the request and the answer → resets, reopens ONCE, converges", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = pane({ startAt: 66, perturbTo: [65] }); // the 66→65 column settle

    const fiber = start(p.streamFn, p.onItem, p.onReattach, "test", tile());

    await new Promise((r) => setTimeout(r, 500)); // past one 300ms backoff
    expect(p.refusals).toEqual(["snapshot@66"]); // the stale answer, refused
    expect(p.painted).toEqual(["snapshot@65"]); // the fresh one, at the new grid
    expect(p.onReattach).toHaveBeenCalledTimes(1); // reset once, before reopening
    expect(p.streamFn).toHaveBeenCalledTimes(2); // reopened exactly once

    // And the loop is ALIVE — the incident's whole cost was that it was not.
    expect(fiber.pollUnsafe()).toBe(undefined);
    fiber.interruptUnsafe();
  });

  it("the reload storm: N panes each shifting one column all converge", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // Three panes, the shape of the production report: a hard reload, every
    // pane's layout settling one column narrower at once.
    const panes = [66, 100, 132].map((startAt) =>
      pane({ startAt, perturbTo: [startAt - 1] }),
    );
    const fibers = panes.map((p) =>
      start(p.streamFn, p.onItem, p.onReattach, "test", tile()),
    );

    await new Promise((r) => setTimeout(r, 500));

    for (const [i, p] of panes.entries()) {
      expect(p.painted).toEqual([`snapshot@${[65, 99, 131][i]}`]);
      expect(p.streamFn).toHaveBeenCalledTimes(2);
      expect(fibers[i]?.pollUnsafe()).toBe(undefined); // none died
    }
    for (const f of fibers) f.interruptUnsafe();
  });

  it("a THROW from the frame handler still DIES loud — not retried", async () => {
    // The negative pin. Refusing a frame is recoverable and returns; a breach of
    // an invariant nothing can repair still throws, and must still skip every
    // recovery path (channel 1). Same rule as the thunk's measured-grid assert.
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

  // ── Multi-client grid contention (kolu#2101 G8d/G8e) ────────────────────
  //
  // `resizeTo` is a WRITE to a SHARED pty and the policy is LAST-ATTACH-WINS
  // (`@kolu/padi/surface`'s `PadiTerminalAttachInputSchema`). Two clients on one
  // terminal therefore ping-pong its width — the production recording shows
  // content re-wrapping 136 → ~65 → 136 with neither viewer told why. The policy
  // is not what this test can change; what it pins is that the contention is a
  // WRAPPING artifact and never a LIFECYCLE one: every refusal converges, and no
  // pane loses its attach loop no matter how many times the other side asserts.

  it("two clients ping-ponging the shared grid: both converge, neither loop dies", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    /** The shared pty, last-attach-wins — the stated policy, executed. */
    let ptyCols = 136;
    const attachAsserts: number[] = [];
    const assertGrid = (cols: number) => {
      attachAsserts.push(cols);
      ptyCols = cols;
    };

    // The desktop holds a live attach at 136; its own layout settles twice
    // (136 → 132 → 130) while the phone resumes alongside it — the iOS unlock
    // re-attach, asserting 65 on the shared pty each time.
    const desktop = pane({
      startAt: 136,
      perturbTo: [132, 130],
      onOpen: assertGrid,
    });
    const phone = pane({ startAt: 65, onOpen: assertGrid });

    const dFiber = start(
      desktop.streamFn,
      desktop.onItem,
      desktop.onReattach,
      "desktop",
      tile(),
    );
    const pFiber = start(
      phone.streamFn,
      phone.onItem,
      phone.onReattach,
      "phone",
      tile(),
    );

    await new Promise((r) => setTimeout(r, 1000)); // several backoff windows

    // The desktop refused every stale answer and re-attached each time, ending
    // painted at the grid its pane actually has.
    expect(desktop.refusals).toEqual(["snapshot@136", "snapshot@132"]);
    expect(desktop.painted).toEqual(["snapshot@130"]);
    expect(desktop.streamFn).toHaveBeenCalledTimes(3);
    // The phone was never perturbed, so it painted first time and never reopened.
    expect(phone.painted).toEqual(["snapshot@65"]);
    expect(phone.streamFn).toHaveBeenCalledTimes(1);
    // Neither loop died — the property the incident broke.
    expect(dFiber.pollUnsafe()).toBe(undefined);
    expect(pFiber.pollUnsafe()).toBe(undefined);
    // The ping-pong itself: both sizes asserted on ONE shared pty, and the pty
    // carries the LAST assertion — the stated last-attach-wins policy, executed.
    expect(new Set(attachAsserts)).toEqual(new Set([136, 132, 130, 65]));
    expect(ptyCols).toBe(attachAsserts[attachAsserts.length - 1]);

    dFiber.interruptUnsafe();
    pFiber.interruptUnsafe();
  });

  it("a FOREIGN resize alone is invisible to this pane — today's gap, pinned", async () => {
    // The honest negative pin, and the reason the affordance needs a wire fact.
    // The refusal compares what THIS attempt asked for against what THIS pane
    // now measures. A foreign client's `resizeTo` moves the SHARED pty and
    // touches neither, so this pane paints a snapshot serialized at the other
    // viewer's width into its own unchanged grid — the production recording's
    // 136-col pane rendering ~65 cols of content, with nothing said to either
    // viewer. Nothing here is wrong about the LOOP (the point of the test above);
    // what is missing is a fact. Flip this test when the pty's current grid
    // reaches the client — see `PadiTerminalAttachInputSchema`'s policy note.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let ptyCols = 136;
    const desktop = pane({ startAt: 136, onOpen: (c) => (ptyCols = c) });

    const fiber = start(
      desktop.streamFn,
      desktop.onItem,
      desktop.onReattach,
      "desktop",
      tile(),
    );
    await new Promise((r) => setTimeout(r, 100));
    ptyCols = 65; // the phone attaches: last-attach-wins, silently

    await new Promise((r) => setTimeout(r, 400));
    expect(ptyCols).toBe(65); // the pty really is 65 now
    expect(desktop.cols()).toBe(136); // the pane really is still 136
    expect(desktop.refusals).toEqual([]); // …and nothing refused,
    expect(desktop.painted).toEqual(["snapshot@136"]); // nothing re-attached,
    expect(desktop.onReattach).not.toHaveBeenCalled(); // nothing told the user.
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
    // pane exactly. Measured at 10_000ms AND a further hour of virtual time:
    //
    //   { onReattachCalls: 0, streamFnCalls: 1, consoleWarnCalls: 0,
    //     consoleErrorCalls: 0, fiberStillParked: true }
    //
    // Nothing logged, nothing toasted, nothing retried, the fiber still parked:
    // a blank pane over a live agent, forever.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onReattach = vi.fn();
    const streamFn = vi
      .fn<() => Stream.Stream<string, unknown>>()
      .mockReturnValue(Stream.never);

    const exit = await onVirtualClock(
      [streamFn, () => undefined, onReattach, "test", tile()],
      (fiber) =>
        Effect.gen(function* () {
          // One millisecond short of the deadline: nothing has happened.
          yield* advance(9_999);
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

          // The successor is silent too: the budget is spent, so this is a
          // DEFECT, not a third attempt (which would re-blank the pane every
          // ten seconds forever).
          yield* advance(10_000);
          expect(streamFn).toHaveBeenCalledTimes(2);
          expect(onReattach).toHaveBeenCalledTimes(1);
          return yield* Fiber.join(fiber);
        }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    const cause = Exit.isFailure(exit) ? String(exit.cause) : "";
    expect(cause).toContain("opened silent twice");
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
});
