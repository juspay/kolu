import type { TerminalId, TerminalMetadata } from "kolu-common/surface";
import { createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

type TestMeta = Partial<TerminalMetadata>;

// Stub the two upstream hooks so the registry loads under Node and we can drive
// it from a signal-backed terminal list (exactly as a server delta would move
// `terminalIds()`). The mock returns the bag's functions DIRECTLY — so a re-
// exposed selection accessor is reference-identical to its source, which is how
// the test proves "one source of truth" and that the `terminalIds` stable-ref
// keystone (#1425) is inherited verbatim.
const bag = vi.hoisted(() => ({
  terminalIds: (() => []) as () => TerminalId[],
  metaOf: ((_id: TerminalId) => undefined) as (
    id: TerminalId,
  ) => TestMeta | undefined,
  activeId: (() => null) as () => TerminalId | null,
  activate: vi.fn(),
  setActiveSilently: vi.fn(),
  mruOrder: (() => []) as () => TerminalId[],
  persistCanvasLayout: vi.fn(),
}));

vi.mock("../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    terminalIds: bag.terminalIds,
    getMetadata: bag.metaOf,
    activeId: bag.activeId,
    activate: bag.activate,
    setActiveSilently: bag.setActiveSilently,
    mruOrder: bag.mruOrder,
  }),
}));
vi.mock("../terminal/persistCanvasLayout", () => ({
  persistCanvasLayout: bag.persistCanvasLayout,
}));

import { useTileStore } from "./useTileStore";

const tids = (...xs: string[]) => xs as TerminalId[];
const tid = (x: string) => x as TerminalId;

// Drive the registry from a signal-backed terminal list + a static metadata
// table. Wired BEFORE the first `useTileStore()` call so the singleton factory
// captures these reactive sources.
const [ids, setIds] = createSignal<TerminalId[]>(tids("a", "b"));
const META: Record<string, TestMeta> = {
  a: { canvasLayout: { x: 1, y: 2, w: 3, h: 4 } },
  b: {}, // a terminal with no saved layout yet
};
bag.terminalIds = ids;
bag.metaOf = (id) => META[id];

const store = useTileStore();

beforeEach(() => {
  setIds(tids("a", "b"));
  bag.persistCanvasLayout.mockClear();
});

describe("useTileStore projection", () => {
  it("projects each live terminal into a terminal-content tile, in order", () => {
    expect(store.tileIds()).toEqual(["a", "b"]);
    expect(store.tileCount()).toBe(2);
  });

  it("resolves content by id and is undefined for a tile that does not exist", () => {
    expect(store.contentOf(tid("a"))).toEqual({
      kind: "terminal",
      terminalId: "a",
    });
    expect(store.contentOf(tid("zzz"))).toBeUndefined();
  });

  it("tracks the live set reactively (a closed terminal drops its tile)", () => {
    setIds(tids("a")); // "b" closed
    expect(store.tileIds()).toEqual(["a"]);
    expect(store.tileCount()).toBe(1);
  });

  it("inherits the terminalIds memo reference verbatim — the #1425 keystone", () => {
    // The registry re-exposes the stabilized memo itself, so its no-op-skip
    // (stable array reference on a metadata-only tick) carries over for free.
    expect(store.tileIds).toBe(bag.terminalIds);
  });
});

describe("useTileStore layout (registry hides where it lives)", () => {
  it("reads a tile's layout off terminal metadata", () => {
    expect(store.getLayout(tid("a"))).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });

  it("is undefined for a terminal with no saved layout, or an absent tile", () => {
    expect(store.getLayout(tid("b"))).toBeUndefined();
    expect(store.getLayout(tid("zzz"))).toBeUndefined();
  });

  it("persists a terminal tile's layout through the canvas-layout writer", () => {
    const next = { x: 5, y: 6, w: 7, h: 8 };
    store.setLayout(tid("a"), next);
    expect(bag.persistCanvasLayout).toHaveBeenCalledWith("a", next);
  });

  it("does not write for a tile that does not exist", () => {
    store.setLayout(tid("zzz"), { x: 0, y: 0, w: 1, h: 1 });
    expect(bag.persistCanvasLayout).not.toHaveBeenCalled();
  });
});

describe("useTileStore selection (one source of truth)", () => {
  it("re-exposes the view-state selection signals by reference", () => {
    expect(store.activeId).toBe(bag.activeId);
    expect(store.activate).toBe(bag.activate);
    expect(store.setActiveSilently).toBe(bag.setActiveSilently);
    expect(store.mruOrder).toBe(bag.mruOrder);
  });
});
