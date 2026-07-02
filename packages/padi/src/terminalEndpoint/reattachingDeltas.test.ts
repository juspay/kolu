import { ORPCError } from "@orpc/server";
import type { PtyHostDataMsg } from "kaval";
import { describe, expect, it } from "vitest";
import {
  type OpenedAttach,
  reattachingDeltas,
  TERMINAL_RESET,
} from "./reattachingDeltas.ts";

/** A kaval attach iterator scripted from a list of frames (the snapshot is
 *  consumed separately by `open`, so these are the post-snapshot frames). */
function framesIter(frames: PtyHostDataMsg[]): AsyncIterator<PtyHostDataMsg> {
  let i = 0;
  return {
    next: () =>
      Promise.resolve(
        i < frames.length
          ? { done: false, value: frames[i++] as PtyHostDataMsg }
          : { done: true, value: undefined },
      ),
  };
}

const delta = (data: string): PtyHostDataMsg => ({ kind: "delta", data });
const overflow: PtyHostDataMsg = { kind: "overflow" };

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const s of gen) out.push(s);
  return out;
}

describe("reattachingDeltas", () => {
  it("yields the delta strings and ends on a graceful stream end", async () => {
    const initial = framesIter([delta("a"), delta("b")]);
    const open = (): Promise<OpenedAttach> => {
      throw new Error("must not re-attach on a graceful end");
    };
    expect(await collect(reattachingDeltas(open, initial))).toEqual(["a", "b"]);
  });

  it("re-attaches on an `overflow` frame, prefixing the fresh snapshot with a reset", async () => {
    // First leg drops after one delta; the re-attach delivers a fresh snapshot
    // and one more delta, then ends gracefully.
    const initial = framesIter([delta("before"), overflow]);
    let opened = 0;
    const open = (): Promise<OpenedAttach> => {
      opened++;
      return Promise.resolve({
        snapshot: "FRESH",
        iter: framesIter([delta("after")]),
      });
    };
    const out = await collect(reattachingDeltas(open, initial));
    // The dropped subscriber's delta is delivered; then the reset-prefixed fresh
    // snapshot replaces the screen; then the re-attached deltas flow.
    expect(out).toEqual(["before", `${TERMINAL_RESET}FRESH`, "after"]);
    expect(opened).toBe(1);
  });

  it("re-attaches repeatedly across successive drops", async () => {
    const initial = framesIter([overflow]);
    const legs: PtyHostDataMsg[][] = [[delta("one"), overflow], [delta("two")]];
    let leg = 0;
    const open = (): Promise<OpenedAttach> =>
      Promise.resolve({
        snapshot: `S${leg}`,
        iter: framesIter(legs[leg++] as PtyHostDataMsg[]),
      });
    const out = await collect(reattachingDeltas(open, initial));
    expect(out).toEqual([
      `${TERMINAL_RESET}S0`,
      "one",
      `${TERMINAL_RESET}S1`,
      "two",
    ]);
  });

  it("ends cleanly when the PTY has vanished by the time we re-attach (NOT_FOUND)", async () => {
    // A drop whose re-attach finds the PTY gone is a real end, not an error to
    // surface — the loop returns instead of throwing.
    const initial = framesIter([delta("x"), overflow]);
    const open = (): Promise<OpenedAttach> =>
      Promise.reject(new ORPCError("NOT_FOUND", { message: "no PTY" }));
    expect(await collect(reattachingDeltas(open, initial))).toEqual(["x"]);
  });

  it("propagates a non-NOT_FOUND re-attach failure", async () => {
    const initial = framesIter([overflow]);
    const open = (): Promise<OpenedAttach> =>
      Promise.reject(new Error("transport exploded"));
    await expect(collect(reattachingDeltas(open, initial))).rejects.toThrow(
      "transport exploded",
    );
  });
});
