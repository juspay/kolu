import type { TerminalInfo, TerminalMetadata } from "@kolu/padi-client/surface";
import { Stream } from "effect";
import { decodeHostKey, encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, createRoot, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { describe, expect, it, vi } from "vitest";

type TestMeta = Partial<TerminalMetadata>;
const bag = vi.hoisted(() => {
  return {
    keys: (() => [] as TerminalId[]) as () => TerminalId[],
    metaOf: (() => undefined) as (id: TerminalId) => TestMeta | undefined,
    clockOffset: (() => 0) as () => number | null,
  };
});

vi.mock("../wire", () => {
  const terminals = {
    use: () => ({
      keys: () => bag.keys(),
      byKey: (id: TerminalId) =>
        bag.metaOf(id) !== undefined
          ? () => ({
              state: "active",
              git: { kind: "none" },
              ...(bag.metaOf(id) as TestMeta),
            })
          : undefined,
    }),
    unenrolledKeys: () => Stream.never,
  };
  const stubCell = {
    use: () => ({
      value: () => undefined,
      sub: Object.assign(() => undefined, {
        pending: () => false,
        error: () => undefined,
        complete: () => false,
      }),
    }),
  };
  const stubCollection = {
    use: () => ({ keys: () => [], byKey: () => undefined }),
  };
  const entry = () => ({
    clock: {
      toLocal: (ms: number) => {
        const off = bag.clockOffset();
        return off === null ? null : ms - off;
      },
    },
    collections: { terminals, daemonStatus: stubCollection },
    cells: { session: stubCell, roster: stubCell, activityFeed: stubCell },
    procedures: { chrome: { setActive: async () => {} } },
  });
  return {
    padiMap: {
      entries: {
        use: () => ({ keys: () => [LOCAL_HOST], byKey: () => undefined }),
      },
      codec: { encode: encodeHostKey, decode: decodeHostKey },
      live: () => true,
      entry,
      useEntry: entry,
    },
    activeHost: () => LOCAL_HOST,
    groundedActiveHost: () => LOCAL_HOST,
  };
});
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  }),
}));

import type { PaneNode } from "./terminalTree";
import {
  sameTerminalIdOrder,
  useTerminalMetadata,
} from "./useTerminalMetadata";

const tids = (...xs: string[]) => xs as TerminalId[];
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("root-ancestor flatten vs nested pane tree (#2059)", () => {
  function meta(overrides: TestMeta = {}): TestMeta {
    return { cwd: "/home/user/p", parentId: undefined, ...overrides };
  }

  function drive(parents: Record<string, string | undefined>): {
    terminalIds: () => TerminalId[];
    getSplitPaneIds: (id: TerminalId) => TerminalId[];
    getPaneTree: (id: TerminalId) => readonly PaneNode[];
    dispose: () => void;
  } {
    return createRoot((dispose) => {
      const ids = tids(...Object.keys(parents));
      bag.keys = () => ids;
      bag.metaOf = (id) =>
        meta({
          parentId: parents[id as string] as TerminalId | undefined,
        });
      const { terminalIds, getSplitPaneIds, getPaneTree } = useTerminalMetadata(
        {
          list: () => ids.map((id) => ({ id }) as TerminalInfo),
        },
      );
      return { terminalIds, getSplitPaneIds, getPaneTree, dispose };
    });
  }

  it("flattens a 3-deep chain under the root in server order", () => {
    const h = drive({ R: undefined, M: "R", G: "M", C: "R" });
    expect(h.terminalIds()).toEqual(tids("R"));
    expect(h.getSplitPaneIds(tids("R")[0]!)).toEqual(tids("M", "G", "C"));
    h.dispose();
  });

  it("paints a cycle as top-level tiles (never hides them)", () => {
    const h = drive({ A: "B", B: "A" });
    expect(h.terminalIds()).toEqual(tids("A", "B"));
    expect(h.getSplitPaneIds(tids("A")[0]!)).toEqual([]);
    expect(h.getSplitPaneIds(tids("B")[0]!)).toEqual([]);
    expect(h.getPaneTree(tids("A")[0]!)).toEqual([]);
    expect(h.getPaneTree(tids("B")[0]!)).toEqual([]);
    h.dispose();
  });

  it("hands the Dock the SAME panes as the canvas, nested by their real parent", () => {
    const h = drive({ R: undefined, M: "R", G: "M", C: "R" });
    const root = tids("R")[0]!;
    expect(h.getPaneTree(root)).toEqual([
      { id: "M", children: [{ id: "G", children: [] }] },
      { id: "C", children: [] },
    ]);
    const flattened = (nodes: readonly PaneNode[]): TerminalId[] =>
      nodes.flatMap((n) => [n.id, ...flattened(n.children)]);
    expect(flattened(h.getPaneTree(root)).sort()).toEqual(
      [...h.getSplitPaneIds(root)].sort(),
    );
    h.dispose();
  });

  it("keeps descendants of a sleeping middle under the live root (canvas never swallows them)", () => {
    const h = drive({ R: undefined, M: "R", G: "M" });
    expect(h.getSplitPaneIds(tids("R")[0]!)).toEqual(tids("M", "G"));
    h.dispose();
  });
});

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
        list: () => keys().map((id) => ({ id }) as TerminalInfo),
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
        list: () => keys().map((id) => ({ id }) as TerminalInfo),
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
      setKeys(tids("a", "b", "c"));
      await flush();
      expect(Object.is(refAfterTwo, lastRef)).toBe(false);
      expect(downstreamRuns).toBe(2);
      const refAfterThree = lastRef;

      setKeys(tids("a", "b"));
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
        list: () => keys().map((id) => ({ id }) as TerminalInfo),
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

      setKeys(tids("c", "b", "a"));
      await flush();
      expect(Object.is(prevRef, lastRef)).toBe(false);
      expect(downstreamRuns).toBe(2);

      dispose();
    });
  });
});

