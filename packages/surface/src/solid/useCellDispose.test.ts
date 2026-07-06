/**
 * The subscription-leak invariant (W4 switch-toast bug): a `useCell` subscription
 * lives in a detached `createRoot` so it works even without a reactive owner, but
 * when there IS one its dispose MUST be tied to it — otherwise a bindingScoped host
 * switch disposes the per-key owner while the sub leaks on live, and the retired
 * socket's error reaches `onError` (three live subs leaked per switch, three toasts).
 *
 * Pins the invariant "a disposed subscription cannot report anything": disposing the
 * owner (1) ABORTS the sub's stream signal — proving the detached root was actually
 * torn down, not leaked — and (2) a subsequent stream error fires no `onError`.
 */

import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { StreamingProcedure } from "../client";
import type { Cell } from "../index";
import { useCell } from "./useCell";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** A server stream whose `next()` stays pending until `rejectNext` is called (the
 *  retired socket erroring the in-flight read). Captures the abort signal the
 *  framework threads in so the test can assert it aborts on disposal. */
function pendingSource() {
  let capturedSignal: AbortSignal | undefined;
  let rejectNext!: (err: unknown) => void;
  const source: StreamingProcedure<undefined, number> = (_input, opts) => {
    capturedSignal = opts?.signal;
    return Promise.resolve({
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            new Promise<IteratorResult<number>>((_res, rej) => {
              rejectNext = rej;
            }),
        };
      },
    });
  };
  return {
    source,
    signal: () => capturedSignal,
    retire: (err: unknown) => rejectNext(err),
  };
}

describe("useCell — the subscription-leak invariant (switch-toast fix)", () => {
  it("server authority: disposing the owner aborts the stream signal and reports nothing", async () => {
    const s = pendingSource();
    const onError = vi.fn();
    let dispose!: () => void;

    createRoot((d) => {
      dispose = d;
      useCell({} as Cell<"mem", number>, {
        authority: "server",
        source: s.source,
        onError,
      });
    });
    await flush(); // let source() resolve + next() begin

    // The framework threaded the abort signal into the stream (createSubscription
    // now passes it, matching createReactiveSubscription), and it's live pre-switch.
    expect(s.signal()).toBeDefined();
    expect(s.signal()?.aborted).toBe(false);

    // The switch: the bindingScoped per-key owner tears down.
    dispose();

    // (1) The detached-root sub was ACTUALLY disposed → its stream signal aborted.
    //     Before the leak fix this stayed false (the sub leaked on live).
    expect(s.signal()?.aborted).toBe(true);

    // (2) The retired socket now errors the in-flight read — a disposed sub must
    //     not report it (no false "server restarted — reload required" toast).
    s.retire(new Error("surface-app: socket retired by this client"));
    await flush();
    expect(onError).not.toHaveBeenCalled();
  });

  it("local authority: disposing the owner aborts the stream signal too", async () => {
    const s = pendingSource();
    const onError = vi.fn();
    let dispose!: () => void;

    createRoot((d) => {
      dispose = d;
      useCell({} as Cell<"mem", { n: number }>, {
        authority: "local",
        initial: { n: 0 },
        source: s.source as unknown as StreamingProcedure<
          undefined,
          { n: number }
        >,
        applyPatch: (cur, p) => ({ ...cur, ...p }),
        mutate: async () => {},
        onError,
      });
    });
    await flush();

    expect(s.signal()?.aborted).toBe(false);
    dispose();
    expect(s.signal()?.aborted).toBe(true);
    s.retire(new Error("surface-app: socket retired by this client"));
    await flush();
    expect(onError).not.toHaveBeenCalled();
  });
});
