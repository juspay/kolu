import type { TerminalInfo, TerminalMetadata } from "@kolu/padi/surface";
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
  };
  // The map shape: `padiMap.useEntry(activeHost)` returns the active host's Entry,
  // whose `.collections.terminals` is the same controllable double.
  return {
    padiMap: {
      useEntry: () => ({ collections: { terminals } }),
      // `entry(host).clock.toLocal` — `ms − offset`, reading the controllable offset.
      // Default 0 (identity) leaves the ordering tests untouched; the reprojection test
      // drives a real skew (and null, the warming host) through `bag.clockOffset`.
      entry: () => ({
        clock: {
          toLocal: (ms: number) => {
            const off = bag.clockOffset();
            return off === null ? null : ms - off;
          },
        },
      }),
    },
    activeHost: () => "local",
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
