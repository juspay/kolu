import type {
  SleepingTerminal,
  TerminalId,
  TerminalMetadata,
} from "kolu-common/surface";
import { createEffect, createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TestMeta = Partial<TerminalMetadata>;

// Stub every upstream the registry pulls so it loads under Node and we can drive
// it from signals: the LIVE terminal store, the sleeping-records wire cell, the
// mid-wake hide, and the two layout-writer leaves. The mocks return the bag's
// functions directly so a re-exposed selection accessor stays reference-
// identical to its source ("one source of truth"). `terminalIdOrder` (the #1425
// comparator leaf) is the REAL pure function — the merged-memo keystone test
// drives it for real.
const bag = vi.hoisted(() => ({
  terminalIds: (() => []) as () => TerminalId[],
  metaOf: ((_id: TerminalId) => undefined) as (
    id: TerminalId,
  ) => TestMeta | undefined,
  activeId: (() => null) as () => TerminalId | null,
  activate: vi.fn(),
  setActiveSilently: vi.fn(),
  persistCanvasLayout: vi.fn(),
  persistSleepingLayout: vi.fn(),
  sleeping: (() => []) as () => SleepingTerminal[],
  waking: (() => new Set<TerminalId>()) as () => ReadonlySet<TerminalId>,
}));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    terminalIds: bag.terminalIds,
    getMetadata: bag.metaOf,
    // Live display info — present for a live terminal, undefined otherwise; the
    // tile-aware `getDisplayInfo` falls back to the synthesized sleeping shape.
    getDisplayInfo: (id: TerminalId) =>
      bag.metaOf(id) ? { repoColor: "live" } : undefined,
    activeId: bag.activeId,
    activate: bag.activate,
    setActiveSilently: bag.setActiveSilently,
  }),
}));
vi.mock("../terminal/persistCanvasLayout", () => ({
  persistCanvasLayout: bag.persistCanvasLayout,
}));
vi.mock("./persistSleepingLayout", () => ({
  persistSleepingLayout: bag.persistSleepingLayout,
}));
vi.mock("../wire", () => ({ sleepingTerminals: () => bag.sleeping() }));
vi.mock("./wakingTiles", () => ({
  useWakingTiles: () => ({ waking: () => bag.waking() }),
}));
// The dock-row projection is the dock's concern, not the registry's — stub it so
// the registry's tile-aware getMetadata/getDisplayInfo can be tested for the
// live-else-synthesize dispatch without dragging in buildTerminalDisplayInfos.
vi.mock("../canvas/dock/sleepingDockRow", () => ({
  sleepingDockRowData: (record: SleepingTerminal) => ({
    meta: { lastActivityAt: record.sleptAt },
    info: { repoColor: "moon" },
  }),
}));

import { useTileStore } from "./useTileStore";

const tids = (...xs: string[]) => xs as TerminalId[];
const tid = (x: string) => x as TerminalId;

/** A sleeping record keyed by its (original) top-terminal id, carrying just the
 *  fields the registry reads (top id + its saved layout). */
const rec = (
  id: string,
  layout?: { x: number; y: number; w: number; h: number },
): SleepingTerminal =>
  ({
    id,
    sleptAt: 1000,
    terminals: [{ id, canvasLayout: layout }],
  }) as unknown as SleepingTerminal;

/** An ORPHAN record: its root id matches no terminal in its own tree (the legacy
 *  UUID-keyed format). It must be filtered out — never a tile, never passed to
 *  the throwing `topTerminal` — so one corrupt record can't poison the rest. */
const orphanRec = (recordId: string, terminalId: string): SleepingTerminal =>
  ({
    id: recordId,
    sleptAt: 1000,
    terminals: [{ id: terminalId }],
  }) as unknown as SleepingTerminal;

