import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { createEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

// `useTerminalMetadata` pulls `app` (a live surface socket) and `solid-sonner`
// (a toast DOM) at import time. Stub both so the hook loads under Node, and
// drive the per-key `terminalMetadata` collection through a hoisted, signal-
// backed bag — flipping a field or the id set re-runs the real `terminalIds`
// memo the way a server delta would, so a test observes its `equals` gate.
type TestMeta = Partial<TerminalMetadata>;
const bag = vi.hoisted(() => ({
  // Late-bound to module-scope signals once solid-js is imported (below). The
  // mock reads through these so the memo tracks them as reactive sources.
  keys: (() => [] as TerminalId[]) as () => TerminalId[],
  metaOf: (() => undefined) as (id: TerminalId) => TestMeta | undefined,
}));

vi.mock("../wire", () => ({
  app: {
    collections: {
      terminalMetadata: {
        // Surface `{ keys, byKey }` shape (see useCollection.ts). `byKey`
        // returns an accessor when the id has metadata, else undefined.
        use: () => ({
          keys: () => bag.keys(),
          byKey: (id: TerminalId) =>
            bag.metaOf(id) !== undefined ? () => bag.metaOf(id) : undefined,
        }),
      },
    },
  },
}));
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  }),
}));

import {
  sameTerminalIdOrder,
  useTerminalMetadata,
} from "./useTerminalMetadata";

const tids = (...xs: string[]) => xs as TerminalId[];
/** Solid flushes `createEffect` on a microtask; a macrotask tick drains it. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("sameTerminalIdOrder", () => {
  it("is true for the same ids in the same order", () => {
    expect(sameTerminalIdOrder(tids("a", "b", "c"), tids("a", "b", "c"))).toBe(
      true,
    );
  });

  it("is true for two empty lists", () => {
    expect(sameTerminalIdOrder(tids(), tids())).toBe(true);
  });

  it("is false when the order differs (position labels depend on order)", () => {
    expect(sameTerminalIdOrder(tids("a", "b"), tids("b", "a"))).toBe(false);
  });

  it("is false when an id is added", () => {
    expect(sameTerminalIdOrder(tids("a", "b"), tids("a", "b", "c"))).toBe(
      false,
    );
  });

  it("is false when an id is removed", () => {
    expect(sameTerminalIdOrder(tids("a", "b", "c"), tids("a", "b"))).toBe(
      false,
    );
  });

  it("is false when an id is swapped for another", () => {
    expect(sameTerminalIdOrder(tids("a", "b"), tids("a", "x"))).toBe(false);
  });
});

describe("terminalIds reference stability (the #1422 reactivity keystone)", () => {
  // Drives the REAL `terminalIds` memo (not a reconstruction): the
  // signal-backed mock feeds metadata into the hook, and a subscribing effect
  // counts how often a downstream dependant re-runs. The `equals` gate
  // (`sameTerminalIdOrder`) must keep the prior array reference — so the effect
  // does NOT re-run — when a metadata change leaves the top-level id set
  // identical. This is the regression #1422 guards against.
  // `cwd` is read by the eagerly-computed `displayInfos` memo (via
  // `terminalKey` → `shortenCwd`), so it must be a string even though these
  // tests only assert on the `terminalIds` set.
  function meta(overrides: TestMeta = {}): TestMeta {
    return { cwd: "/home/user/p", parentId: undefined, ...overrides };
  }

  it("keeps the reference (no downstream re-run) when only a metadata field changes", async () => {
    await createRoot(async (dispose) => {
      const [keys] = createSignal(tids("a", "b"));
      const [store, setStore] = createSignal<Record<string, TestMeta>>({
        a: meta(),
        b: meta(),
      });
      bag.keys = keys;
      bag.metaOf = (id) => store()[id];

      const { terminalIds } = useTerminalMetadata({
        list: () => keys().map((id) => ({ id }) as never),
        activeId: () => null,
      });

      let downstreamRuns = 0;
      let lastRef: TerminalId[] = [];
      createEffect(() => {
        downstreamRuns++;
        lastRef = terminalIds();
      });
      await flush();
      expect(downstreamRuns).toBe(1);
      const prevRef = lastRef;

      // A git/PR/agent field updates on one terminal; the id set is identical.
      setStore((s) => ({ ...s, a: meta({ lastActivityAt: 42 }) }));
      await flush();
      expect(Object.is(prevRef, lastRef)).toBe(true);
      expect(downstreamRuns).toBe(1);

      dispose();
    });
  });

  it("changes the reference (downstream re-runs) when an id is added or removed", async () => {
    await createRoot(async (dispose) => {
      const [keys, setKeys] = createSignal(tids("a", "b"));
      const [store, setStore] = createSignal<Record<string, TestMeta>>({
        a: meta(),
        b: meta(),
      });
      bag.keys = keys;
      bag.metaOf = (id) => store()[id];

      const { terminalIds } = useTerminalMetadata({
        list: () => keys().map((id) => ({ id }) as never),
        activeId: () => null,
      });

      let downstreamRuns = 0;
      let lastRef: TerminalId[] = [];
      createEffect(() => {
        downstreamRuns++;
        lastRef = terminalIds();
      });
      await flush();
      const refAfterTwo = lastRef;
      expect(downstreamRuns).toBe(1);

      setStore((s) => ({ ...s, c: meta() }));
      setKeys(tids("a", "b", "c")); // a terminal was created
      await flush();
      expect(Object.is(refAfterTwo, lastRef)).toBe(false);
      expect(downstreamRuns).toBe(2);
      const refAfterThree = lastRef;

      setKeys(tids("a", "b")); // "c" closed
      await flush();
      expect(Object.is(refAfterThree, lastRef)).toBe(false);
      expect(downstreamRuns).toBe(3);

      dispose();
    });
  });

  it("changes the reference (downstream re-runs) when the set is reordered", async () => {
    await createRoot(async (dispose) => {
      const [keys, setKeys] = createSignal(tids("a", "b", "c"));
      const [store] = createSignal<Record<string, TestMeta>>({
        a: meta(),
        b: meta(),
        c: meta(),
      });
      bag.keys = keys;
      bag.metaOf = (id) => store()[id];

      const { terminalIds } = useTerminalMetadata({
        list: () => keys().map((id) => ({ id }) as never),
        activeId: () => null,
      });

      let downstreamRuns = 0;
      let lastRef: TerminalId[] = [];
      createEffect(() => {
        downstreamRuns++;
        lastRef = terminalIds();
      });
      await flush();
      const prevRef = lastRef;
      expect(downstreamRuns).toBe(1);

      setKeys(tids("c", "b", "a")); // order drives sidebar position labels
      await flush();
      expect(Object.is(prevRef, lastRef)).toBe(false);
      expect(downstreamRuns).toBe(2);

      dispose();
    });
  });
});
