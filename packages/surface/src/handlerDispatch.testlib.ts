/**
 * Test-only dispatch over a {@link SurfaceHandlers} record.
 *
 * A served surface is a plain `Record<fullWireTag, handler>` (see `./server`),
 * so a unit test invokes a member by its tag with ZERO transport in between —
 * the same call Stage 3's in-process dispatcher and Stage 4's
 * `RpcGroup.toLayer` make. These helpers only supply the Effect plumbing
 * (`runPromise` / fork+interrupt) that every such test would otherwise repeat.
 *
 * NOT exported from the package: this is the test edge, which is where
 * `Effect.run*` is sanctioned.
 */

import { Effect, Fiber, Stream } from "effect";
import type { SurfaceHandlers } from "./server";

function handlerAt(handlers: SurfaceHandlers, tag: string) {
  const handler = handlers[tag];
  if (!handler) {
    throw new Error(
      `no handler bound at "${tag}" — bound tags: ${Object.keys(handlers).sort().join(", ")}`,
    );
  }
  return handler;
}

/** Invoke a UNARY member and await its result. */
export function callUnary<A = unknown>(
  handlers: SurfaceHandlers,
  tag: string,
  payload?: unknown,
): Promise<A> {
  return Effect.runPromise(
    handlerAt(handlers, tag)(payload) as Effect.Effect<A>,
  );
}

/** The `Stream` a STREAMING member serves for `payload`. */
export function memberStream<A = unknown>(
  handlers: SurfaceHandlers,
  tag: string,
  payload?: unknown,
): Stream.Stream<A> {
  return handlerAt(handlers, tag)(payload) as Stream.Stream<A>;
}

/** A live subscription to a streaming member: every frame lands in `seen`, and
 *  `stop()` interrupts the consuming fiber — which IS the unsubscribe (D10). */
export interface Subscription<A> {
  readonly seen: A[];
  stop(): Promise<void>;
}

export function subscribeMember<A = unknown>(
  handlers: SurfaceHandlers,
  tag: string,
  payload?: unknown,
): Subscription<A> {
  const seen: A[] = [];
  const fiber = Effect.runFork(
    Stream.runForEach(memberStream<A>(handlers, tag, payload), (value) =>
      Effect.sync(() => {
        seen.push(value);
      }),
    ),
  );
  return {
    seen,
    stop: () => Effect.runPromise(Fiber.interrupt(fiber)),
  };
}

/** The first frame a streaming member serves — the snapshot, for a member that
 *  promises snapshot-then-deltas. */
export async function firstFrame<A = unknown>(
  handlers: SurfaceHandlers,
  tag: string,
  payload?: unknown,
): Promise<A> {
  const frames = await Effect.runPromise(
    Stream.runCollect(Stream.take(memberStream<A>(handlers, tag, payload), 1)),
  );
  if (frames.length === 0) {
    throw new Error(`"${tag}" completed without a first frame`);
  }
  return frames[0] as A;
}

/** Let every parked fiber make progress. Deliberately a macrotask, not a fixed
 *  number of microtasks — the ordering CONTRACT is pinned in
 *  `streamOrdering.test.ts`, never by a hop count here. */
export function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
