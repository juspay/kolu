import { describe, expect, it, vi } from "vitest";
import type { StreamingProcedure } from "./client.ts";
import { pollOnChange } from "./pollOnChange.ts";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type PulseEvent<T> =
  | { kind: "frame"; value: T }
  | { kind: "error"; error: unknown }
  | { kind: "complete" };

function controllablePulse<T>(): {
  procedure: StreamingProcedure<void, T>;
  emit: (value: T) => void;
  fail: (error: unknown) => void;
  readonly delivered: number;
} {
  const events: PulseEvent<T>[] = [];
  let waiter: ((event: PulseEvent<T>) => void) | undefined;
  let delivered = 0;

  const push = (event: PulseEvent<T>): void => {
    if (waiter) {
      const deliver = waiter;
      waiter = undefined;
      deliver(event);
    } else {
      events.push(event);
    }
  };

  return {
    procedure: async (_input, { signal }) => ({
      async *[Symbol.asyncIterator]() {
        while (!signal?.aborted) {
          const event =
            events.shift() ??
            (await new Promise<PulseEvent<T>>((resolve) => {
              waiter = resolve;
              signal?.addEventListener(
                "abort",
                () => resolve({ kind: "complete" }),
                { once: true },
              );
            }));
          if (event.kind === "complete") return;
          if (event.kind === "error") throw event.error;
          delivered += 1;
          yield event.value;
        }
      },
    }),
    emit: (value) => push({ kind: "frame", value }),
    fail: (error) => push({ kind: "error", error }),
    get delivered() {
      return delivered;
    },
  };
}

function queryHarness(): {
  query: (signal: AbortSignal) => Promise<string>;
  calls: Array<Deferred<string> & { signal: AbortSignal }>;
} {
  const calls: Array<Deferred<string> & { signal: AbortSignal }> = [];
  return {
    query: (signal) => {
      const call = { ...deferred<string>(), signal };
      calls.push(call);
      return call.promise;
    },
    calls,
  };
}