describe("getMetadata clock reprojection (the foreign-clock ingestion boundary)", () => {
  const START = 1_700_000_000_000;
  const agentMeta = {
    cwd: "/p",
    lastActivityAt: START,
    agent: { kind: "claude_code", state: "thinking", startedAt: START },
  } as unknown as TestMeta;

  function readReprojected(
    offset: number | null,
    meta: TestMeta = agentMeta,
  ): TerminalMetadata | undefined {
    return createRoot((dispose) => {
      bag.keys = () => tids("a");
      bag.metaOf = () => meta;
      bag.clockOffset = () => offset;
      const { getMetadata } = useTerminalMetadata({
        list: () => tids("a").map((id) => ({ id }) as TerminalInfo),
      });
      const out = getMetadata(tids("a")[0] as TerminalId);
      dispose();
      return out;
    });
  }

  it("reprojects a +90s-skewed host's epochs onto the browser clock (sane, single translation)", () => {
    const out = readReprojected(90_000);
    expect(out?.lastActivityAt).toBe(START - 90_000);
    expect((out as { agent?: { startedAt: number } })?.agent?.startedAt).toBe(
      START - 90_000,
    );
  });

  it("collapses a warming host (null offset) to the ABSENT form, never a raw remote epoch", () => {
    const out = readReprojected(null);
    expect(out?.lastActivityAt).toBeUndefined();
    expect((out as { agent?: { startedAt: number } })?.agent?.startedAt).toBe(
      0,
    );
  });

  it("reprojects the sleeping arm's sleptAt too (the 'asleep 3d' + dock-recency epoch)", () => {
    const sleeping = { cwd: "/p", sleptAt: START } as unknown as TestMeta;
    expect(
      (readReprojected(90_000, sleeping) as { sleptAt?: number })?.sleptAt,
    ).toBe(START - 90_000);
    expect(
      (readReprojected(null, sleeping) as { sleptAt?: number })?.sleptAt,
    ).toBe(0);
  });

  it("PRESERVES the lastActivityAt:0 sentinel (never-had-agent) — a real offset must NOT forge -offset", () => {
    const noAgent = { cwd: "/p", lastActivityAt: 0 } as unknown as TestMeta;
    expect(readReprojected(90_000, noAgent)?.lastActivityAt).toBe(0);
    const active = { cwd: "/p", lastActivityAt: START } as unknown as TestMeta;
    expect(readReprojected(90_000, active)?.lastActivityAt).toBe(
      START - 90_000,
    );
  });

  it("follows an agent seen before its session into its session (startedAt null → a host epoch), once", async () => {
    await createRoot(async (dispose) => {
      const [records, setRecords] = createStore<
        Record<string, { cwd: string; agent: Record<string, unknown> }>
      >({
        a: {
          cwd: "/p",
          agent: {
            kind: "claude-code",
            state: "fresh",
            sessionId: "s1",
            model: null,
            summary: null,
            taskProgress: null,
            contextTokens: null,
            startedAt: null,
          },
        },
      });
      bag.keys = () => tids("a");
      bag.metaOf = (id) => records[id] as unknown as TestMeta;
      bag.clockOffset = () => 90_000;
      const { getMetadata } = useTerminalMetadata({
        list: () => tids("a").map((id) => ({ id }) as TerminalInfo),
      });
      await flush();
      const a = tids("a")[0] as TerminalId;
      const agentOf = (id: TerminalId) =>
        (getMetadata(id) as { agent?: unknown } | undefined)?.agent;
      expect(agentOf(a)).toMatchObject({ state: "fresh" });
      setRecords("a", "agent", {
        kind: "claude-code",
        state: "thinking",
        sessionId: "s1",
        model: "m",
        summary: null,
        taskProgress: null,
        workflow: null,
        contextTokens: null,
        startedAt: START,
      });
      await flush();
      expect(agentOf(a)).toMatchObject({
        state: "thinking",
        startedAt: START - 90_000,
      });
      dispose();
    });
  });
});

