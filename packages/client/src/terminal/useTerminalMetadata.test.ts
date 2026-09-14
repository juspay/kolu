import type { TerminalInfo, TerminalMetadata } from "@kolu/padi-client/surface";
import { Stream } from "effect";
import { decodeHostKey, encodeHostKey, LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

// `useTerminalMetadata` pulls `padi` (a live surface socket) and `solid-sonner`
// (a toast DOM) at import time. Stub both so the hook loads under Node, and drive
// the ONE per-key collection it reads — `padi.collections.terminals` — through one
// hoisted, signal-backed bag. W1.R1 moved the reader-join server-side, so the
// collection serves the ALREADY-COMPOSED record; a test supplies a flat `TestMeta`
// and the mock hands it back whole (with the `state: "active"` discriminant the
// composed active arm always carries). Flipping a field or the id set re-runs the
// real `terminalIds` memo the way a server delta would, so a test observes its
// `equals` gate.
type TestMeta = Partial<TerminalMetadata>;
const bag = vi.hoisted(() => {
  return {
    // Late-bound to module-scope signals once solid-js is imported (below). The
    // mock reads through these so the memo tracks them as reactive sources.
    keys: (() => [] as TerminalId[]) as () => TerminalId[],
    metaOf: (() => undefined) as (id: TerminalId) => TestMeta | undefined,
    // The active host's measured clock offset for `entry().clock.toLocal` — default 0
    // (identity), so the ordering tests are unaffected; the reprojection test drives it.
    clockOffset: (() => 0) as () => number | null,
  };
});

vi.mock("../wire", () => {
  // Surface `{ keys, byKey }` shape (see useCollection.ts). `byKey` returns an
  // accessor when the id has metadata, else undefined — and reads `bag.metaOf`
  // INSIDE the accessor so the read stays reactive to the composed record.
  const terminals = {
    use: () => ({
      keys: () => bag.keys(),
      byKey: (id: TerminalId) =>
        bag.metaOf(id) !== undefined
          ? () => ({ state: "active", ...(bag.metaOf(id) as TestMeta) })
          : undefined,
    }),
    // `createHostWire`'s `terminalKeys` opens this un-enrolled keys-stream ref via
    // `unenrolledStreamCall` — a `Stream` that yields nothing and stays open (this
    // test drives ids through `bag.keys`/`deps.list`, not the keys stream).
    unenrolledKeys: () => Stream.never,
  };
  // Benign no-op stubs for the OTHER retained subs `createHostWire` opens beside
  // `terminals` (session / activityFeed / daemonStatus) — this test drives ONLY the
  // metadata collection, so these just need to construct without throwing.
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
  // `padiMap.entry(host)` — the point lens `createHostWire` opens the host's retained
  // subs through. `.clock.toLocal` is `ms − offset` reading the controllable offset
  // (default 0 = identity; the reprojection test drives a real skew and null).
  const entry = () => ({
    clock: {
      toLocal: (ms: number) => {
        const off = bag.clockOffset();
        return off === null ? null : ms - off;
      },
    },
    collections: { terminals, daemonStatus: stubCollection },
    cells: { session: stubCell, activityFeed: stubCell },
    // `createViewState`'s `writeActive` reports the active tile via
    // `entry(host).procedures.chrome.setActive` — a benign no-op here.
    procedures: { chrome: { setActive: async () => {} } },
  });
  // The `terminals` collection now rides the active host's RETAINED `scopedByEntry`
  // owner (W9), read via `activeScope().wire.terminals` — so the mock is
  // scope-compatible: `entries`/`codec`/`live` for the membership kernel, `entry`
  // for the per-host subs. Static single-host membership (LOCAL_HOST) — this test
  // never switches hosts, so the LOCAL owner builds once and stays active.
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
    // The GROUNDED accessor the per-host scope reads (juspay/kolu#1763). This mock's
    // membership is a static single local host and it never switches, so LOCAL_HOST is
    // always grounded — matching `activeHost` above.
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
/** Solid flushes `createEffect` on a microtask; a macrotask tick drains it. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("root-ancestor flatten vs nested pane tree (#2059)", () => {
  // Canvas paints every descendant under a root as a flat split tab; the Dock
  // indents the SAME panes by their true parent→child edge. Both accessors ride
  // the same metadata bag and the same resolved index.
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
    // Server order: R, M, G, C (C is a direct child of R after G).
    const h = drive({ R: undefined, M: "R", G: "M", C: "R" });
    expect(h.terminalIds()).toEqual(tids("R"));
    // Canvas flat: every descendant of R.
    expect(h.getSplitPaneIds(tids("R")[0]!)).toEqual(tids("M", "G", "C"));
    h.dispose();
  });

  it("paints a cycle as top-level tiles (never hides them)", () => {
    const h = drive({ A: "B", B: "A" });
    expect(h.terminalIds()).toEqual(tids("A", "B"));
    expect(h.getSplitPaneIds(tids("A")[0]!)).toEqual([]);
    expect(h.getSplitPaneIds(tids("B")[0]!)).toEqual([]);
    // A cycle member is a tile, so it is nobody's pane on EITHER shape.
    expect(h.getPaneTree(tids("A")[0]!)).toEqual([]);
    expect(h.getPaneTree(tids("B")[0]!)).toEqual([]);
    h.dispose();
  });

  it("hands the Dock the SAME panes as the canvas, nested by their real parent", () => {
    // The pair the #2059 follow-up bug lived between: the canvas flattens, the
    // Dock indents, and both must cover every descendant. The Dock's own walk
    // stopped at depth 1, so G had a canvas tab and no dock row at all.
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
    // Construction bonus from #2059: TerminalContent only paints splits when the
    // ROOT tile is live. A sleeping intermediate used to hide its children when
    // they hung off it; with root-ancestor grouping they hang off R instead.
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

      setKeys(tids("c", "b", "a")); // order drives sidebar position labels
      await flush();
      expect(Object.is(prevRef, lastRef)).toBe(false);
      expect(downstreamRuns).toBe(2);

      dispose();
    });
  });
});

describe("getMetadata clock reprojection (the foreign-clock ingestion boundary)", () => {
  // The two padi-host-stamped epochs — top-level `lastActivityAt` and the active arm's
  // `agent.startedAt` — cross to the browser clock ONCE, here at `getMetadata`, via the
  // ACTIVE host's measured offset (`ms − offset`). Every downstream consumer then reads a
  // LOCAL epoch (single translation; nothing re-applies `toLocal`). A skewed host stays
  // sane; a warming host (null offset) collapses each epoch to its ABSENT form, never raw.
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
    // A host 90s AHEAD: its epoch lands 90s EARLIER in local time — a positive, sane
    // "just now", not the +90s-in-the-future garbage a raw cross-clock read would render.
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
    // Warming host ⇒ 0, which `formatTimeAgo` renders as "" (no "asleep X ago").
    expect(
      (readReprojected(null, sleeping) as { sleptAt?: number })?.sleptAt,
    ).toBe(0);
  });

  it("PRESERVES the lastActivityAt:0 sentinel (never-had-agent) — a real offset must NOT forge -offset", () => {
    // 0 is the in-band "no activity yet" sentinel, NOT an epoch. On a +90s host a naive
    // reproject would render toLocal(0) = -90_000 — a garbage epoch isStale/formatTimeAgo read
    // as canonical (a fresh remote shell "55y ago", dropped from the dock as parked). The guard
    // leaves 0 as 0; a real, non-zero epoch on the same host still translates.
    const noAgent = { cwd: "/p", lastActivityAt: 0 } as unknown as TestMeta;
    expect(readReprojected(90_000, noAgent)?.lastActivityAt).toBe(0);
    const active = { cwd: "/p", lastActivityAt: START } as unknown as TestMeta;
    expect(readReprojected(90_000, active)?.lastActivityAt).toBe(
      START - 90_000,
    );
  });
});

describe("getMetadata identity stability (the #1714 right-panel-flicker guard)", () => {
  // The regression: #1714 had `getMetadata` return `reprojectClock(rawTile(id))` —
  // a FRESH object minted per call, reactive on the active host's clock — so every
  // observation manufactured a spurious "new value". A consumer keyed on the
  // reference (the `active` memo → `repoPath()` → the Code tab's polled queries)
  // then blanked + remounted the tree on every incidental `lastActivityAt`/clock
  // tick. The keyed reconcile-backed projection restores referential stability at
  // this one boundary: the reference changes IFF the reprojected value changed, and
  // a leaf reader (`meta.git.repoRoot`) is notified only on that leaf's change.
  const START = 1_700_000_000_000;
  // Only `cwd` + `git.repoRoot` matter here (the leaf a consumer tracks); a
  // partial `git` is enough, cast past the full composed shape like the sibling
  // reprojection tests do.
  /** Full GitInfo — partial `{ repoRoot }` leaves repoName/branch undefined
   *  and `terminalKey` projects (undefined, undefined), which fail-loud in
   *  `buildTerminalDisplayInfos` (displayInfos runs for every metadata fixture). */
  function meta(overrides: Record<string, unknown> = {}): TestMeta {
    return {
      cwd: "/p",
      git: {
        repoRoot: "/p",
        repoName: "p",
        worktreePath: "/p",
        branch: "main",
        isWorktree: false,
        mainRepoRoot: "/p",
        remoteUrl: null,
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
      // Repeated reads in the same tick — one projected value, one reference.
      expect(Object.is(r1, getMetadata(a))).toBe(true);

      // An unrelated field ticks (lastActivityAt) — the reconcile keeps the record's
      // proxy identity; a re-introduced fresh-object mint would fail this.
      setStore((s) => ({ ...s, a: meta({ lastActivityAt: START + 5_000 }) }));
      await flush();
      const r2 = getMetadata(a);
      expect(Object.is(r1, r2)).toBe(true);

      // A redundant re-emit of an equal record lands identical projected values —
      // still the same reference (reconcile is a no-op).
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
        seen = getMetadata(a)?.git?.repoRoot ?? null;
      });
      await flush();
      expect(runs).toBe(1);
      expect(seen).toBe("/p");

      // lastActivityAt ticks — repoRoot unchanged. The #1714 flicker was this
      // re-running (→ the Code tab remount). Post-fix the leaf reader is untouched.
      setStore((s) => ({ ...s, a: meta({ lastActivityAt: START + 1_000 }) }));
      await flush();
      expect(runs).toBe(1);

      // The active host's clock offset re-measures — reprojects the epoch but not
      // repoRoot. The leaf reader must still not re-run.
      setOffset(30_000);
      await flush();
      expect(runs).toBe(1);

      // repoRoot ACTUALLY changes (a `cd` to a different repo) — now it re-runs.
      setStore((s) => ({
        ...s,
        a: meta({
          git: {
            repoRoot: "/q",
            repoName: "q",
            worktreePath: "/q",
            branch: "main",
            isWorktree: false,
            mainRepoRoot: "/q",
            remoteUrl: null,
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

      // A sibling top-level field ticks; the agent sub-object is unchanged. The
      // `reconcile` keeps the agent proxy, and the state leaf reader does not re-run.
      setStore((s) => ({
        ...s,
        a: { cwd: "/p2", agent } as unknown as TestMeta,
      }));
      await flush();
      expect(
        Object.is(agent1, (getMetadata(a) as { agent?: unknown }).agent),
      ).toBe(true);
      expect(stateRuns).toBe(1);

      // The agent's own state changes — `reconcile` updates the `state` leaf IN
      // PLACE (keeping the agent proxy), so a leaf reader re-runs, granularly.
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
