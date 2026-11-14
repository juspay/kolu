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
 * debug; and a non-attach tag passes through untouched. Beside the burst line
 * they pin the other two readings the line exists to serve: what an attachment
 * went on to COST after its first frame (the delta characters it forwarded and
 * the overflow re-syncs it skipped a replay through) — reported per attachment
 * at `debug` and FOLDED, one teardown to one `info` line, because `info` is
 * the level a deployment actually writes — and whether VIEWING resized
 * anything, counted per cause and only when the grid asked for actually moves.
 * The tags all of this hangs off are derived from `padiSurface` rather than
 * typed out, and the last test here is what makes that derivation honest: it
 * states them against the surface's own members, not against a copy of the
 * literal the wrapper used to carry.
 */

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

/** Subscribe to an attach for `id` and keep draining it in the background.
 *  `open` is the rest of the subscribe payload — the grid this viewer asserts
 *  and the cause it names — spelled the way the client sends it. The default
 *  asserts no readable grid, so an ordinary attach here moves nothing. */
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

    // Both open with a snapshot. Its characters are the SNAPSHOT's — a screen
    // the host serialized — and must never be counted as forwarded deltas.
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
    // kaval dropped this viewer for lagging and re-synced it: a SECOND snapshot
    // on the same attachment, i.e. one replay it skipped rather than read.
    await Effect.runPromise(
      Queue.offer(qa, { kind: "snapshot", data: "t".repeat(20) }),
    );
    await Effect.runPromise(Queue.offer(qa, { kind: "delta", data: "ghi" }));
    await settle();
    // Nothing is reported while the attachment lives — that is the whole reason
    // these facts cannot ride the burst line.
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
    // The attachment that only ever got its OWN opening snapshot skipped
    // nothing: the first snapshot is the attach, not a re-sync.
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

    // FIRST sight of this terminal is a baseline, not a resize: the wrapper
    // does not know what the pty was before it was watching.
    const base = attach(d, "a", { resizeTo: { cols: 80, rows: 24 } });
    await settle();
    // A pane opens it at its own, different grid — viewing resized the pty.
    const moved = attach(d, "a", { resizeTo: { cols: 136, rows: 40 } });
    await settle();
    // A host switch's re-assertions at the SAME grid. kaval no-ops them, so
    // however many arrive they are no resizes at all — this is the difference
    // between the line saying "1" and the line saying "14".
    const again = attach(d, "a", { resizeTo: { cols: 136, rows: 40 } });
    const againForeign = attach(d, "a", {
      resizeTo: { cols: 136, rows: 40 },
      cause: "foreign",
    });
    await settle();
    // The foreign-grid watcher re-asserting this pane's size over the other
    // viewer's: a real move, and the client says the watcher asked.
    const foreign = attach(d, "a", {
      resizeTo: { cols: 80, rows: 24 },
      cause: "foreign",
    });
    await settle();
    // A deliberate publish from a pane — a unary, forwarded untouched.
    expect(
      await Effect.runPromise(
        d.unary(LIFECYCLE_RESIZE_TAG, { id: "a", cols: 100, rows: 30 }),
      ),
    ).toBe("unary");

    for (const f of [base, moved, again, againForeign, foreign]) {
      await Effect.runPromise(Fiber.interrupt(f));
    }
    // The terminal's CUMULATIVE tally rides every attachment's end line, so the
    // bytes it carried and the resizes behind them read together.
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
    // kaval dropped `a` for lagging and re-synced it from a fresh screen: one
    // replay that viewer skipped rather than read.
    await Effect.runPromise(
      Queue.offer(qa, { kind: "snapshot", data: "v".repeat(60) }),
    );
    await settle();
    // A pane publishes a new grid for `a`. The attach above baselined it at
    // 80x24, so this one really moves the pty.
    await Effect.runPromise(
      d.unary(LIFECYCLE_RESIZE_TAG, { id: "a", cols: 136, rows: 40 }),
    );

    // The host switch away: every tile lets go at once.
    await vi.advanceTimersByTimeAsync(200);
    for (const f of fibers) await Effect.runPromise(Fiber.interrupt(f));
    // Still gathering — the ends wait for quiet exactly as the opens do.
    expect(endGroups()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1000);

    // ONE line, at `info`, carrying what viewing cost: three attachments over
    // three terminals, the screens they opened with, the output they went on to
    // forward, the replays they skipped and the resize behind them.
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
    // …and the per-attachment line still carries each one's OWN numbers, which
    // is what the summed line sends an operator looking for.
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
    // One tile lets go every 900 ms: the quiet timer is re-armed before it can
    // ever fire, so only the cap can report this group.
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
      // The whole 900-ms-apart trickle, reported at the cap rather than lost.
      endedOverMs: 4500,
      why: "cap",
    });
    // The cap reported it once; the trailing quiet timer reports nothing more.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(endGroups()).toHaveLength(1);
  });

  it("watches the tags the dispatch actually sees — the surface's own, envelope stripped", () => {
    // Stated against `padiSurface` rather than a copy of a literal: a renamed
    // member moves these expressions and the wrapper's together, so the two can
    // never agree on a tag that reaches no handler.
    expect(TERMINAL_ATTACH_TAG).toBe(
      surfaceTag(padiSurface.tagPrefix, "terminalAttach", "get"),
    );
    expect(LIFECYCLE_RESIZE_TAG).toBe(
      surfaceTag(padiSurface.tagPrefix, "lifecycle", "resize"),
    );
    // Both name a REAL member of the entry surface — the check a string literal
    // never had, and the reason a rename fails here instead of counting nothing.
    expect(padiSurface.group.requests.has(TERMINAL_ATTACH_TAG)).toBe(true);
    expect(padiSurface.group.requests.has(LIFECYCLE_RESIZE_TAG)).toBe(true);
    // And they are NOT the spelling the socket carries: a client dials these
    // members through the padi host map, under its mount prefix. `serveHostMap`
    // resolves that envelope and forwards the member to the per-host dispatch
    // this wrapper sits on, which is why the stripped form is the right one
    // here — watching the enveloped one would count nothing at all.
    const onTheSocket = scopeSiblingTag(TERMINAL_ATTACH_TAG, PADI_SURFACE_NAME);
    expect(onTheSocket).toBe(
      surfaceTag(padiHostMap.tagPrefix, "terminalAttach", "get"),
    );
    expect(onTheSocket).not.toBe(TERMINAL_ATTACH_TAG);
  });
});