describe("getMetadata identity stability (the #1714 right-panel-flicker guard)", () => {
  const START = 1_700_000_000_000;
  function meta(overrides: Record<string, unknown> = {}): TestMeta {
    return {
      cwd: "/p",
      git: {
        kind: "repo",
        info: {
          repoRoot: "/p",
          repoName: "p",
          worktreePath: "/p",
          branch: "main",
          isWorktree: false,
          mainRepoRoot: "/p",
          remoteUrl: null,
        },
      },
      ...overrides,
    } as unknown as TestMeta;
  }

  it("returns the SAME reference across repeated reads, an unrelated-field tick, and a redundant re-emit", async () => {
    await createRoot(async (dispose) => {
      const [store, setStore] = createSignal<Record<string, TestMeta>>({
        a: meta({ lastActivityAt: START }),
      });
      bag.keys = () => tids("a");
      bag.metaOf = (id) => store()[id];
      bag.clockOffset = () => 0;
      const { getMetadata } = useTerminalMetadata({
        list: () => tids("a").map((id) => ({ id }) as TerminalInfo),
      });
      await flush();
      const a = tids("a")[0] as TerminalId;

      const r1 = getMetadata(a);
      expect(r1).toBeDefined();
      expect(Object.is(r1, getMetadata(a))).toBe(true);

      setStore((s) => ({ ...s, a: meta({ lastActivityAt: START + 5_000 }) }));
      await flush();
      const r2 = getMetadata(a);
      expect(Object.is(r1, r2)).toBe(true);

      setStore((s) => ({ ...s, a: meta({ lastActivityAt: START + 5_000 }) }));
      await flush();
      expect(Object.is(r1, getMetadata(a))).toBe(true);

      dispose();
    });
  });

  it("does NOT notify a leaf consumer (git.repoRoot) on an incidental lastActivityAt/clock tick, but DOES on a real repoRoot change", async () => {
    await createRoot(async (dispose) => {
      const [store, setStore] = createSignal<Record<string, TestMeta>>({
        a: meta({ lastActivityAt: START }),
      });
      const [offset, setOffset] = createSignal<number | null>(0);
      bag.keys = () => tids("a");
      bag.metaOf = (id) => store()[id];
      bag.clockOffset = offset;
      const { getMetadata } = useTerminalMetadata({
        list: () => tids("a").map((id) => ({ id }) as TerminalInfo),
      });
      const a = tids("a")[0] as TerminalId;

      let runs = 0;
      let seen: string | null | undefined;
      createEffect(() => {
        runs++;
        const git = getMetadata(a)?.git;
        seen = git?.kind === "repo" ? git.info.repoRoot : null;
      });
      await flush();
      expect(runs).toBe(1);
      expect(seen).toBe("/p");

      setStore((s) => ({ ...s, a: meta({ lastActivityAt: START + 1_000 }) }));
      await flush();
      expect(runs).toBe(1);

      setOffset(30_000);
      await flush();
      expect(runs).toBe(1);

      setStore((s) => ({
        ...s,
        a: meta({
          git: {
            kind: "repo",
            info: {
              repoRoot: "/q",
              repoName: "q",
              worktreePath: "/q",
              branch: "main",
              isWorktree: false,
              mainRepoRoot: "/q",
              remoteUrl: null,
            },
          },
          lastActivityAt: START + 1_000,
        }),
      }));
      await flush();
      expect(runs).toBe(2);
      expect(seen).toBe("/q");

      dispose();
    });
  });

  it("keeps meta.agent referentially stable across a sibling tick, and notifies a leaf reader (agent.state) only on a real agent change", async () => {
    await createRoot(async (dispose) => {
      const agent = {
        kind: "claude_code",
        state: "thinking",
        startedAt: START,
      };
      const [store, setStore] = createSignal<Record<string, TestMeta>>({
        a: { cwd: "/p", agent } as unknown as TestMeta,
      });
      bag.keys = () => tids("a");
      bag.metaOf = (id) => store()[id];
      bag.clockOffset = () => 0;
      const { getMetadata } = useTerminalMetadata({
        list: () => tids("a").map((id) => ({ id }) as TerminalInfo),
      });
      await flush();
      const a = tids("a")[0] as TerminalId;
      const agent1 = (getMetadata(a) as { agent?: unknown }).agent;

      let stateRuns = 0;
      let seenState: unknown;
      createEffect(() => {
        stateRuns++;
        seenState = (getMetadata(a) as { agent?: { state?: string } })?.agent
          ?.state;
      });
      await flush();
      expect(stateRuns).toBe(1);
      expect(seenState).toBe("thinking");

      setStore((s) => ({
        ...s,
        a: { cwd: "/p2", agent } as unknown as TestMeta,
      }));
      await flush();
      expect(
        Object.is(agent1, (getMetadata(a) as { agent?: unknown }).agent),
      ).toBe(true);
      expect(stateRuns).toBe(1);

      setStore((s) => ({
        ...s,
        a: {
          cwd: "/p2",
          agent: { ...agent, state: "tool_use" },
        } as unknown as TestMeta,
      }));
      await flush();
      expect(stateRuns).toBe(2);
      expect(seenState).toBe("tool_use");

      dispose();
    });
  });
});

