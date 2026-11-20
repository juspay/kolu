import { Stream } from "effect";
import { FanOut, type PtyHostDataMsg } from "kaval";
import { afterEach, describe, expect, it } from "vitest";
import {
  type OpenedAttach,
  reattachingDeltas,
  releaseOnAbort,
} from "./reattachingDeltas.ts";
import type { TerminalAttachFrame } from "../endpoint.ts";

const ctx = { id: "t-leak" };

const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, ms = 1000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline) await delay(5);
}

const endedIter = (): AsyncIterator<PtyHostDataMsg> => ({
  next: () => Promise.resolve({ done: true, value: undefined }),
});

function overflowIter(): AsyncIterator<PtyHostDataMsg> {
  let sent = false;
  return {
    next: () => {
      if (sent) return Promise.resolve({ done: true, value: undefined });
      sent = true;
      return Promise.resolve({ done: false, value: { kind: "overflow" } });
    },
  };
}

function openOnFanOut(
  fan: FanOut<PtyHostDataMsg>,
  signal: AbortSignal | undefined,
): OpenedAttach {
  const iter = Stream.toAsyncIterable(fan.stream)[Symbol.asyncIterator]();
  releaseOnAbort(iter, signal);
  return {
    snapshot: "FRESH",
    topLine: 0,
    grid: { cols: 80, rows: 24 },
    iter,
  };
}

const opened: FanOut<PtyHostDataMsg>[] = [];
function fanOut(): FanOut<PtyHostDataMsg> {
  const fan = new FanOut<PtyHostDataMsg>();
  opened.push(fan);
  return fan;
}
afterEach(async () => {
  for (const fan of opened.splice(0)) fan.closeUnsafe();
  await delay(20);
});

function drain(gen: AsyncGenerator<TerminalAttachFrame>): Promise<void> {
  return (async () => {
    for await (const _ of gen) {
    }
  })();
}

describe("reattachingDeltas — an abort must not leak a kaval subscription", () => {
  it("abort DURING the re-open pause: the loop ends and re-opens nothing", async () => {
    const fan = fanOut();
    const controller = new AbortController();
    let opens = 0;
    const gen = reattachingDeltas(
      () => {
        opens++;
        return Promise.resolve(openOnFanOut(fan, controller.signal));
      },
      endedIter(),
      { ...ctx, signal: controller.signal },
    );
    const done = drain(gen);
    await delay(50);
    controller.abort();
    await Promise.race([done, delay(600)]);
    expect(fan.subscriberCount).toBe(0);
    expect(opens).toBe(0);
  });

  it("abort COINCIDENT with an overflow drop: the overflow re-open is not taken", async () => {
    const fan = fanOut();
    const controller = new AbortController();
    let opens = 0;
    const gen = reattachingDeltas(
      () => {
        opens++;
        return Promise.resolve(openOnFanOut(fan, controller.signal));
      },
      overflowIter(),
      { ...ctx, signal: controller.signal },
    );
    const done = drain(gen);
    await delay(20);
    controller.abort();
    await Promise.race([done, delay(600)]);
    expect(fan.subscriberCount).toBe(0);
    expect(opens).toBe(0);
  });

  it("an ALREADY-aborted signal releases the subscription immediately (WHATWG)", async () => {
    const fan = fanOut();
    const controller = new AbortController();
    controller.abort();
    const iter = Stream.toAsyncIterable(fan.stream)[Symbol.asyncIterator]();
    releaseOnAbort(iter, controller.signal);
    await iter.next();
    await waitFor(() => fan.subscriberCount === 0);
    expect(fan.subscriberCount).toBe(0);
  });

  it("a LIVE signal still releases the subscription when it aborts later", async () => {
    const fan = fanOut();
    const controller = new AbortController();
    const iter = Stream.toAsyncIterable(fan.stream)[Symbol.asyncIterator]();
    releaseOnAbort(iter, controller.signal);
    void iter.next();
    await waitFor(() => fan.subscriberCount === 1);
    expect(fan.subscriberCount).toBe(1);
    controller.abort();
    await waitFor(() => fan.subscriberCount === 0);
    expect(fan.subscriberCount).toBe(0);
  });
});