// Drive the registry from signal-backed live + sleeping lists. Wired BEFORE the
// first `useTileStore()` call so the singleton factory captures these sources.
const [ids, setIds] = createSignal<TerminalId[]>(tids("a", "b"));
const [sleeping, setSleeping] = createSignal<SleepingTerminal[]>([]);
const [waking, setWaking] = createSignal<ReadonlySet<TerminalId>>(new Set());
const META: Record<string, TestMeta> = {
  a: { canvasLayout: { x: 1, y: 2, w: 3, h: 4 } },
  b: {}, // a terminal with no saved layout yet
};
bag.terminalIds = ids;
bag.metaOf = (id) => META[id];
bag.sleeping = sleeping;
bag.waking = waking;

const store = useTileStore();

beforeEach(() => {
  setIds(tids("a", "b"));
  setSleeping([]);
  setWaking(new Set<TerminalId>());
  bag.persistCanvasLayout.mockClear();
  bag.persistSleepingLayout.mockClear();
});

describe("useTileStore — terminal projection", () => {
  it("projects each live terminal into a terminal-content tile, in order", () => {
    expect(store.tileIds()).toEqual(["a", "b"]);
    expect(store.tileCount()).toBe(2);
    expect(store.contentOf(tid("a"))).toEqual({
      kind: "terminal",
      terminalId: "a",
    });
    expect(store.contentOf(tid("zzz"))).toBeUndefined();
  });

  it("tracks the live set reactively (a closed terminal drops its tile)", () => {
    setIds(tids("a"));
    expect(store.tileIds()).toEqual(["a"]);
    expect(store.tileCount()).toBe(1);
  });
});

describe("useTileStore — sleeping is a union variant on the same registry", () => {
  it("merges sleeping records into tileIds, after the live ids", () => {
    setSleeping([rec("c"), rec("d")]);
    expect(store.tileIds()).toEqual(["a", "b", "c", "d"]);
    expect(store.tileCount()).toBe(4);
  });

  it("resolves a sleeping id to its sleeping content", () => {
    const c = rec("c", { x: 9, y: 9, w: 9, h: 9 });
    setSleeping([c]);
    expect(store.contentOf(tid("c"))).toEqual({ kind: "sleeping", record: c });
  });

  it("live wins for an id that is both live and sleeping (the sleep window)", () => {
    // `b` is mid-sleep: the record exists but its terminal isn't killed yet.
    setSleeping([rec("b"), rec("c")]);
    expect(store.tileIds()).toEqual(["a", "b", "c"]); // b not duplicated
    expect(store.contentOf(tid("b"))).toEqual({
      kind: "terminal",
      terminalId: "b",
    });
  });

  it("hides a mid-wake record (the optimistic wake hide)", () => {
    setSleeping([rec("c")]);
    setWaking(new Set([tid("c")]));
    expect(store.tileIds()).toEqual(["a", "b"]); // c suppressed while waking
  });

  it("filters out an orphan record (no root terminal) so one can't poison the rest", () => {
    // The data-loss bug: a single legacy/corrupt record whose root id matches no
    // terminal used to empty the whole cell — every sleep "vanished". It must be
    // dropped, leaving the well-formed records (and never reaching topTerminal).
    setSleeping([rec("c"), orphanRec("ghost", "real")]);
    expect(store.tileIds()).toEqual(["a", "b", "c"]); // ghost (+ its terminal) excluded
    expect(store.contentOf(tid("ghost"))).toBeUndefined();
    expect(store.contentOf(tid("c"))?.kind).toBe("sleeping");
  });
});

