import type { Logger } from "@kolu/log";
import { padiSurface } from "@kolu/padi-client/surface";
import { scopeSiblingTag, surfaceTag } from "@kolu/surface/define";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { Effect, Fiber, Queue, Stream } from "effect";
import { PADI_SURFACE_NAME, padiHostMap } from "kolu-common/surfacesWithPadi";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIFECYCLE_RESIZE_TAG,
  TERMINAL_ATTACH_TAG,
  withAttachTelemetry,
} from "./attachTelemetry.ts";

type Frame = { kind: "snapshot" | "delta"; data: string };

function fakeUpstream() {
  const queues: Queue.Queue<Frame>[] = [];
  const tags: string[] = [];
  const dispatch: SurfaceDispatch = {
    unary: (tag) => {
      tags.push(tag);
      return Effect.succeed("unary");
    },
    stream: (tag) =>
      Stream.unwrap(
        Effect.map(Queue.unbounded<Frame>(), (q) => {
          tags.push(tag);
          queues.push(q);
          return Stream.fromQueue(q);
        }),
      ),
  };
  return { dispatch, queues, tags };
}

const logs = () => {
  const info = vi.fn<(obj: Record<string, unknown>, msg: string) => void>();
  const debug = vi.fn<(obj: Record<string, unknown>, msg: string) => void>();
  const log = { info, debug, warn: vi.fn(), error: vi.fn() } as Logger;
  const bursts = () =>
    info.mock.calls
      .filter(([, msg]) => msg === "terminal attach burst")
      .map(([obj]) => obj);
  const ends = () =>
    debug.mock.calls
      .filter(([, msg]) => msg === "terminal attach: end")
      .map(([obj]) => obj);
  const endGroups = () =>
    info.mock.calls
      .filter(([, msg]) => msg === "terminal attach: ends")
      .map(([obj]) => obj);
  return { log, info, debug, bursts, ends, endGroups };
};

