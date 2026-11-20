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
const resized = (cols: number, rows: number): PtyHostDataMsg => ({
  kind: "resized",
  grid: { cols, rows },
});
const GRID = { cols: 80, rows: 24 };

async function collect(
  gen: AsyncGenerator<TerminalAttachFrame>,
): Promise<TerminalAttachFrame[]> {
  const out: TerminalAttachFrame[] = [];
  for await (const f of gen) out.push(f);
  return out;
}
const data = (out: TerminalAttachFrame[]) =>
  out.map((f) => (f.kind === "resized" ? undefined : f.data));
const tags = (out: TerminalAttachFrame[]) =>
  out.map((f) =>
    f.kind === "resized"
      ? `resized:${f.grid.cols}x${f.grid.rows}`
      : `${f.kind}:${f.data}`,
  );
const topLines = (out: TerminalAttachFrame[]) =>
  out.map((f) => (f.kind === "snapshot" ? f.topLine : undefined));

const ctx = { id: "t-1" as TerminalId };

const ptyGone = (): Promise<OpenedAttach> =>
  Promise.reject(new PtyNotFound({ id: "gone" }));

describe("reattachingDeltas", () => {
  it("yields the delta frames and ends when the re-open finds the PTY gone", async () => {
    const initial = framesIter([delta("a"), delta("b")]);
    let asked = 0;
    const open = (): Promise<OpenedAttach> => {
      asked++;
      return ptyGone();
    };
    const out = await collect(reattachingDeltas(open, initial, ctx));
    expect(data(out)).toEqual(["a", "b"]);
    expect(out.every((f) => f.kind === "delta")).toBe(true);
    expect(asked).toBe(1);
  });

  it("ends on a plain end that OUR OWN abort caused — no re-open", async () => {
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

  it("plain end while the PTY is ALIVE → re-opens and keeps the frames flowing", async () => {
    const initial = framesIter([delta("before")]);
    let opened = 0;
    const open = (): Promise<OpenedAttach> => {
      opened++;
      return Promise.resolve({
        snapshot: "FRESH",
        topLine: 7,
        grid: GRID,
        iter: framesIter([delta("after")]),
      });
    };
    const out = await collect(
      reattachingDeltas(
        () => (opened === 0 ? open() : ptyGone()),
        initial,
        ctx,
      ),
    );
    expect(data(out)).toEqual(["before", `${TERMINAL_RESET}FRESH`, "after"]);
    expect(topLines(out)).toEqual([undefined, 7, undefined]);
  });

  it("throws LOUD once the plain-end re-open budget is exhausted", async () => {
    const initial = framesIter([]);
    let opened = 0;
    const open = (): Promise<OpenedAttach> => {
      opened++;
      return Promise.resolve({
        snapshot: "EMPTY",
        topLine: 0,
        grid: GRID,
        iter: framesIter([]),
      });
    };
    await expect(
      collect(reattachingDeltas(open, initial, ctx)),
    ).rejects.toThrow(/ended with no overflow frame and no PTY exit/);
    expect(opened).toBe(PLAIN_END_REOPEN_ATTEMPTS);
  });

  it("a leg that DELIVERED frames refills the plain-end budget", async () => {
    const legs = 6;
    let opened = 0;
    const open = (): Promise<OpenedAttach> => {
      if (opened++ >= legs) return ptyGone();
      return Promise.resolve({
        snapshot: `S${opened}`,
        topLine: opened,
        grid: GRID,
        iter: framesIter([delta(`d${opened}`)]),
      });
    };
    const out = await collect(
      reattachingDeltas(open, framesIter([delta("0")]), ctx),
    );
    expect(out.filter((f) => f.kind === "delta").length).toBe(legs + 1);
  });

  it("re-attaches on an `overflow` frame, prefixing a reset + re-seeding topLine", async () => {
    const initial = framesIter([delta("before"), overflow]);
    let opened = 0;
    const open = (): Promise<OpenedAttach> => {
      if (opened++ > 0) return ptyGone();
      return Promise.resolve({
        snapshot: "FRESH",
        topLine: 42,
        grid: GRID,
        iter: framesIter([delta("after")]),
      });
    };
    const out = await collect(reattachingDeltas(open, initial, ctx));
    expect(data(out)).toEqual(["before", `${TERMINAL_RESET}FRESH`, "after"]);
    expect(topLines(out)).toEqual([undefined, 42, undefined]);
    expect(opened).toBe(2);
  });

  it("re-attaches repeatedly across successive drops", async () => {
    const initial = framesIter([overflow]);
    const legs: PtyHostDataMsg[][] = [[delta("one"), overflow], [delta("two")]];
    let leg = 0;
    const open = (): Promise<OpenedAttach> => {
      if (leg >= legs.length) return ptyGone();
      return Promise.resolve({
        snapshot: `S${leg}`,
        topLine: leg * 10,
        grid: GRID,
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
    await expect(
      collect(reattachingDeltas(open, initial, ctx)),
    ).rejects.toThrow("transport exploded");
  });

  it("recognises a REHYDRATED PtyNotFound — the tag, not the constructor", async () => {
    const initial = framesIter([delta("x"), overflow]);
    const open = (): Promise<OpenedAttach> =>
      Promise.reject({ _tag: "PtyNotFound", id: "gone" });
    expect(data(await collect(reattachingDeltas(open, initial, ctx)))).toEqual([
      "x",
    ]);
  });

  it("relays a resize in its place in the byte stream", async () => {
    const initial = framesIter([
      delta("before"),
      resized(100, 30),
      delta("after"),
    ]);
    const out = await collect(reattachingDeltas(ptyGone, initial, ctx));
    expect(tags(out)).toEqual([
      "delta:before",
      "resized:100x30",
      "delta:after",
    ]);
  });

  it("keeps successive resizes distinct and in order", async () => {
    const initial = framesIter([
      resized(100, 30),
      delta("a"),
      resized(70, 20),
      delta("b"),
    ]);
    const out = await collect(reattachingDeltas(ptyGone, initial, ctx));
    expect(tags(out)).toEqual([
      "resized:100x30",
      "delta:a",
      "resized:70x20",
      "delta:b",
    ]);
  });

  it("relays resizes on both sides of an overflow re-attach", async () => {
    const initial = framesIter([resized(100, 30), delta("before"), overflow]);
    let opened = 0;
    const open = (): Promise<OpenedAttach> => {
      if (opened++ > 0) return ptyGone();
      return Promise.resolve({
        snapshot: "FRESH",
        topLine: 42,
        grid: { cols: 100, rows: 30 },
        iter: framesIter([delta("after"), resized(70, 20), delta("tail")]),
      });
    };
    const out = await collect(reattachingDeltas(open, initial, ctx));
    expect(tags(out)).toEqual([
      "resized:100x30",
      "delta:before",
      `snapshot:${TERMINAL_RESET}FRESH`,
      "delta:after",
      "resized:70x20",
      "delta:tail",
    ]);
    const snapshot = out.find((f) => f.kind === "snapshot");
    expect(snapshot).toMatchObject({ grid: { cols: 100, rows: 30 } });
  });

  it("ends when a re-open describes no screen (the consumer aborted mid-open)", async () => {
    const initial = framesIter([delta("x"), overflow]);
    const open = (): Promise<OpenedAttach> =>
      Promise.resolve({
        snapshot: "",
        topLine: 0,
        grid: null,
        iter: framesIter([delta("never")]),
      });
    const out = await collect(reattachingDeltas(open, initial, ctx));
    expect(tags(out)).toEqual(["delta:x"]);
  });
});
