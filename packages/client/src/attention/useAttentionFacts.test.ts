import { createRoot, createSignal } from "solid-js";
import { expect, it, vi } from "vitest";
import { hostFrame } from "./attentionMarks";
import type { PadiUrgency } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
const source = vi.hoisted(() => ({
  pending: (): boolean => true,
  ids: () => [] as TerminalId[],
  urgency: (): PadiUrgency | undefined => ({
    awaitingIds: [],
    workingIds: [],
    finishedIds: [],
    lingerIds: [],
    settled: true,
  }),
}));
vi.mock("../createSharedRoot", () => ({
  createSharedRoot: (build: () => unknown) => build,
}));
vi.mock("../wire", () => ({
  hostKeys: () => [{ kind: "local" }],
  padiMap: {
    entry: () => ({
      state: () => ({ kind: "connected" }),
      cells: {
        urgency: {
          use: () => ({
            value: () => source.urgency(),
            sub: { error: () => undefined, complete: () => false },
          }),
        },
      },
      streams: {
        activity: {
          use: () =>
            Object.assign(() => source.ids(), {
              pending: () => source.pending(),
            }),
        },
      },
    }),
  },
}));
import { useAttentionFacts } from "./useAttentionFacts";

/** Run `body` inside a root that holds the mirror, after the mirror's own
 *  effects have run once. */
function withMirror(body: () => void): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  createRoot((dispose) => {
    useAttentionFacts();
    queueMicrotask(() => {
      try {
        body();
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        dispose();
      }
    });
  });
  return promise;
}

const frame = (over: Partial<PadiUrgency>): PadiUrgency => ({
  awaitingIds: [],
  workingIds: [],
  finishedIds: [],
  lingerIds: [],
  settled: true,
  ...over,
});

it("does not publish an empty live set while the activity stream is pending", async () => {
  const [pending, setPending] = createSignal(true);
  const [ids, setIds] = createSignal<TerminalId[]>([]);
  source.pending = pending;
  source.ids = ids;
  source.urgency = () => frame({});
  await withMirror(() => {
    expect(hostFrame("local").reported).toBe(false);
    setIds(["a"]);
    setPending(false);
    expect(hostFrame("local").liveIds).toEqual(["a"]);
    setPending(true);
    setIds([]);
    expect(hostFrame("local").liveIds).toEqual(["a"]);
    expect(hostFrame("local").reported).toBe(true);
    setPending(false);
    expect(hostFrame("local").liveIds).toEqual([]);
  });
});

it("takes no unsettled frame as a report — padi has not looked yet", async () => {
  source.pending = () => false;
  source.ids = () => [];
  const [urgency, setUrgency] = createSignal<PadiUrgency>(
    frame({ settled: false }),
  );
  source.urgency = urgency;
  await withMirror(() => {
    // Empty because nobody has looked: the attention engine must not take
    // it as the baseline it later diffs a real frame against.
    expect(hostFrame("local").reported).toBe(false);
    setUrgency(frame({ finishedIds: ["a"] }));
    expect(hostFrame("local").reported).toBe(true);
    expect(hostFrame("local").byClass.finished).toEqual(["a"]);
  });
});

it("holds the last settled reading across an unsettled frame — a redeploy does not blink every mark to idle", async () => {
  source.pending = () => false;
  source.ids = () => [];
  const [urgency, setUrgency] = createSignal<PadiUrgency>(
    frame({ finishedIds: ["a"], workingIds: ["b"] }),
  );
  source.urgency = urgency;
  await withMirror(() => {
    const before = hostFrame("local").byClass;
    expect(before.finished).toEqual(["a"]);
    // The fresh padi's first frames: nothing adopted, nothing read.
    setUrgency(frame({ settled: false }));
    expect(hostFrame("local").byClass).toBe(before);
    expect(hostFrame("local").reported).toBe(true);
    // It has looked: the reading moves again.
    setUrgency(frame({ finishedIds: ["a"] }));
    expect(hostFrame("local").byClass.working).toEqual([]);
  });
});
