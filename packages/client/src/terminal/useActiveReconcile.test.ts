import type { TerminalId } from "kolu-common/surface";
import { batch, createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import {
  createEvictionDedup,
  evictTerminal,
  pickAutoSwitchTarget,
  type TerminalEvictionPorts,
  useActiveReconcile,
} from "./useActiveReconcile";

const T = (s: string) => s as TerminalId;

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("pickAutoSwitchTarget", () => {
  it("picks the survivor in the removed tile's slot from raw facts, clamped to the last", () => {
    const [a, b, c, d] = [T("a"), T("b"), T("c"), T("d")];
    expect(pickAutoSwitchTarget([a, b, c], new Set([b]), b)).toBe(c);
    expect(pickAutoSwitchTarget([a, b, c], new Set([a]), a)).toBe(b);
    expect(pickAutoSwitchTarget([a, b], new Set([b]), b)).toBe(a);
    expect(pickAutoSwitchTarget([a, b, c, d], new Set([a, b]), a)).toBe(c);
    expect(pickAutoSwitchTarget([a, b, c, d], new Set([a, b]), b)).toBe(d);
    expect(pickAutoSwitchTarget([a, b, c], new Set([a, b, c]), a)).toBeNull();
    expect(pickAutoSwitchTarget([a, b], new Set([c]), c)).toBeNull();
  });
});

function makePorts(over: {
  activeId?: () => TerminalId | null;
  focusedTerminalId?: () => TerminalId | null;
  activeSubTab?: (parentId: TerminalId) => TerminalId | null;
}) {
  const calls = {
    promoteToTopLevel: vi.fn<(id: TerminalId, fromTile: TerminalId) => void>(),
    rehomeUnder: vi.fn<(id: TerminalId, parent: TerminalId) => void>(),
    activate: vi.fn<(id: TerminalId | null) => void>(),
    dropFromMru: vi.fn<(id: TerminalId) => void>(),
    collapsePanel: vi.fn<(id: TerminalId) => void>(),
    collapsePanelChrome: vi.fn<(id: TerminalId) => void>(),
    setActiveSubTab:
      vi.fn<(parentId: TerminalId, subId: TerminalId | null) => void>(),
    selectSubTab:
      vi.fn<(parentId: TerminalId, subId: TerminalId | null) => void>(),
    requestRefocus: vi.fn<(id: TerminalId) => void>(),
    removePanel: vi.fn<(id: TerminalId) => void>(),
    removeRightPanel: vi.fn<(id: TerminalId) => void>(),
    removeSearch: vi.fn<(id: TerminalId) => void>(),
  };
  const ports: TerminalEvictionPorts = {
    activeId: over.activeId ?? (() => null),
    focusedTerminalId: over.focusedTerminalId ?? (() => null),
    activate: calls.activate,
    dropFromMru: calls.dropFromMru,
    promoteToTopLevel: calls.promoteToTopLevel,
    rehomeUnder: calls.rehomeUnder,
    subPanel: {
      collapsePanel: calls.collapsePanel,
      collapsePanelChrome: calls.collapsePanelChrome,
      paneChrome: (id: TerminalId) => ({
        activeSubTab: (over.activeSubTab ?? (() => null))(id),
      }),
      setActiveSubTab: calls.setActiveSubTab,
      selectSubTab: calls.selectSubTab,
      requestRefocus: calls.requestRefocus,
      removePanel: calls.removePanel,
    },
    removeRightPanel: calls.removeRightPanel,
    removeSearch: calls.removeSearch,
  };
  return { ports, calls };
}

function graph(
  parents: Record<string, string | null>,
): import("./useActiveReconcile").RemovalGraph {
  const ids = Object.keys(parents) as TerminalId[];
  return {
    ids,
    parentOf: (id) => {
      if (!(id in parents)) return undefined;
      const p = parents[id as string];
      return p === null ? null : (p as TerminalId);
    },
  };
}

describe("evictTerminal — top-level branch", () => {
  it("promotes subs, sheds chrome, and auto-switches when active", () => {
    const { ports, calls } = makePorts({ activeId: () => T("P") });
    evictTerminal(
      ports,
      T("P"),
      null,
      [T("P"), T("Q")],
      new Set([T("P")]),
      graph({ P: null, Q: null, S1: "P", S2: "P" }),
    );

    expect(calls.promoteToTopLevel.mock.calls).toEqual([
      [T("S1"), T("P")],
      [T("S2"), T("P")],
    ]);
    expect(calls.removePanel).toHaveBeenCalledWith(T("P"));
    expect(calls.removeRightPanel).toHaveBeenCalledWith(T("P"));
    expect(calls.removeSearch).toHaveBeenCalledWith(T("P"));
    expect(calls.dropFromMru).toHaveBeenCalledWith(T("P"));
    expect(calls.activate).toHaveBeenCalledWith(T("Q"));
  });

  it("does not auto-switch when the removed tile was not active", () => {
    const { ports, calls } = makePorts({ activeId: () => T("Q") });
    evictTerminal(
      ports,
      T("P"),
      null,
      [T("P"), T("Q")],
      new Set([T("P")]),
      graph({ P: null, Q: null }),
    );
    expect(calls.activate).not.toHaveBeenCalled();
  });

  it("clamps focus to null when EVERY top-level tile departs in one frame", () => {
    const { ports, calls } = makePorts({ activeId: () => T("A") });
    evictTerminal(
      ports,
      T("A"),
      null,
      [T("A"), T("B"), T("C")],
      new Set([T("A"), T("B"), T("C")]),
      graph({ A: null, B: null, C: null }),
    );
    expect(calls.activate).toHaveBeenCalledWith(null);
  });

  it("skips departing siblings when picking the survivor (partial batch)", () => {
    const { ports, calls } = makePorts({ activeId: () => T("A") });
    evictTerminal(
      ports,
      T("A"),
      null,
      [T("A"), T("B"), T("C"), T("D")],
      new Set([T("A"), T("B")]),
      graph({ A: null, B: null, C: null, D: null }),
    );
    expect(calls.activate).toHaveBeenCalledWith(T("C"));
  });
});

describe("evictTerminal — sub-terminal branch", () => {
  it("collapses, clears the tab, and focuses the parent when the focused last sub departs", () => {
    const { ports, calls } = makePorts({
      focusedTerminalId: () => T("S"),
    });
    evictTerminal(
      ports,
      T("S"),
      T("P"),
      [],
      new Set([T("S")]),
      graph({ P: null, S: "P" }),
    );
    expect(calls.collapsePanel).toHaveBeenCalledWith(T("P"));
    expect(calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), null);
    expect(calls.collapsePanelChrome).not.toHaveBeenCalled();
    expect(calls.promoteToTopLevel).not.toHaveBeenCalled();
  });

  it("sheds a departing SPLIT's own panel state", () => {
    const { ports, calls } = makePorts({ focusedTerminalId: () => T("S") });
    evictTerminal(
      ports,
      T("S"),
      T("P"),
      [],
      new Set([T("S")]),
      graph({ P: null, S: "P" }),
    );
    expect(calls.removeRightPanel).toHaveBeenCalledExactlyOnceWith(T("S"));
  });

  it("sheds a departing split's panel state even when NO live ancestor survives", () => {
    const { ports, calls } = makePorts({ focusedTerminalId: () => T("OTHER") });
    evictTerminal(
      ports,
      T("G"),
      T("M"),
      [],
      new Set([T("R"), T("M"), T("G")]),
      graph({ R: null, M: "R", G: "M" }),
    );
    expect(calls.removeRightPanel).toHaveBeenCalledExactlyOnceWith(T("G"));
  });

  it("keeps a background tile's focus untouched when its last sub departs", () => {
    const { ports, calls } = makePorts({
      focusedTerminalId: () => T("OTHER"),
    });

    evictTerminal(
      ports,
      T("S"),
      T("P"),
      [],
      new Set([T("S")]),
      graph({ P: null, S: "P" }),
    );

    expect(calls.collapsePanelChrome).toHaveBeenCalledExactlyOnceWith(T("P"));
    expect(calls.collapsePanel).not.toHaveBeenCalled();
    expect(calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), null);
    expect(calls.requestRefocus).not.toHaveBeenCalled();
  });

  it("switches the active sub-tab to a sibling and refocuses", () => {
    const { ports, calls } = makePorts({
      activeSubTab: () => T("S1"),
      focusedTerminalId: () => T("S1"),
    });
    evictTerminal(
      ports,
      T("S1"),
      T("P"),
      [],
      new Set([T("S1")]),
      graph({ P: null, S1: "P", S2: "P" }),
    );
    expect(calls.selectSubTab).toHaveBeenCalledWith(T("P"), T("S2"));
    expect(calls.requestRefocus).toHaveBeenCalledWith(T("P"));
    expect(calls.collapsePanel).not.toHaveBeenCalled();
  });

  it("keeps main-pane focus while repairing a departed active sub tab", () => {
    const { ports, calls } = makePorts({
      activeSubTab: () => T("S1"),
      focusedTerminalId: () => T("P"),
    });
    evictTerminal(
      ports,
      T("S1"),
      T("P"),
      [],
      new Set([T("S1")]),
      graph({ P: null, S1: "P", S2: "P" }),
    );
    expect(calls.setActiveSubTab).toHaveBeenCalledExactlyOnceWith(
      T("P"),
      T("S2"),
    );
    expect(calls.selectSubTab).not.toHaveBeenCalled();
    expect(calls.requestRefocus).toHaveBeenCalledExactlyOnceWith(T("P"));
  });

  it("repairs a tab dangling at a pane that departed WITH its own parent", () => {
    const { ports, calls } = makePorts({
      activeSubTab: () => T("G"),
      focusedTerminalId: () => T("OTHER"),
    });
    evictTerminal(
      ports,
      T("M"),
      T("R"),
      [],
      new Set([T("M"), T("G")]),
      graph({ R: null, M: "R", G: "M", S: "R" }),
    );
    expect(calls.setActiveSubTab).toHaveBeenCalledExactlyOnceWith(
      T("R"),
      T("S"),
    );
  });

  it("re-homes a middle terminal's children to the root (does not kill them)", () => {
    const { ports, calls } = makePorts({
      activeSubTab: () => T("M"),
      focusedTerminalId: () => T("M"),
    });
    evictTerminal(
      ports,
      T("M"),
      T("R"),
      [T("R")],
      new Set([T("M")]),
      graph({ R: null, M: "R", G: "M" }),
    );
    expect(calls.rehomeUnder).toHaveBeenCalledExactlyOnceWith(T("G"), T("R"));
    expect(calls.selectSubTab).toHaveBeenCalledWith(T("R"), T("G"));
    expect(calls.promoteToTopLevel).not.toHaveBeenCalled();
  });

  it("promotes grandchildren when the whole ancestor chain departs in one frame", () => {
    const { ports, calls } = makePorts({
      focusedTerminalId: () => T("M"),
    });
    evictTerminal(
      ports,
      T("M"),
      T("R"),
      [T("R")],
      new Set([T("R"), T("M")]),
      graph({ R: null, M: "R", G: "M" }),
    );
    expect(calls.promoteToTopLevel).toHaveBeenCalledExactlyOnceWith(
      T("G"),
      T("R"),
    );
    expect(calls.rehomeUnder).not.toHaveBeenCalled();
    expect(calls.collapsePanel).not.toHaveBeenCalled();
    expect(calls.selectSubTab).not.toHaveBeenCalled();
  });

  it("re-homes under the root even when a middle parent survives", () => {
    const { ports, calls } = makePorts({
      activeSubTab: () => T("M"),
      focusedTerminalId: () => T("M"),
    });
    evictTerminal(
      ports,
      T("M"),
      T("P"),
      [T("R")],
      new Set([T("M")]),
      graph({ R: null, P: "R", M: "P", G: "M" }),
    );
    expect(calls.rehomeUnder).toHaveBeenCalledExactlyOnceWith(T("G"), T("R"));
    expect(calls.selectSubTab).toHaveBeenCalledWith(
      T("R"),
      expect.stringMatching(/^(P|G)$/),
    );
    expect(calls.promoteToTopLevel).not.toHaveBeenCalled();
  });
});