describe("useTileStore — layout (the registry hides where it lives)", () => {
  it("reads a terminal tile's layout off terminal metadata", () => {
    expect(store.getLayout(tid("a"))).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    expect(store.getLayout(tid("b"))).toBeUndefined();
    expect(store.getLayout(tid("zzz"))).toBeUndefined();
  });

  it("reads a sleeping tile's layout off its record", () => {
    setSleeping([rec("c", { x: 5, y: 6, w: 7, h: 8 })]);
    expect(store.getLayout(tid("c"))).toEqual({ x: 5, y: 6, w: 7, h: 8 });
  });

  it("persists a terminal tile's layout through the canvas-layout writer", () => {
    const next = { x: 5, y: 6, w: 7, h: 8 };
    store.setLayout(tid("a"), next);
    expect(bag.persistCanvasLayout).toHaveBeenCalledWith("a", next);
    expect(bag.persistSleepingLayout).not.toHaveBeenCalled();
  });

  it("persists a sleeping tile's layout through the sleeping-layout writer", () => {
    setSleeping([rec("c")]);
    const next = { x: 1, y: 1, w: 1, h: 1 };
    store.setLayout(tid("c"), next);
    expect(bag.persistSleepingLayout).toHaveBeenCalledWith("c", next);
    expect(bag.persistCanvasLayout).not.toHaveBeenCalled();
  });

  it("surfaces (does not silently drop) a write for a tile that does not exist", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    store.setLayout(tid("zzz"), { x: 0, y: 0, w: 1, h: 1 });
    expect(bag.persistCanvasLayout).not.toHaveBeenCalled();
    expect(bag.persistSleepingLayout).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("useTileStore — tile-aware metadata + display info (one merge home)", () => {
  it("reads a live terminal's meta + display off the terminal store", () => {
    expect(store.getMetadata(tid("a"))).toEqual(META.a);
    expect(store.getDisplayInfo(tid("a"))).toEqual({ repoColor: "live" });
  });

  it("synthesizes a sleeping tile's meta + display from its record", () => {
    setSleeping([rec("c")]);
    expect(store.getMetadata(tid("c"))).toEqual({ lastActivityAt: 1000 });
    expect(store.getDisplayInfo(tid("c"))).toEqual({ repoColor: "moon" });
  });

  it("live wins over a same-id sleeping record (the sleep window)", () => {
    setSleeping([rec("b")]); // b is live AND sleeping
    expect(store.getMetadata(tid("b"))).toEqual(META.b); // live, not synthesized
    expect(store.getDisplayInfo(tid("b"))).toEqual({ repoColor: "live" });
  });

  it("is undefined for a tile that is neither live nor sleeping", () => {
    expect(store.getMetadata(tid("zzz"))).toBeUndefined();
    expect(store.getDisplayInfo(tid("zzz"))).toBeUndefined();
  });
});

describe("useTileStore — selection (one source of truth)", () => {
  it("re-exposes the view-state selection signals by reference", () => {
    expect(store.activeId).toBe(bag.activeId);
    expect(store.activate).toBe(bag.activate);
    expect(store.setActiveSilently).toBe(bag.setActiveSilently);
  });
});

describe("useTileStore — the #1425 reference-stability keystone, inherited by the merge", () => {
  // The merged `tileIds` is no longer the verbatim `terminalIds` memo — it's a
  // new memo gated on the SAME `sameTerminalIdOrder` comparator. So the keystone
  // is now "the merged memo keeps the prior array reference (no downstream
  // re-run) when the id set + order is unchanged", not "tileIds === terminalIds".
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it("keeps the prior reference when a tick leaves the merged id order unchanged", async () => {
    await createRoot(async (dispose) => {
      setIds(tids("a", "b"));
      setSleeping([rec("c")]);
      let downstreamRuns = 0;
      let lastRef: TerminalId[] = [];
      createEffect(() => {
        downstreamRuns++;
        lastRef = store.tileIds();
      });
      await flush();
      expect(downstreamRuns).toBe(1);
      expect(lastRef).toEqual(["a", "b", "c"]);
      const prevRef = lastRef;

      // A new live array with the SAME order (what a metadata-only tick yields
      // upstream once the raw signal re-emits) must NOT re-notify downstream.
      setIds(tids("a", "b"));
      await flush();
      expect(Object.is(prevRef, lastRef)).toBe(true);
      expect(downstreamRuns).toBe(1);

      // A real change (a tile closes) does re-run and yields a fresh reference.
      setIds(tids("a"));
      await flush();
      expect(lastRef).toEqual(["a", "c"]);
      expect(downstreamRuns).toBe(2);
      dispose();
    });
  });
});
