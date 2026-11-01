/**
 * What one host's attach burst line says — and that nothing else changes.
 *
 * The wrapper sits on one host's dispatch and times `terminalAttach`
 * subscriptions by burst. These pin the line's facts to the wire events that
 * produce them: a switch's attaches fold into one burst with the snapshot
 * sizes and first-frame latencies the host answered with; an attach the client
 * interrupts before an answer (a re-measured tile's second round) is counted
 * as such and its reopen joins the same burst; a host that never answers is
 * reported at the cap with the unanswered count; a lone attach reports at
 * debug; and a non-attach tag passes through untouched.
 */

import type { Logger } from "@kolu/log";
import type { SurfaceDispatch } from "@kolu/surface/link";
import { Effect, Fiber, Queue, Stream } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TERMINAL_ATTACH_TAG, withAttachTelemetry } from "./attachTelemetry.ts";

type Frame = { kind: "snapshot" | "delta"; data: string };

/** A fake per-host dispatch whose attach streams are queues the test feeds:
 *  one queue per subscribe, in order, so the test answers each attach by hand. */
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
  return { log, info, debug, bursts };
};

/** Subscribe to an attach for `id` and keep draining it in the background. */
const attach = (d: SurfaceDispatch, id: string) =>
  Effect.runFork(
    Stream.runDrain(d.stream(TERMINAL_ATTACH_TAG, { id, resizeTo: {} })),
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

    // The host answers over 500 ms: a 100-char and a 300-char snapshot, then a
    // third 200 ms later.
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
    // A later delta is not a first frame and changes nothing.
    await Effect.runPromise(
      Queue.offer(up.queues[0] as Queue.Queue<Frame>, {
        kind: "delta",
        data: "more",
      }),
    );
    await settle();
    expect(bursts()).toHaveLength(0);

    // Quiet for a second after the last attach opened → the burst reports.
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
    // One per-attach debug line each, naming the terminal.
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
    // The tile re-measured: it drops this attach unanswered and opens another.
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
    // A late answer after the report starts nothing and crashes nothing.
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
});