const emptyGraph = graph({ P: null });

describe("createEvictionDedup", () => {
  it("skips a departed id already evicted by the imperative path (no double)", () => {
    const runEvict = vi.fn();
    const d = createEvictionDedup(runEvict);
    d.evictImperatively(T("P"), null, [T("P")], true, emptyGraph);
    d.evictDeparted(T("P"), null, [T("P")], new Set([T("P")]), emptyGraph);
    expect(runEvict).toHaveBeenCalledTimes(1);
  });

  it("runs the cleanup for an UNCLAIMED departure (natural exit)", () => {
    const runEvict = vi.fn();
    const d = createEvictionDedup(runEvict);
    d.evictDeparted(T("P"), null, [T("P")], new Set([T("P")]), emptyGraph);
    expect(runEvict).toHaveBeenCalledTimes(1);
  });

  it("does not claim when no list-drop will follow (willDrop=false)", () => {
    const runEvict = vi.fn();
    const d = createEvictionDedup(runEvict);
    d.evictImperatively(T("P"), null, [T("P")], false, emptyGraph);
    d.evictDeparted(T("P"), null, [T("P")], new Set([T("P")]), emptyGraph);
    expect(runEvict).toHaveBeenCalledTimes(2);
  });
});

function setupReconcile(init: {
  rawIds: TerminalId[];
  parents: Record<string, TerminalId | null>;
  activeId?: TerminalId | null;
  focusedTerminalId?: TerminalId | null;
  activeSubTab?: Record<string, TerminalId | null>;
  connected?: boolean;
  host?: string;
}) {
  const state = {
    active: init.activeId ?? null,
    focused: init.focusedTerminalId ?? null,
    activeSubTab: init.activeSubTab ?? {},
  };
  let handles!: {
    setRawIds: (v: TerminalId[]) => void;
    setParents: (v: Record<string, TerminalId | null>) => void;
    setConnected: (v: boolean) => void;
    setHost: (v: string) => void;
    evictImperatively: (
      id: TerminalId,
      parentId: TerminalId | null,
      topLevelBefore: readonly TerminalId[],
      willDrop: boolean,
    ) => void;
    calls: ReturnType<typeof makePorts>["calls"];
    dispose: () => void;
  };
  createRoot((dispose) => {
    const [rawIds, setRawIds] = createSignal<TerminalId[]>(init.rawIds);
    const [parents, setParents] = createSignal(init.parents);
    const [connected, setConnected] = createSignal(init.connected ?? true);
    const [host, setHost] = createSignal(init.host ?? "local");
    const parentOf = (id: TerminalId) => parents()[id] ?? null;
    const { ports, calls } = makePorts({
      activeId: () => state.active,
      focusedTerminalId: () => state.focused,
      activeSubTab: (pid) => state.activeSubTab[pid] ?? null,
    });
    calls.activate.mockImplementation((id) => {
      state.active = id;
    });
    const eviction = createEvictionDedup(
      (id, parentId, topLevelBefore, departing, removal) =>
        evictTerminal(ports, id, parentId, topLevelBefore, departing, removal),
    );
    useActiveReconcile({
      rawList: rawIds,
      parentOf: (id) => parents()[id] ?? null,
      activeHostKey: host,
      evictDeparted: eviction.evictDeparted,
      listIsAuthoritative: connected,
    });
    handles = {
      setRawIds,
      setParents,
      setConnected,
      setHost,
      evictImperatively: (
        id: TerminalId,
        parentId: TerminalId | null,
        topLevelBefore: readonly TerminalId[],
        willDrop: boolean,
      ) => {
        const g = graph(
          Object.fromEntries(
            rawIds().map((x) => [x as string, parentOf(x)]),
          ) as Record<string, string | null>,
        );
        eviction.evictImperatively(id, parentId, topLevelBefore, willDrop, g);
      },
      calls,
      dispose,
    };
  });
  return handles;
}

