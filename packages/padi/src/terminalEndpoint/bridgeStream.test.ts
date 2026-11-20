import type { PadiTerminal } from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { Stream } from "effect";
import { describe, expect, it } from "vitest";
import {
  createFleetGate,
  setServingFleetGate,
} from "../attention/fleetGate.ts";
import {
  bridgeStream,
  onForegroundTapError,
  resubscribeStream,
} from "./local.ts";

const failingStream = (): Stream.Stream<number, unknown> =>
  Stream.fromAsyncIterable<number, unknown>(
    {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          Promise.reject(new Error("stream failed (kaval socket dropped)")),
      }),
    },
    (err) => err,
  );

const emptyStream = (): Stream.Stream<number, unknown> => Stream.empty;

describe("bridgeStream — the failure path never fabricates an event", () => {
  it("a NON-abort source failure routes to onError and NEVER calls onEvent", async () => {
    const events: number[] = [];
    let errored: unknown;
    const ac = new AbortController();

    await bridgeStream(
      failingStream(),
      ac.signal,
      (v) => events.push(v),
      (err) => {
        errored = err;
      },
    );

    expect(events).toEqual([]);
    expect(errored).toBeInstanceOf(Error);
  });

  it("an ABORTED source failure is swallowed — onError is NOT called (expected teardown)", async () => {
    const events: number[] = [];
    let errored = false;
    const ac = new AbortController();
    ac.abort();

    await bridgeStream(
      failingStream(),
      ac.signal,
      (v) => events.push(v),
      () => {
        errored = true;
      },
    );

    expect(events).toEqual([]);
    expect(errored).toBe(false);
  });

  it("a clean end resolves without touching onError", async () => {
    let errored = false;
    const ac = new AbortController();
    await bridgeStream(
      emptyStream(),
      ac.signal,
      () => {},
      () => {
        errored = true;
      },
    );
    expect(errored).toBe(false);
  });
});

describe("onForegroundTapError — the production handler never publishes (STAYS-DEFINED)", () => {
  it("a tap that fails before its first sample releases the redeploy's attention gate for that terminal", () => {
    const gate = createFleetGate();
    setServingFleetGate(gate);
    try {
      const survivor = "t1" as TerminalId;
      const fleet = new Map([[survivor, {} as PadiTerminal]]);
      gate.awaitFirstRead(survivor);
      expect(gate.admit(fleet)).toBe(false);
      onForegroundTapError(survivor, new Error("gone"));
      expect(gate.admit(fleet)).toBe(true);
    } finally {
      setServingFleetGate(null);
      gate.dispose();
    }
  });
});

describe("resubscribeStream — the eager synchronous-throw guard", () => {
  it("catches getStream()'s SYNCHRONOUS throw (daemon down) as a drop and re-subscribes, never rejecting", async () => {
    const drops: unknown[] = [];
    let calls = 0;
    const ac = new AbortController();
    await resubscribeStream<number>({
      signal: ac.signal,
      delayMs: 0,
      getStream: () => {
        calls += 1;
        if (calls === 1) {
          throw new Error("pty-host endpoint is not connected");
        }
        ac.abort();
        return emptyStream();
      },
      onEvent: () => {},
      onDrop: (err) => drops.push(err),
    });

    expect(drops).toHaveLength(1);
    expect(drops[0]).toBeInstanceOf(Error);
    expect(calls).toBe(2);
  });

  it("stops promptly without re-subscribing once the signal is aborted", async () => {
    let calls = 0;
    const ac = new AbortController();
    ac.abort();
    await resubscribeStream<number>({
      signal: ac.signal,
      delayMs: 0,
      getStream: () => {
        calls += 1;
        return emptyStream();
      },
      onEvent: () => {},
      onDrop: () => {},
    });
    expect(calls).toBe(0);
  });
});