const attach = (
  d: SurfaceDispatch,
  id: string,
  open: Record<string, unknown> = { resizeTo: {} },
) =>
  Effect.runFork(
    Stream.runDrain(d.stream(TERMINAL_ATTACH_TAG, { id, ...open })),
  );

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("withAttachTelemetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("folds a switch's attaches into one info line with sizes and first-frame latencies", async () => {
    const up = fakeUpstream();
    const { log, bursts, debug } = logs();
    const d = withAttachTelemetry(up.dispatch, {
      host: "remote:box",
      log,
      quietMs: 1000,
    });

    const fibers = [attach(d, "a"), attach(d, "b"), attach(d, "c")];
    await settle();
    expect(up.queues).toHaveLength(3);

    await vi.advanceTimersByTimeAsync(200);
    await Effect.runPromise(
      Queue.offer(up.queues[0] as Queue.Queue<Frame>, {
        kind: "snapshot",
        data: "x".repeat(100),
      }),
    );
    await Effect.runPromise(
      Queue.offer(up.queues[1] as Queue.Queue<Frame>, {
        kind: "snapshot",
        data: "y".repeat(300),
      }),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(300);
    await Effect.runPromise(
      Queue.offer(up.queues[2] as Queue.Queue<Frame>, {
        kind: "snapshot",
        data: "z".repeat(50),
      }),
    );
    await settle();
    await Effect.runPromise(
      Queue.offer(up.queues[0] as Queue.Queue<Frame>, {
        kind: "delta",
        data: "more",
      }),
    );
    await settle();
    expect(bursts()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1000);
    const [line] = bursts();
    expect(line).toMatchObject({
      host: "remote:box",
      attaches: 3,
      terminals: 3,
      snapshots: 3,
      snapshotChars: 450,
      firstFrameMs: { min: 200, median: 200, max: 500 },
      interruptedBeforeFrame: 0,
      failedBeforeFrame: 0,
      unanswered: 0,
      openedOverMs: 0,
      settledMs: 500,
      why: "answered",
    });
    expect(bursts()).toHaveLength(1);
    const firsts = debug.mock.calls.filter(
      ([, msg]) => msg === "terminal attach: first frame",
    );
    expect(firsts.map(([o]) => o.terminalId)).toEqual(["a", "b", "c"]);
    expect(firsts[1]?.[0]).toMatchObject({
      snapshotChars: 300,
      firstFrameMs: 200,
    });

    for (const f of fibers) await Effect.runPromise(Fiber.interrupt(f));
  });

  it("counts an attach the client interrupts before its answer, and its reopen joins the burst", async () => {
    const up = fakeUpstream();
    const { log, bursts } = logs();
    const d = withAttachTelemetry(up.dispatch, {
      host: "remote:box",
      log,
      quietMs: 1000,
    });

    const first = attach(d, "a");
    await settle();
    await vi.advanceTimersByTimeAsync(100);
    await Effect.runPromise(Fiber.interrupt(first));
    await vi.advanceTimersByTimeAsync(300);
    const second = attach(d, "a");
    await settle();
    await vi.advanceTimersByTimeAsync(50);
    await Effect.runPromise(
      Queue.offer(up.queues[1] as Queue.Queue<Frame>, {
        kind: "snapshot",
        data: "ok",
      }),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(1000);

    const [line] = bursts();
    expect(line).toMatchObject({
      attaches: 2,
      terminals: 1,
      snapshots: 1,
      interruptedBeforeFrame: 1,
      unanswered: 0,
      openedOverMs: 400,
      why: "answered",
    });
    await Effect.runPromise(Fiber.interrupt(second));
  });

  it("reports at the cap when the host never answers, naming how many it left waiting", async () => {
    const up = fakeUpstream();
    const { log, bursts } = logs();
    const d = withAttachTelemetry(up.dispatch, {
      host: "remote:box",
      log,
      quietMs: 1000,
      capMs: 5000,
    });

    const fibers = [attach(d, "a"), attach(d, "b")];
    await settle();
    await Effect.runPromise(
      Queue.offer(up.queues[0] as Queue.Queue<Frame>, {
        kind: "snapshot",
        data: "ok",
      }),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(4999);
    expect(bursts()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(bursts()[0]).toMatchObject({
      attaches: 2,
      snapshots: 1,
      unanswered: 1,
      settledMs: null,
      why: "cap",
    });
    await Effect.runPromise(
      Queue.offer(up.queues[1] as Queue.Queue<Frame>, {
        kind: "snapshot",
        data: "late",
      }),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(bursts()).toHaveLength(1);
    for (const f of fibers) await Effect.runPromise(Fiber.interrupt(f));
  });

  it("reports a lone attach at debug, not info", async () => {
    const up = fakeUpstream();
    const { log, bursts, debug } = logs();
    const d = withAttachTelemetry(up.dispatch, {
      host: "local",
      log,
      quietMs: 1000,
    });

    const f = attach(d, "solo");
    await settle();
    await Effect.runPromise(
      Queue.offer(up.queues[0] as Queue.Queue<Frame>, {
        kind: "snapshot",
        data: "hi",
      }),
    );
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    expect(bursts()).toHaveLength(0);
    const debugBursts = debug.mock.calls.filter(
      ([, msg]) => msg === "terminal attach burst",
    );
    expect(debugBursts).toHaveLength(1);
    expect(debugBursts[0]?.[0]).toMatchObject({ attaches: 1, snapshots: 1 });
    await Effect.runPromise(Fiber.interrupt(f));
  });

  it("passes every other tag through untouched and logs nothing for it", async () => {
    const up = fakeUpstream();
    const { log, info, debug } = logs();
    const d = withAttachTelemetry(up.dispatch, {
      host: "local",
      log,
      quietMs: 10,
    });

    expect(await Effect.runPromise(d.unary("surface/terminal/list", {}))).toBe(
      "unary",
    );
    const f = Effect.runFork(
      Stream.runDrain(d.stream("surface/terminals/get", { key: "k" })),
    );
    await settle();
    await Effect.runPromise(
      Queue.offer(up.queues[0] as Queue.Queue<Frame>, {
        kind: "delta",
        data: "row",
      }),
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(up.tags).toEqual(["surface/terminal/list", "surface/terminals/get"]);
    expect(info).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
    await Effect.runPromise(Fiber.interrupt(f));
  });

  it("reports an attachment's forwarded delta characters and its skip-aheads when it ends", async () => {
    const up = fakeUpstream();
    const { log, ends } = logs();
    const d = withAttachTelemetry(up.dispatch, {
      host: "local",
      log,
      quietMs: 1000,
    });

    const lagging = attach(d, "a");
    const quiet = attach(d, "b");
    await settle();
    const [qa, qb] = up.queues as [Queue.Queue<Frame>, Queue.Queue<Frame>];

    await Effect.runPromise(
      Queue.offer(qa, { kind: "snapshot", data: "s".repeat(50) }),
    );
    await Effect.runPromise(
      Queue.offer(qb, { kind: "snapshot", data: "q".repeat(10) }),
    );
    await settle();
    await Effect.runPromise(Queue.offer(qa, { kind: "delta", data: "abcd" }));
    await Effect.runPromise(Queue.offer(qa, { kind: "delta", data: "ef" }));
    await settle();
    await Effect.runPromise(
      Queue.offer(qa, { kind: "snapshot", data: "t".repeat(20) }),
    );
    await Effect.runPromise(Queue.offer(qa, { kind: "delta", data: "ghi" }));
    await settle();
    expect(ends()).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(400);
    await Effect.runPromise(Fiber.interrupt(lagging));
    await Effect.runPromise(Fiber.interrupt(quiet));
    expect(ends()[0]).toMatchObject({
      host: "local",
      terminalId: "a",
      snapshotChars: 50,
      deltaChars: 9,
      skipAheads: 1,
      livedMs: 400,
      endedBy: "interrupt",
    });
    expect(ends()[1]).toMatchObject({
      terminalId: "b",
      snapshotChars: 10,
      deltaChars: 0,
      skipAheads: 0,
    });
  });

  it("counts a resize only when the grid MOVES, and names who asked for it", async () => {
    const up = fakeUpstream();
    const { log, bursts, ends } = logs();
    const d = withAttachTelemetry(up.dispatch, {
      host: "local",
      log,
      quietMs: 1000,
    });

    const base = attach(d, "a", { resizeTo: { cols: 80, rows: 24 } });
    await settle();
    const moved = attach(d, "a", { resizeTo: { cols: 136, rows: 40 } });
    await settle();
    const again = attach(d, "a", { resizeTo: { cols: 136, rows: 40 } });
    const againForeign = attach(d, "a", {
      resizeTo: { cols: 136, rows: 40 },
      cause: "foreign",
    });
    await settle();
    const foreign = attach(d, "a", {
      resizeTo: { cols: 80, rows: 24 },
      cause: "foreign",
    });
    await settle();
    expect(
      await Effect.runPromise(
        d.unary(LIFECYCLE_RESIZE_TAG, { id: "a", cols: 100, rows: 30 }),
      ),
    ).toBe("unary");

    for (const f of [base, moved, again, againForeign, foreign]) {
      await Effect.runPromise(Fiber.interrupt(f));
    }
    expect(ends().at(-1)).toMatchObject({
      terminalId: "a",
      resizes: { attach: 1, foreign: 1, publish: 1 },
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(bursts()[0]).toMatchObject({
      attaches: 5,
      terminals: 1,
      resizes: { attach: 1, foreign: 1, publish: 1 },
      why: "answered",
    });
  });

  it("folds a teardown's ends into ONE info line, the breakdown staying at debug", async () => {
    const up = fakeUpstream();
    const { log, ends, endGroups } = logs();
    const d = withAttachTelemetry(up.dispatch, {
      host: "remote:box",
      log,
      quietMs: 1000,
    });

    const fibers = [
      attach(d, "a", { resizeTo: { cols: 80, rows: 24 } }),
      attach(d, "b"),
      attach(d, "c"),
    ];
    await settle();
    const [qa, qb, qc] = up.queues as [
      Queue.Queue<Frame>,
      Queue.Queue<Frame>,
      Queue.Queue<Frame>,
    ];
    await Effect.runPromise(
      Queue.offer(qa, { kind: "snapshot", data: "s".repeat(100) }),
    );
    await Effect.runPromise(
      Queue.offer(qb, { kind: "snapshot", data: "t".repeat(10) }),
    );
    await Effect.runPromise(
      Queue.offer(qc, { kind: "snapshot", data: "u".repeat(10) }),
    );
    await settle();
    await Effect.runPromise(Queue.offer(qa, { kind: "delta", data: "abcd" }));
    await Effect.runPromise(Queue.offer(qb, { kind: "delta", data: "xy" }));
    await Effect.runPromise(
      Queue.offer(qa, { kind: "snapshot", data: "v".repeat(60) }),
    );
    await settle();
    await Effect.runPromise(
      d.unary(LIFECYCLE_RESIZE_TAG, { id: "a", cols: 136, rows: 40 }),
    );

    await vi.advanceTimersByTimeAsync(200);
    for (const f of fibers) await Effect.runPromise(Fiber.interrupt(f));
    expect(endGroups()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);

    expect(endGroups()).toHaveLength(1);
    expect(endGroups()[0]).toMatchObject({
      host: "remote:box",
      ends: 3,
      terminals: 3,
      snapshotChars: 120,
      deltaChars: 6,
      skipAheads: 1,
      resizes: { attach: 0, foreign: 0, publish: 1 },
      livedMs: { min: 200, median: 200, max: 200 },
      endedOverMs: 0,
      why: "quiet",
    });
    expect(ends()).toHaveLength(3);
    expect(ends()[0]).toMatchObject({
      terminalId: "a",
      snapshotChars: 100,
      deltaChars: 4,
      skipAheads: 1,
    });
    expect(ends()[1]).toMatchObject({
      terminalId: "b",
      snapshotChars: 10,
      deltaChars: 2,
      skipAheads: 0,
    });
  });

  it("reports an end group at the cap when the ends never go quiet", async () => {
    const up = fakeUpstream();
    const { log, endGroups } = logs();
    const d = withAttachTelemetry(up.dispatch, {
      host: "local",
      log,
      quietMs: 1000,
      capMs: 5000,
    });

    const fibers = Array.from({ length: 6 }, (_, i) => attach(d, `t${i}`));
    await settle();
    for (const f of fibers.slice(0, 5)) {
      await Effect.runPromise(Fiber.interrupt(f));
      await vi.advanceTimersByTimeAsync(900);
    }
    for (const f of fibers.slice(5))
      await Effect.runPromise(Fiber.interrupt(f));
    await vi.advanceTimersByTimeAsync(499);
    expect(endGroups()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(endGroups()[0]).toMatchObject({
      ends: 6,
      terminals: 6,
      endedOverMs: 4500,
      why: "cap",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(endGroups()).toHaveLength(1);
  });

  it("watches the tags the dispatch actually sees — the surface's own, envelope stripped", () => {
    expect(TERMINAL_ATTACH_TAG).toBe(
      surfaceTag(padiSurface.tagPrefix, "terminalAttach", "get"),
    );
    expect(LIFECYCLE_RESIZE_TAG).toBe(
      surfaceTag(padiSurface.tagPrefix, "lifecycle", "resize"),
    );
    expect(padiSurface.group.requests.has(TERMINAL_ATTACH_TAG)).toBe(true);
    expect(padiSurface.group.requests.has(LIFECYCLE_RESIZE_TAG)).toBe(true);
    const onTheSocket = scopeSiblingTag(TERMINAL_ATTACH_TAG, PADI_SURFACE_NAME);
    expect(onTheSocket).toBe(
      surfaceTag(padiHostMap.tagPrefix, "terminalAttach", "get"),
    );
    expect(onTheSocket).not.toBe(TERMINAL_ATTACH_TAG);
  });
});
