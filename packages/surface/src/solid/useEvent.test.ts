/** `useEvent`'s lifetime rule: an owner, a signal, or a refusal.
 *
 *  An event view opens a fiber whose finalizers are what close the wire
 *  subscription. Only two things can interrupt it — the creating owner's
 *  disposal (via `onCleanup`) or an external `AbortSignal` — so a call with
 *  neither is refused at birth rather than leaked, the same way
 *  `createSubscription` and `createReactiveSubscription` refuse it. */

import { Schema, Stream } from "effect";
import { createRoot } from "solid-js";
import { describe, expect, it } from "vitest";
import { event } from "../index";
import { controllableStream } from "./controllableStream.testlib";
import { useEvent } from "./useEvent";

const ping = event({
  name: "ping",
  inputSchema: Schema.Number,
  outputSchema: Schema.Number,
});

/** Drain macrotasks so an occurrence crosses the stream fiber and reaches the
 *  handler — the same two-turn flush the rest of this directory uses. Never
 *  fewer: an assertion is never relaxed to fit the timing. */
async function settle(): Promise<void> {
  for (let i = 0; i < 2; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

describe("useEvent: an owner, a signal, or a refusal", () => {
  it("with no owner and no signal, refuses", () => {
    const stream = controllableStream<number>();
    expect(() =>
      useEvent(
        ping,
        () => 1,
        () => stream.source,
        () => {},
        { onError: () => {} },
      ),
    ).toThrow(
      /useEvent: must run under a reactive owner, or be given `options\.signal`/,
    );
    stream.close();
  });

  it("with no owner but a signal, subscribes and the abort ends it", async () => {
    const controller = new AbortController();
    const stream = controllableStream<number>();
    const seen: number[] = [];
    useEvent(
      ping,
      () => 1,
      () => stream.source,
      (n) => seen.push(n),
      { onError: () => {}, signal: controller.signal },
    );
    await settle();
    stream.push(1);
    await settle();
    expect(seen).toEqual([1]);
    controller.abort();
    stream.push(2);
    await settle();
    expect(seen).toEqual([1]);
    stream.close();
  });

  it("under an owner, no signal needed", async () => {
    const stream = controllableStream<number>();
    const seen: number[] = [];
    const dispose = createRoot((dispose) => {
      useEvent(
        ping,
        () => 1,
        () => stream.source,
        (n) => seen.push(n),
        { onError: () => {} },
      );
      return dispose;
    });
    await settle();
    stream.push(7);
    await settle();
    expect(seen).toEqual([7]);
    dispose();
    stream.close();
  });

  it("a handler that aborts during the synchronous run leaves no fiber behind", async () => {
    // The signal can abort INSIDE `start()`. The source below delivers its first
    // occurrence while `runStreamScoped` is still running — Effect runs a forked
    // stream synchronously up to its first async boundary — so the handler's
    // abort reaches the hook before the stopper exists, and finds nothing to
    // stop. Without the latch the fiber (and the wire subscription its
    // finalizers close) survives the view that ended, and keeps delivering: the
    // second push below lands in the handler.
    const controller = new AbortController();
    const stream = controllableStream<number>();
    const seen: number[] = [];
    useEvent(
      ping,
      () => 1,
      () => Stream.concat(Stream.make(1), stream.source),
      (n) => {
        seen.push(n);
        controller.abort();
      },
      { onError: () => {}, signal: controller.signal },
    );
    await settle();
    expect(seen).toEqual([1]);
    stream.push(2);
    await settle();
    expect(seen).toEqual([1]);
    stream.close();
  });
});