it("metadata ticks do not wake split-tree or unrelated display readers", async () => {
  await createRoot(async (dispose) => {
    const ids = tids("a", "b", "split");
    const [records, setRecords] = createSignal<Record<string, TestMeta>>({
      a: { cwd: "/work/a", lastActivityAt: 10 },
      b: { cwd: "/work/b", lastActivityAt: 10 },
      split: { cwd: "/work/a", parentId: "a" },
    });
    bag.keys = () => ids;
    bag.metaOf = (id) => records()[id];
    bag.clockOffset = () => 0;
    const store = useTerminalMetadata({
      list: () => ids.map((id) => ({ id }) as TerminalInfo),
    });
    let splitWakes = 0;
    let displayWakes = 0;
    createEffect(() => {
      store.getPaneTree("a");
      splitWakes++;
    });
    createEffect(() => {
      store.getDisplayInfo("b")?.key.label;
      displayWakes++;
    });
    await flush();
    setRecords((old) => ({ ...old, a: { ...old.a, lastActivityAt: 20 } }));
    await flush();
    expect(splitWakes).toBe(1);
    expect(displayWakes).toBe(1);
    const oldKey = store.getDisplayInfo("a")?.key;
    setRecords((old) => ({
      ...old,
      a: { ...old.a, cwd: "/different/renamed" },
    }));
    await flush();
    expect(splitWakes).toBe(1);
    expect(displayWakes).toBe(1);
    expect(oldKey?.label).toBe("/work/a");
    expect(store.getDisplayInfo("a")?.key.label).toBe("/different/renamed");
    expect(store.getDisplayInfo("a")?.key).not.toBe(oldKey);
    dispose();
  });
});
