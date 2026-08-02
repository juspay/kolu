/**
 * The TUI's two seams onto the runner surface: NAMING the members it calls, and
 * the ONE place a `Stream` becomes callbacks.
 *
 * Why naming is a step at all: the member face
 * (`client.surface.<member>.<verb>`) is deliberately STRUCTURAL — per-member
 * precision lives in the spec-derived bound hooks a SolidJS consumer gets from
 * `surfaceClient`, and materialising a second precise type over the same spec is
 * the union-budget blow-up the framework exists to avoid. A non-reactive
 * consumer like this TUI therefore says once, here, what shape each member it
 * uses has — and every call site downstream is fully typed.
 *
 * `runStream` is the Effect→callback edge. A TUI's dashboard is push-driven and
 * non-Effect, so somewhere a stream has to be RUN; concentrating it here buys
 * one teardown contract (the stopper interrupts the fiber, and interruption
 * propagates into the stream's finalizers, which is what closes the wire
 * subscription — there is no `AbortSignal` to thread and none to forget) and one
 * "a stopped subscription reports nothing" rule.
 */

import type { StreamingProcedure, UnaryProcedure } from "@kolu/surface/client";
import { Cause, Effect, Exit, Stream } from "effect";
import type {
  NodeLogFrame,
  NodeLogInput,
  NodesSnapshot,
} from "../common/surface";
import type { RunnerClient } from "./connect";

/** The whole pipeline state, snapshot-then-delta. */
export function nodesStream(
  client: RunnerClient,
): Stream.Stream<NodesSnapshot, unknown> {
  const get = client.surface.nodes?.get as StreamingProcedure<
    undefined,
    NodesSnapshot
  >;
  return get(undefined);
}

/** One node's log, snapshot-then-append. */
export function nodeLogStream(
  client: RunnerClient,
  id: string,
): Stream.Stream<NodeLogFrame, unknown> {
  const get = client.surface.nodeLog?.get as StreamingProcedure<
    NodeLogInput,
    NodeLogFrame
  >;
  return get({ id });
}

/** The one mutation. */
export function rerunNode(
  client: RunnerClient,
  id: string,
): Promise<{ ok: boolean }> {
  const rerun = client.surface.node?.rerun as UnaryProcedure<
    { id: string },
    { ok: boolean }
  >;
  return rerun({ id });
}

export interface StreamHandlers<T> {
  onFrame: (frame: T) => void;
  /** The stream ended normally (the producer completed). */
  onEnd?: () => void;
  /** The stream failed. Never fired for an interruption — that is teardown. */
  onFailure?: (err: Error) => void;
}

/** Run `stream` on its own fiber and return the STOPPER. The stopper is
 *  idempotent and latches "stopped" BEFORE interrupting, so the interruption's
 *  own exit — and any frame already queued behind it — is silent. */
export function runStream<T>(
  stream: Stream.Stream<T, unknown>,
  handlers: StreamHandlers<T>,
): () => void {
  let stopped = false;
  const fiber = Effect.runFork(
    Stream.runForEach(stream, (frame) =>
      Effect.sync(() => {
        if (!stopped) handlers.onFrame(frame);
      }),
    ),
  );
  fiber.addObserver((exit) => {
    if (stopped) return;
    if (Exit.isSuccess(exit)) {
      handlers.onEnd?.();
      return;
    }
    if (Cause.hasInterruptsOnly(exit.cause)) return;
    const failure = Cause.squash(exit.cause);
    handlers.onFailure?.(
      failure instanceof Error ? failure : new Error(String(failure)),
    );
  });
  return () => {
    stopped = true;
    fiber.interruptUnsafe();
  };
}
