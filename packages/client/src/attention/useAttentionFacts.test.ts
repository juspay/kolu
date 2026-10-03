import { batch, createRoot, createSignal } from "solid-js";
import { expect, it, vi } from "vitest";
import { hostFrame } from "./attentionMarks";
import type { TerminalId } from "kolu-common/surface";
const source = vi.hoisted(() => ({
  pending: (): boolean => true,
  ids: () => [] as TerminalId[],
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
            value: () => ({
              awaitingIds: [],
              workingIds: [],
              finishedIds: [],
              lingerIds: [],
            }),
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
it("does not publish an empty live set while the activity stream is pending", async () => {
  await new Promise<void>((resolve, reject) =>
    createRoot((dispose) => {
      const [pending, setPending] = createSignal(true);
      const [ids, setIds] = createSignal<TerminalId[]>([]);
      source.pending = pending;
      source.ids = ids;
      useAttentionFacts();
      queueMicrotask(() => {
        try {
          expect(hostFrame("local").reported).toBe(false);
          batch(() => {
            setIds(["a"]);
            setPending(false);
          });
          expect(hostFrame("local").liveIds).toEqual(["a"]);
          batch(() => {
            setPending(true);
            setIds([]);
          });
          expect(hostFrame("local").liveIds).toEqual(["a"]);
          expect(hostFrame("local").reported).toBe(true);
          setPending(false);
          expect(hostFrame("local").liveIds).toEqual([]);
          dispose();
          resolve();
        } catch (error) {
          dispose();
          reject(error);
        }
      });
    }),
  );
});
