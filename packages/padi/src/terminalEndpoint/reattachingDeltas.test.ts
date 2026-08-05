import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { PtyHostDataMsg } from "kaval";
import { PtyNotFound } from "kaval";
import { describe, expect, it } from "vitest";
import type { TerminalAttachFrame } from "../endpoint.ts";
import {
  type OpenedAttach,
  PLAIN_END_REOPEN_ATTEMPTS,
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

/** The loop's context: which terminal is being streamed (the label on the
 *  oscillation report) plus, where a test needs one, the consumer's teardown. */
const ctx = { id: "t-1" as TerminalId };

/** The PTY is gone — what kaval answers a re-open for a departed terminal, and
 *  therefore what makes a plain end a REAL exit. */
const ptyGone = (): Promise<OpenedAttach> =>
  Promise.reject(new PtyNotFound({ id: "gone" }));

describe("reattachingDeltas", () => {
  it("yields the delta frames and ends when the re-open finds the PTY gone", async () => {
    // A plain end is now a QUESTION: the loop asks kaval, kaval says the PTY is
    // gone, and THAT is what ends the stream — the exit, confirmed.
    const initial = framesIter([delta("a"), delta("b")]);
    let asked = 0;
    const open = (): Promise<OpenedAttach> => {
      asked++;
      return ptyGone();
    };
    const out = await collect(reattachingDeltas(open, initial, ctx));
    expect(data(out)).toEqual(["a", "b"]);
    // Plain deltas carry no re-seed.
    expect(out.every((f) => f.kind === "delta")).toBe(true);
    expect(asked).toBe(1);
  });

  it("ends on a plain end that OUR OWN abort caused — no re-open", async () => {
    // The consumer's teardown aborts the signal, which is what ends the kaval
    // iterator (`local.ts` bridges the abort onto `iter.return()`). Re-opening
    // there would resurrect a subscription the caller already released.
    const controller = new AbortController();
    controller.abort();
    const initial = framesIter([delta("a")]);
    const open = (): Promise<OpenedAttach> => {
      throw new Error("must not re-attach after the consumer aborted");
    };
    const out = await collect(
      reattachingDeltas(open, initial, { ...ctx, signal: controller.signal }),
    );
    expect(data(out)).toEqual(["a"]);
  });

  // ── The manufactured clean end (kolu#2101, deploy #2) ────────────────────
  //
  // A plain end (no `overflow` frame) while the PTY is ALIVE used to `return` —
  // a graceful end the client's failure-only retry layers could not act on, so
  // the tile sat blank with a live title and no verdict. kaval closes an attach
  // fan-out in exactly one place (the PTY's own exit teardown), so such an end
  // never came from a healthy host: it was manufactured by the chain, and the
  // repair is to ask again.

  it("plain end while the PTY is ALIVE → re-opens and keeps the frames flowing", async () => {
    const initial = framesIter([delta("before")]); // ends plainly, no overflow
    let opened = 0;
    const open = (): Promise<OpenedAttach> => {
      opened++;
      // The PTY answers: still here, here is a fresh snapshot.
      return Promise.resolve({
        snapshot: "FRESH",
        topLine: 7,
        iter: framesIter([delta("after")]),
      });
    };
    // The second leg also ends plainly; the PTY has exited by then.
    const out = await collect(
      reattachingDeltas(() => (opened === 0 ? open() : ptyGone()), initial, ctx),
    );
    expect(data(out)).toEqual(["before", `${TERMINAL_RESET}FRESH`, "after"]);
    expect(topLines(out)).toEqual([undefined, 7, undefined]);
  });

  it("throws LOUD once the plain-end re-open budget is exhausted", async () => {
    // A chain that keeps handing back attachments that end immediately and
    // deliver nothing. Ending cleanly here is the frozen pane; throwing hands
    // the tile to the client's failure machinery, which rebuilds the chain.
    const initial = framesIter([]);
    let opened = 0;
    const open = (): Promise<OpenedAttach> => {
      opened++;
      return Promise.resolve({
        snapshot: "EMPTY",
        topLine: 0,
        iter: framesIter([]),
      });
    };
    await expect(collect(reattachingDeltas(open, initial, ctx))).rejects.toThrow(
      /ended with no overflow frame and no PTY exit/,
    );
    expect(opened).toBe(PLAIN_END_REOPEN_ATTEMPTS);
  });

  it("a leg that DELIVERED frames refills the plain-end budget", async () => {
    // Odd-but-flowing is working: every leg ends plainly, but each one carries a
    // frame, so the loop never exhausts its budget. It runs well past
    // PLAIN_END_REOPEN_ATTEMPTS legs and then ends on the real exit.
    const legs = 6;
    let opened = 0;
    const open = (): Promise<OpenedAttach> => {
      if (opened++ >= legs) return ptyGone();
      return Promise.resolve({
        snapshot: `S${opened}`,
        topLine: opened,
        iter: framesIter([delta(`d${opened}`)]),
      });
    };
    const out = await collect(
      reattachingDeltas(open, framesIter([delta("0")]), ctx),
    );
    expect(out.filter((f) => f.kind === "delta").length).toBe(legs + 1);
  });

  it("re-attaches on an `overflow` frame, prefixing a reset + re-seeding topLine", async () => {
    // First leg drops after one delta; the re-attach delivers a fresh snapshot
    // (with its own seed) and one more delta, then ends gracefully.
    const initial = framesIter([delta("before"), overflow]);
    let opened = 0;
    const open = (): Promise<OpenedAttach> => {
      // The second leg ends plainly too, and the loop asks again — by then the
      // PTY has exited, which is what ends the stream.
      if (opened++ > 0) return ptyGone();
      return Promise.resolve({
        snapshot: "FRESH",
        topLine: 42,
        iter: framesIter([delta("after")]),
      });
    };
    const out = await collect(reattachingDeltas(open, initial, ctx));
    // The dropped subscriber's delta is delivered; then the reset-prefixed fresh
    // snapshot replaces the screen AND re-seeds the backfill cursor; then deltas.
    expect(data(out)).toEqual(["before", `${TERMINAL_RESET}FRESH`, "after"]);
    expect(topLines(out)).toEqual([undefined, 42, undefined]);
    // Two asks: the overflow re-attach, then the liveness question the second
    // leg's plain end raises — answered "the PTY is gone", which ends the stream.
    expect(opened).toBe(2);
  });

  it("re-attaches repeatedly across successive drops", async () => {
    const initial = framesIter([overflow]);
    const legs: PtyHostDataMsg[][] = [[delta("one"), overflow], [delta("two")]];
    let leg = 0;
    const open = (): Promise<OpenedAttach> => {
      // Past the scripted legs the PTY is gone — the plain end of the last leg
      // is a question, and this is the answer that ends the stream.
      if (leg >= legs.length) return ptyGone();
      return Promise.resolve({
        snapshot: `S${leg}`,
        topLine: leg * 10,
        iter: framesIter(legs[leg++] as PtyHostDataMsg[]),
      });
    };
    const out = await collect(reattachingDeltas(open, initial, ctx));
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
    expect(data(await collect(reattachingDeltas(open, initial, ctx)))).toEqual([
      "x",
    ]);
  });

  it("propagates any OTHER re-attach failure", async () => {
    const initial = framesIter([overflow]);
    const open = (): Promise<OpenedAttach> =>
      Promise.reject(new Error("transport exploded"));
    await expect(collect(reattachingDeltas(open, initial, ctx))).rejects.toThrow(
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
    expect(data(await collect(reattachingDeltas(open, initial, ctx)))).toEqual([
      "x",
    ]);
  });
});
