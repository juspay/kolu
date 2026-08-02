import { PtyNotFound } from "kaval";
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
/** The re-seed anchor per frame: a `snapshot` frame's `topLine`, `undefined` for
 *  a plain `delta` (the discriminated-union projection of the old optional field). */
const topLines = (out: TerminalAttachFrame[]) =>
  out.map((f) => (f.kind === "snapshot" ? f.topLine : undefined));

describe("reattachingDeltas", () => {
  it("yields the delta frames and ends on a graceful stream end", async () => {
    const initial = framesIter([delta("a"), delta("b")]);
    const open = (): Promise<OpenedAttach> => {
      throw new Error("must not re-attach on a graceful end");
    };
    const out = await collect(reattachingDeltas(open, initial));
    expect(data(out)).toEqual(["a", "b"]);
    // Plain deltas carry no re-seed.
    expect(out.every((f) => f.kind === "delta")).toBe(true);
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
    expect(topLines(out)).toEqual([undefined, 42, undefined]);
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
    expect(topLines(out)).toEqual([0, undefined, 10, undefined]);
  });

  it("ends cleanly when the PTY has vanished by the time we re-attach (PtyNotFound)", async () => {
    // A drop whose re-attach finds the PTY gone is a real end, not an error to
    // surface — the loop returns instead of throwing.
    const initial = framesIter([delta("x"), overflow]);
    const open = (): Promise<OpenedAttach> =>
      Promise.reject(new PtyNotFound({ id: "gone" }));
    expect(data(await collect(reattachingDeltas(open, initial)))).toEqual([
      "x",
    ]);
  });

  it("propagates any OTHER re-attach failure", async () => {
    const initial = framesIter([overflow]);
    const open = (): Promise<OpenedAttach> =>
      Promise.reject(new Error("transport exploded"));
    await expect(collect(reattachingDeltas(open, initial))).rejects.toThrow(
      "transport exploded",
    );
  });

  it("recognises a REHYDRATED PtyNotFound — the tag, not the constructor", async () => {
    // On the two per-terminal STREAM members `PtyNotFound` is UNDECLARED (a
    // `StreamSpec` has no error channel), so it can reach this loop as a bare
    // tagged value rather than a class instance — from another module realm, or
    // decoded off a wire. Matching the constructor would silently stop
    // recognising it there, turning "the PTY is gone, end cleanly" into a
    // failure propagated into a live attach stream.
    const initial = framesIter([delta("x"), overflow]);
    const open = (): Promise<OpenedAttach> =>
      Promise.reject({ _tag: "PtyNotFound", id: "gone" });
    expect(data(await collect(reattachingDeltas(open, initial)))).toEqual([
      "x",
    ]);
  });
});
