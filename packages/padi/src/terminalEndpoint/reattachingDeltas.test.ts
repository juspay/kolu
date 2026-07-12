import { ORPCError } from "@orpc/server";
import type { PtyHostDataMsg } from "kaval";
import { describe, expect, it } from "vitest";
import type { TerminalAttachFrame } from "../endpoint.ts";
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

async function collect(
  gen: AsyncGenerator<TerminalAttachFrame>,
): Promise<TerminalAttachFrame[]> {
  const out: TerminalAttachFrame[] = [];
  for await (const f of gen) out.push(f);
  return out;
}
/** The `data` field of each frame — the byte-stream projection the tests assert
 *  on for the string outputs. */
const data = (out: TerminalAttachFrame[]) => out.map((f) => f.data);

describe("reattachingDeltas", () => {
  it("yields the delta frames and ends on a graceful stream end", async () => {
    const initial = framesIter([delta("a"), delta("b")]);
    const open = (): Promise<OpenedAttach> => {
      throw new Error("must not re-attach on a graceful end");
    };
    const out = await collect(reattachingDeltas(open, initial));
    expect(data(out)).toEqual(["a", "b"]);
    // Plain deltas carry no re-seed.
    expect(out.every((f) => f.topLine === undefined)).toBe(true);
  });

  it("re-attaches on an `overflow` frame, prefixing a reset + re-seeding topLine", async () => {
    // First leg drops after one delta; the re-attach delivers a fresh snapshot
    // (with its own seed) and one more delta, then ends gracefully.
    const initial = framesIter([delta("before"), overflow]);
    let opened = 0;
    const open = (): Promise<OpenedAttach> => {
      opened++;
      return Promise.resolve({
        snapshot: "FRESH",
        topLine: 42,
        iter: framesIter([delta("after")]),
      });
    };
    const out = await collect(reattachingDeltas(open, initial));
    // The dropped subscriber's delta is delivered; then the reset-prefixed fresh
    // snapshot replaces the screen AND re-seeds the backfill cursor; then deltas.
    expect(data(out)).toEqual(["before", `${TERMINAL_RESET}FRESH`, "after"]);
    expect(out.map((f) => f.topLine)).toEqual([undefined, 42, undefined]);
    expect(opened).toBe(1);
  });

  it("re-attaches repeatedly across successive drops", async () => {
    const initial = framesIter([overflow]);
    const legs: PtyHostDataMsg[][] = [[delta("one"), overflow], [delta("two")]];
    let leg = 0;
    const open = (): Promise<OpenedAttach> =>
      Promise.resolve({
        snapshot: `S${leg}`,
        topLine: leg * 10,
        iter: framesIter(legs[leg++] as PtyHostDataMsg[]),
      });
    const out = await collect(reattachingDeltas(open, initial));
    expect(data(out)).toEqual([
      `${TERMINAL_RESET}S0`,
      "one",
      `${TERMINAL_RESET}S1`,
      "two",
    ]);
    expect(out.map((f) => f.topLine)).toEqual([0, undefined, 10, undefined]);
  });

  it("ends cleanly when the PTY has vanished by the time we re-attach (NOT_FOUND)", async () => {
    // A drop whose re-attach finds the PTY gone is a real end, not an error to
    // surface — the loop returns instead of throwing.
    const initial = framesIter([delta("x"), overflow]);
    const open = (): Promise<OpenedAttach> =>
      Promise.reject(new ORPCError("NOT_FOUND", { message: "no PTY" }));
    expect(data(await collect(reattachingDeltas(open, initial)))).toEqual([
      "x",
    ]);
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
