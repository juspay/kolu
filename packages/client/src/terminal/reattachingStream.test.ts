import { Effect, Exit, Fiber, Stream } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeReattachingStream } from "./reattachingStream";

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

    start(streamFn, (item) => items.push(item), onReattach, "test", tile());

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

    start(streamFn, (item) => items.push(item), onReattach, "test", tile(true));

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

    start(streamFn, (item) => items.push(item), onReattach, "test", tile());

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
      (item) => items.push(item),
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
});
