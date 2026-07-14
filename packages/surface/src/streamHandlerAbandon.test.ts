/**
 * PIN (#1719 survivor): a stream handler must OWN a read-ahead pull that its
 * oRPC client abandons at teardown, so a later upstream/transport death cannot
 * float that pull's rejection as an unhandled rejection — the padiBinding
 * "reconnects when padi dies" residual.
 *
 * The mechanism at the class: an oRPC client iterator pulls the next frame
 * EAGERLY (read-ahead) and, when the consumer unsubscribes (`iterator.return()`),
 * DISCARDS that in-flight pull's promise. If the source then rejects (a mid-stream
 * transport death), that abandoned pull rejects with no awaiter and floats. A
 * `for await … yield` async-generator handler cannot own it (the floating promise
 * is the generator's OWN `.next()` result, which it has no handle on); the manual
 * iterator `streamHandlers` returns hands the source's own pull straight back, so
 * `return()` can attach a catch to an in-flight one.
 *
 * RED on a plain `async function*` handler (the abandoned read-ahead floats);
 * GREEN once `streamHandlers` returns the ownership wrapper.
 */

import { describe, expect, it } from "vitest";
import { streamHandlers } from "./server";

describe("streamHandlers — owns an abandoned read-ahead pull", () => {
  it("a read-ahead pull abandoned at return() does not float when the source later rejects", async () => {
    const floats: unknown[] = [];
    const onFloat = (r: unknown): void => {
      floats.push(r);
    };
    process.on("unhandledRejection", onFloat);
    try {
      // A source that yields ONE frame, then parks on a pull we reject by hand —
      // the transport-death of an abandoned read-ahead pull.
      let rejectSecond: (e: unknown) => void = () => {};
      const secondPull = new Promise<IteratorResult<{ n: number }>>(
        (_res, rej) => {
          rejectSecond = rej;
        },
      );
      let call = 0;
      const source: AsyncIterableIterator<{ n: number }> = {
        [Symbol.asyncIterator]() {
          return this;
        },
        next() {
          call += 1;
          if (call === 1)
            return Promise.resolve({ value: { n: 0 }, done: false });
          return secondPull; // the parked pull, rejected below
        },
        return() {
          return Promise.resolve({ value: undefined, done: true });
        },
      };

      // `streamHandlers`' descriptor arg (`_stream`) is unused — a dummy suffices.
      const handlers = streamHandlers({} as never, {
        source: () => source,
      });
      const it = handlers.get({ input: {}, signal: undefined });

      expect((await it.next()).value).toEqual({ n: 0 });
      // The oRPC client read-ahead: pull the next frame, then ABANDON it (no await,
      // no catch) as the consumer unsubscribes.
      const abandoned = it.next();
      void abandoned;
      void it.return?.(undefined as never);
      // The upstream/transport dies — the abandoned pull rejects.
      rejectSecond(new Error("transport closed"));
      // Let a would-be float surface.
      await new Promise((r) => setTimeout(r, 30));

      expect(floats).toHaveLength(0);
    } finally {
      process.off("unhandledRejection", onFloat);
    }
  });
});
