/**
 * What door B rests on, measured: a tile's attach behind the Conductor, on a
 * transport drop, ends its own fiber from inside the fence's `onRetry` hook
 * (`Terminal.tsx`, `endAndReopen`), and the fence's replay of the captured
 * input — a resize — must then never go out.
 *
 * That is Effect's behaviour, not the client's code: the interrupt lands on the
 * fiber running the hook, and nothing but this test says it stops the stream
 * before the retry re-subscribes. So it runs the REAL fence
 * (`unenrolledStreamCall`) over a procedure that drops the way a socket does,
 * and counts subscribes a second and a half on — past the fence's one-second
 * retry pause. The `BETA-ASSUMPTION(4.1.4)` marker in `Terminal.tsx` points
 * here.
 *
 * Time is Effect's TestClock: the fence's pause is an Effect schedule, which is
 * that clock's to move, not vitest's.
 */

import { unenrolledStreamCall } from "@kolu/surface/client";
import { Effect, Fiber, Stream } from "effect";
import { RpcClientError } from "effect/rpc/RpcClientError";
import { SocketReadError } from "effect/socket/Socket";
import { TestClock } from "effect/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnFiber } from "./attachAttempts";

const drop = () =>
  new RpcClientError({
    reason: new SocketReadError({ cause: new Error("socket dropped") }),
  });

/** Let every woken fiber run to its next suspension. */
const drain = Effect.forEach([1, 2, 3, 4, 5, 6, 7, 8], () => Effect.yieldNow, {
  discard: true,
});
const advance = (ms: number) =>
  TestClock.adjust(ms).pipe(Effect.flatMap(() => drain));

/** One attach the way `Terminal.tsx` runs it: the real fence around a
 *  procedure whose first subscribe drops — after a frame, or at once, before
 *  the fork has handed its fiber over — with the given retry hook. */
function attach(opts: {
  drop: "after-a-frame" | "before-the-handle";
  hook: "nothing" | "interrupt";
}) {
  return Effect.runPromise(
    Effect.gen(function* () {
      let subscribes = 0;
      const frames: string[] = [];
      let handedOver = false;
      let hookSawHandle: boolean | null = null;
      const procedure = (_input: {
        id: string;
      }): Stream.Stream<string, unknown> => {
        subscribes += 1;
        if (subscribes > 1)
          return Stream.concat(
            Stream.make(`replay-${subscribes}`),
            Stream.never,
          );
        return opts.drop === "before-the-handle"
          ? Stream.fail(drop())
          : Stream.concat(
              Stream.make("first"),
              Stream.fromEffect(
                Effect.sleep("10 millis").pipe(
                  Effect.andThen(Effect.fail(drop())),
                ),
              ),
            );
      };
      const own = createOwnFiber();
      const stream = unenrolledStreamCall(
        procedure,
        { id: "t" },
        {
          onRetry: () => {
            hookSawHandle = handedOver;
            if (opts.hook === "interrupt") own.interrupt();
          },
        },
      );
      const fiber = yield* Effect.forkChild(
        Stream.runForEach(stream, (f) => Effect.sync(() => frames.push(f))),
      );
      // The drop that beats the handle: the first subscribe fails and the hook
      // runs before the fork's fiber is handed to the attempt.
      if (opts.drop === "before-the-handle") yield* drain;
      handedOver = true;
      own.set(fiber);
      yield* drain;
      yield* advance(10);
      yield* advance(1_500);
      yield* Fiber.interrupt(fiber);
      return { subscribes, frames, hookSawHandle };
    }).pipe(Effect.provide(TestClock.layer())),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("an attach ending its own fiber from the fence's retry hook", () => {
  it("CONTROL: a hook that does nothing lets the fence replay", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await attach({ drop: "after-a-frame", hook: "nothing" })).toEqual({
      subscribes: 2,
      frames: ["first", "replay-2"],
      hookSawHandle: true,
    });
  });

  it("stops the stream before the replay goes out", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await attach({ drop: "after-a-frame", hook: "interrupt" })).toEqual({
      subscribes: 1,
      frames: ["first"],
      hookSawHandle: true,
    });
  });

  it("stops it too when the drop beats the fork's handle: the interrupt is owed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      await attach({ drop: "before-the-handle", hook: "interrupt" }),
    ).toEqual({ subscribes: 1, frames: [], hookSawHandle: false });
  });
});