describe("useActiveReconcile — FULL cleanup driven off the list", () => {
  it("(a) natural PARENT exit promotes the sub AND evicts the parent's panels", async () => {
    const h = setupReconcile({
      rawIds: [T("P"), T("S"), T("Q")],
      parents: { P: null, S: T("P"), Q: null },
      activeId: T("P"),
    });
    await tick();

    h.setRawIds([T("S"), T("Q")]);

    expect(h.calls.promoteToTopLevel).toHaveBeenCalledWith(T("S"), T("P"));
    expect(h.calls.removePanel).toHaveBeenCalledWith(T("P"));
    expect(h.calls.removeRightPanel).toHaveBeenCalledWith(T("P"));
    expect(h.calls.removeSearch).toHaveBeenCalledWith(T("P"));
    expect(h.calls.activate).toHaveBeenCalledWith(T("Q"));
    h.dispose();
  });

  it("(a2) a list-driven promotion carries the from-tile the LIVE graph no longer has", async () => {
    const h = setupReconcile({
      rawIds: [T("P"), T("S")],
      parents: { P: null, S: T("P") },
      activeId: T("P"),
    });
    await tick();

    batch(() => {
      h.setParents({ S: null });
      h.setRawIds([T("S")]);
    });

    expect(h.calls.promoteToTopLevel).toHaveBeenCalledExactlyOnceWith(
      T("S"),
      T("P"),
    );
    h.dispose();
  });

  it("(b) natural SUB exit switches the parent's sub-panel via the captured parentId", async () => {
    const h = setupReconcile({
      rawIds: [T("P"), T("S1"), T("S2")],
      parents: { P: null, S1: T("P"), S2: T("P") },
      activeSubTab: { P: T("S1") },
      focusedTerminalId: T("S1"),
    });
    await tick();

    h.setRawIds([T("P"), T("S2")]);

    expect(h.calls.selectSubTab).toHaveBeenCalledWith(T("P"), T("S2"));
    expect(h.calls.requestRefocus).toHaveBeenCalledWith(T("P"));
    expect(h.calls.promoteToTopLevel).not.toHaveBeenCalled();
    h.dispose();
  });

  it("(c) kill path does the full cleanup once — the list-drop reconcile is a no-op", async () => {
    const h = setupReconcile({
      rawIds: [T("P"), T("S")],
      parents: { P: null, S: T("P") },
      activeId: T("P"),
    });
    await tick();

    h.evictImperatively(T("P"), null, [T("P")], true);
    expect(h.calls.promoteToTopLevel).toHaveBeenCalledTimes(1);

    h.setRawIds([T("S")]);

    expect(h.calls.promoteToTopLevel).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it("(d) SUPPRESSES the eviction while the daemon is NOT connected (supervised drain)", async () => {
    const h = setupReconcile({
      rawIds: [T("P"), T("S")],
      parents: { P: null, S: T("P") },
      activeId: T("P"),
      connected: false,
    });
    await tick();

    h.setRawIds([]);

    expect(h.calls.promoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.removePanel).not.toHaveBeenCalled();
    expect(h.calls.removeRightPanel).not.toHaveBeenCalled();
    expect(h.calls.dropFromMru).not.toHaveBeenCalled();
    expect(h.calls.activate).not.toHaveBeenCalled();
    h.dispose();
  });

  it("(e) a departure SKIPPED while disconnected is NOT replayed on reconnect", async () => {
    const h = setupReconcile({
      rawIds: [T("P"), T("S")],
      parents: { P: null, S: T("P") },
      activeId: T("P"),
      connected: false,
    });
    await tick();

    h.setRawIds([]);
    expect(h.calls.promoteToTopLevel).not.toHaveBeenCalled();

    h.setConnected(true);
    h.setParents({ P2: null, S2: T("P2") });
    h.setRawIds([T("P2"), T("S2")]);

    expect(h.calls.promoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.removePanel).not.toHaveBeenCalled();
    expect(h.calls.activate).not.toHaveBeenCalled();
    h.dispose();
  });

  it("(f) connected batch departure of EVERY top-level tile clamps focus to null (not a dead id)", async () => {
    const h = setupReconcile({
      rawIds: [T("A"), T("B"), T("C")],
      parents: { A: null, B: null, C: null },
      activeId: T("A"),
    });
    await tick();

    h.setRawIds([]);

    expect(h.calls.activate).toHaveBeenCalledWith(null);
    expect(h.calls.activate).not.toHaveBeenCalledWith(T("B"));
    expect(h.calls.activate).not.toHaveBeenCalledWith(T("C"));
    h.dispose();
  });

  it("(g) connected batch departure keeps focus on a real survivor when some remain", async () => {
    const h = setupReconcile({
      rawIds: [T("A"), T("B"), T("C"), T("D")],
      parents: { A: null, B: null, C: null, D: null },
      activeId: T("A"),
    });
    await tick();

    h.setRawIds([T("C"), T("D")]);

    expect(h.calls.activate).toHaveBeenCalledWith(T("C"));
    expect(h.calls.activate).not.toHaveBeenCalledWith(T("B"));
    h.dispose();
  });

  it("(h) two rapid imperative closes don't re-focus the first (still-claimed) tile", async () => {
    const h = setupReconcile({
      rawIds: [T("A"), T("B")],
      parents: { A: null, B: null },
      activeId: T("A"),
    });
    await tick();

    h.evictImperatively(T("A"), null, [T("A"), T("B")], true);
    expect(h.calls.activate).toHaveBeenLastCalledWith(T("B"));

    h.evictImperatively(T("B"), null, [T("A"), T("B")], true);
    expect(h.calls.activate).toHaveBeenLastCalledWith(null);
    expect(h.calls.activate).not.toHaveBeenCalledWith(T("A"));
    h.dispose();
  });

  it("does nothing when a terminal is ADDED (create) or on mount", async () => {
    const h = setupReconcile({
      rawIds: [T("P")],
      parents: { P: null },
      activeId: T("P"),
    });
    await tick();
    expect(h.calls.activate).not.toHaveBeenCalled();

    h.setParents({ P: null, Q: null });
    h.setRawIds([T("P"), T("Q")]);

    expect(h.calls.promoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.removePanel).not.toHaveBeenCalled();
    expect(h.calls.activate).not.toHaveBeenCalled();
    h.dispose();
  });

  it("(f) a HOST SWITCH resets the baseline — the departed host's tiles are NOT evicted", async () => {
    const h = setupReconcile({
      rawIds: [T("P"), T("S"), T("Q")],
      parents: { P: null, S: T("P"), Q: null },
      activeId: T("P"),
      host: "local",
    });
    await tick();

    batch(() => {
      h.setParents({ B1: null, B2: null });
      h.setRawIds([T("B1"), T("B2")]);
      h.setHost("remote:B");
    });

    expect(h.calls.promoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.dropFromMru).not.toHaveBeenCalled();
    expect(h.calls.activate).not.toHaveBeenCalled();

    batch(() => {
      h.setParents({ B1: null });
      h.setRawIds([T("B1")]);
    });
    expect(h.calls.dropFromMru).toHaveBeenCalledWith(T("B2"));
    h.dispose();
  });
});