describe("pollOnChange", () => {
  it("hydrates before the pulse stream delivers its first frame", async () => {
    const pulse = controllablePulse<number>();
    const queries = queryHarness();
    const results: string[] = [];
    const lifetime = new AbortController();

    pollOnChange({
      pulse: pulse.procedure,
      pulseInput: undefined,
      query: queries.query,
      onResult: (result) => results.push(result),
      onError: () => {},
      onComplete: () => {},
      signal: lifetime.signal,
    });

    await vi.waitFor(() => expect(queries.calls).toHaveLength(1));
    expect(pulse.delivered).toBe(0);
    queries.calls[0]!.resolve("initial");
    await vi.waitFor(() => expect(results).toEqual(["initial"]));
    lifetime.abort();
  });

  it("does nothing when its lifetime was already aborted", async () => {
    const pulse = controllablePulse<number>();
    const queries = queryHarness();
    const onResult = vi.fn();
    const onError = vi.fn();
    const onComplete = vi.fn();
    const lifetime = new AbortController();
    lifetime.abort();

    pollOnChange({
      pulse: pulse.procedure,
      pulseInput: undefined,
      query: queries.query,
      onResult,
      onError,
      onComplete,
      signal: lifetime.signal,
    });

    await Promise.resolve();
    expect(queries.calls).toHaveLength(0);
    expect(pulse.delivered).toBe(0);
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("fails a wedged query loudly and runs its queued refresh", async () => {
    vi.useFakeTimers();
    try {
      const pulse = controllablePulse<number>();
      const queries = queryHarness();
      const onError = vi.fn();
      const lifetime = new AbortController();

      pollOnChange({
        pulse: pulse.procedure,
        pulseInput: undefined,
        query: queries.query,
        onResult: () => {},
        onError,
        onComplete: () => {},
        signal: lifetime.signal,
      });

      pulse.emit(0);
      for (let i = 0; i < 10 && pulse.delivered === 0; i += 1) {
        await Promise.resolve();
      }
      expect(pulse.delivered).toBe(1);
      expect(queries.calls).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(queries.calls[0]!.signal.aborted).toBe(true);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "pollOnChange query did not settle within 60000ms",
        }),
      );
      expect(queries.calls).toHaveLength(2);
      lifetime.abort();
    } finally {
      vi.useRealTimers();
    }
  });

  it("coalesces a pulse burst without aborting or starving the in-flight query", async () => {
    const pulse = controllablePulse<number>();
    const queries = queryHarness();
    const results: string[] = [];
    const errors: unknown[] = [];
    const lifetime = new AbortController();

    pollOnChange({
      pulse: pulse.procedure,
      pulseInput: undefined,
      query: queries.query,
      onResult: (result) => results.push(result),
      onError: (error) => errors.push(error),
      onComplete: () => {},
      signal: lifetime.signal,
    });

    pulse.emit(0);
    await vi.waitFor(() => expect(queries.calls).toHaveLength(1));
    pulse.emit(1);
    pulse.emit(2);
    pulse.emit(3);
    await vi.waitFor(() => expect(pulse.delivered).toBe(4));
    expect(queries.calls[0]!.signal.aborted).toBe(false);
    expect(queries.calls).toHaveLength(1);

    queries.calls[0]!.resolve("leading");
    await vi.waitFor(() => expect(queries.calls).toHaveLength(2));
    expect(results).toEqual(["leading"]);

    queries.calls[1]!.resolve("trailing");
    await vi.waitFor(() => expect(results).toEqual(["leading", "trailing"]));
    expect(queries.calls).toHaveLength(2);
    expect(errors).toEqual([]);
    lifetime.abort();
  });

  it("aborts the in-flight query on teardown and discards its late result", async () => {
    const pulse = controllablePulse<number>();
    const queries = queryHarness();
    const results: string[] = [];
    const onError = vi.fn();
    const onComplete = vi.fn();
    const lifetime = new AbortController();

    pollOnChange({
      pulse: pulse.procedure,
      pulseInput: undefined,
      query: queries.query,
      onResult: (result) => results.push(result),
      onError,
      onComplete,
      signal: lifetime.signal,
    });

    pulse.emit(0);
    await vi.waitFor(() => expect(queries.calls).toHaveLength(1));
    lifetime.abort();
    expect(queries.calls[0]!.signal.aborted).toBe(true);
    queries.calls[0]!.resolve("late");
    await Promise.resolve();
    expect(results).toEqual([]);
    expect(onError).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("lets a pulse failure own the terminal state", async () => {
    const pulse = controllablePulse<number>();
    const queries = queryHarness();
    const results: string[] = [];
    const failure = new Error("watcher failed");
    const onError = vi.fn();
    const onComplete = vi.fn();
    const lifetime = new AbortController();

    pollOnChange({
      pulse: pulse.procedure,
      pulseInput: undefined,
      query: queries.query,
      onResult: (result) => results.push(result),
      onError,
      onComplete,
      signal: lifetime.signal,
    });

    pulse.emit(0);
    await vi.waitFor(() => expect(queries.calls).toHaveLength(1));
    pulse.fail(failure);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(queries.calls[0]!.signal.aborted).toBe(true);
    queries.calls[0]!.resolve("late");
    await Promise.resolve();
    expect(results).toEqual([]);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("surfaces a query failure and still runs a requested trailing refresh", async () => {
    const pulse = controllablePulse<number>();
    const queries = queryHarness();
    const results: string[] = [];
    const failure = new Error("query failed");
    const onError = vi.fn();
    const lifetime = new AbortController();

    pollOnChange({
      pulse: pulse.procedure,
      pulseInput: undefined,
      query: queries.query,
      onResult: (result) => results.push(result),
      onError,
      onComplete: () => {},
      signal: lifetime.signal,
    });

    pulse.emit(0);
    await vi.waitFor(() => expect(queries.calls).toHaveLength(1));
    pulse.emit(1);
    queries.calls[0]!.reject(failure);
    await vi.waitFor(() => expect(queries.calls).toHaveLength(2));
    expect(onError).toHaveBeenCalledWith(failure);

    queries.calls[1]!.resolve("recovered");
    await vi.waitFor(() => expect(results).toEqual(["recovered"]));
    lifetime.abort();
  });
});
