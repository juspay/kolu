import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import {
  createEvictionDedup,
  pickAutoSwitchTarget,
  planEviction,
  type TerminalEvictionPorts,
  useActiveReconcile,
} from "./useActiveReconcile";

const T = (s: string) => s as TerminalId;

/** Let Solid flush the queued reactive effects (they run on a microtask, not
 *  inside the synchronous `createRoot` call). */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("pickAutoSwitchTarget", () => {
  it("picks the survivor in the removed tile's slot from raw facts, clamped to the last", () => {
    const [a, b, c, d] = [T("a"), T("b"), T("c"), T("d")];
    // Single departure — removedId is the only leaving id:
    expect(pickAutoSwitchTarget([a, b, c], new Set([b]), b)).toBe(c); // removed middle
    expect(pickAutoSwitchTarget([a, b, c], new Set([a]), a)).toBe(b); // removed first
    expect(pickAutoSwitchTarget([a, b], new Set([b]), b)).toBe(a); // removed last → clamp
    // Batch departure — survivors are the FULL order minus the WHOLE departing
    // set, so focus never lands on a still-departing sibling (the #1667 bug):
    expect(pickAutoSwitchTarget([a, b, c, d], new Set([a, b]), a)).toBe(c); // a,b leave → slot 0 is c
    // removedIndex is indexOf on the FULL pre-removal order, NOT a pruned one:
    // b sits at index 1 of [a,b,c,d] even though its earlier departing sibling a
    // is filtered from survivors [c,d], so slot 1 is d (a pruned-order index would
    // wrongly pick c). Pins the full-order contract when a departing sibling
    // precedes the removed active tile.
    expect(pickAutoSwitchTarget([a, b, c, d], new Set([a, b]), b)).toBe(d);
    expect(pickAutoSwitchTarget([a, b, c], new Set([a, b, c]), a)).toBeNull(); // all leave → null
    // A removedId that was never top-level (indexOf -1) → null:
    expect(pickAutoSwitchTarget([a, b], new Set([c]), c)).toBeNull();
  });
});

/** A `plan…` port spy: it records its arguments at PLAN time and hands back a
 *  no-op actor, so an argument assertion reads exactly as it did when the port
 *  was a plain writer. */
const planSpy = <A extends unknown[]>() =>
  vi.fn<(...args: A) => () => void>(() => () => {});

/** Spy ports for `planEviction`. `activeId` / `focusedTerminalId` /
 *  `activeSubTab` are supplied per-test; the mutating seams are spies. The
 *  census is NOT a port — it always arrives as the required `RemovalGraph`. */
function makePorts(over: {
  activeId?: () => TerminalId | null;
  focusedTerminalId?: () => TerminalId | null;
  activeSubTab?: (parentId: TerminalId) => TerminalId | null;
}) {
  const calls = {
    planPromoteToTopLevel: planSpy<[id: TerminalId, fromTile: TerminalId]>(),
    rehomeUnder: vi.fn<(id: TerminalId, parent: TerminalId) => void>(),
    planActivate: planSpy<[id: TerminalId | null]>(),
    planDropFromMru: planSpy<[id: TerminalId]>(),
    planCollapsePanel: planSpy<[id: TerminalId]>(),
    planCollapsePanelChrome: planSpy<[id: TerminalId]>(),
    setActiveSubTab:
      vi.fn<(parentId: TerminalId, subId: TerminalId | null) => void>(),
    planSelectSubTab: planSpy<
      [parentId: TerminalId, subId: TerminalId | null]
    >(),
    requestRefocus: vi.fn<(id: TerminalId) => void>(),
    removePanel: vi.fn<(id: TerminalId) => void>(),
    removeRightPanel: vi.fn<(id: TerminalId) => void>(),
    removeSearch: vi.fn<(id: TerminalId) => void>(),
  };
  const ports: TerminalEvictionPorts = {
    activeId: over.activeId ?? (() => null),
    focusedTerminalId: over.focusedTerminalId ?? (() => null),
    planActivate: calls.planActivate,
    planDropFromMru: calls.planDropFromMru,
    planPromoteToTopLevel: calls.planPromoteToTopLevel,
    rehomeUnder: calls.rehomeUnder,
    subPanel: {
      planCollapsePanel: calls.planCollapsePanel,
      planCollapsePanelChrome: calls.planCollapsePanelChrome,
      paneChrome: (id: TerminalId) => ({
        activeSubTab: (over.activeSubTab ?? (() => null))(id),
      }),
      setActiveSubTab: calls.setActiveSubTab,
      planSelectSubTab: calls.planSelectSubTab,
      requestRefocus: calls.requestRefocus,
      removePanel: calls.removePanel,
    },
    removeRightPanel: calls.removeRightPanel,
    removeSearch: calls.removeSearch,
  };
  return { ports, calls };
}

/** Intact parent graph for unit tests — the production list path builds the
 *  same shape from its pre-removal snapshot. */
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

describe("planEviction — top-level branch", () => {
  it("promotes subs, sheds chrome, and auto-switches when active", () => {
    const { ports, calls } = makePorts({ activeId: () => T("P") });
    planEviction(
      ports,
      T("P"),
      null,
      [T("P"), T("Q")],
      new Set([T("P")]),
      graph({ P: null, Q: null, S1: "P", S2: "P" }),
    )();

    expect(calls.planPromoteToTopLevel.mock.calls).toEqual([
      [T("S1"), T("P")],
      [T("S2"), T("P")],
    ]);
    expect(calls.removePanel).toHaveBeenCalledWith(T("P"));
    expect(calls.removeRightPanel).toHaveBeenCalledWith(T("P"));
    expect(calls.removeSearch).toHaveBeenCalledWith(T("P"));
    expect(calls.planDropFromMru).toHaveBeenCalledWith(T("P"));
    // Removed at index 0 of [P, Q] → survivor Q.
    expect(calls.planActivate).toHaveBeenCalledWith(T("Q"));
  });

  it("does not auto-switch when the removed tile was not active", () => {
    const { ports, calls } = makePorts({ activeId: () => T("Q") });
    planEviction(
      ports,
      T("P"),
      null,
      [T("P"), T("Q")],
      new Set([T("P")]),
      graph({ P: null, Q: null }),
    )();
    expect(calls.planActivate).not.toHaveBeenCalled();
  });

  it("clamps focus to null when EVERY top-level tile departs in one frame", () => {
    const { ports, calls } = makePorts({ activeId: () => T("A") });
    // A, B, C all leave this frame — no true survivor, so focus falls to null,
    // never onto a still-departing sibling.
    planEviction(
      ports,
      T("A"),
      null,
      [T("A"), T("B"), T("C")],
      new Set([T("A"), T("B"), T("C")]),
      graph({ A: null, B: null, C: null }),
    )();
    expect(calls.planActivate).toHaveBeenCalledWith(null);
  });

  it("skips departing siblings when picking the survivor (partial batch)", () => {
    const { ports, calls } = makePorts({ activeId: () => T("A") });
    // A and B leave together; C and D survive. A sat at index 0 → the survivor in
    // that slot is C, never the departing sibling B.
    planEviction(
      ports,
      T("A"),
      null,
      [T("A"), T("B"), T("C"), T("D")],
      new Set([T("A"), T("B")]),
      graph({ A: null, B: null, C: null, D: null }),
    )();
    expect(calls.planActivate).toHaveBeenCalledWith(T("C"));
  });
});

describe("planEviction — sub-terminal branch", () => {
  it("collapses, clears the tab, and focuses the parent when the focused last sub departs", () => {
    const { ports, calls } = makePorts({
      focusedTerminalId: () => T("S"),
    });
    planEviction(
      ports,
      T("S"),
      T("P"),
      [],
      new Set([T("S")]),
      graph({ P: null, S: "P" }),
    )();
    expect(calls.planCollapsePanel).toHaveBeenCalledWith(T("P"));
    // The active tab is cleared so it can't dangle at the departed sub — the
    // invariant "activeSubTab is null or a live sub" that lets adopt/restore
    // trust a plain null-check.
    expect(calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), null);
    expect(calls.planCollapsePanelChrome).not.toHaveBeenCalled();
    expect(calls.planPromoteToTopLevel).not.toHaveBeenCalled();
  });

  it("sheds a departing SPLIT's own panel state", () => {
    // A split owns a tab, a code mode, per-mode selections and a back/forward
    // stack now, so it must shed them on the way out exactly as a tile does.
    const { ports, calls } = makePorts({ focusedTerminalId: () => T("S") });
    planEviction(
      ports,
      T("S"),
      T("P"),
      [],
      new Set([T("S")]),
      graph({ P: null, S: "P" }),
    )();
    expect(calls.removeRightPanel).toHaveBeenCalledExactlyOnceWith(T("S"));
  });

  it("sheds a departing split's panel state even when NO live ancestor survives", () => {
    // R ← M ← G, and R and M depart with G: the `dest === null` early return must
    // not skip the departing split's panel cleanup.
    const { ports, calls } = makePorts({ focusedTerminalId: () => T("OTHER") });
    planEviction(
      ports,
      T("G"),
      T("M"),
      [],
      new Set([T("R"), T("M"), T("G")]),
      graph({ R: null, M: "R", G: "M" }),
    )();
    expect(calls.removeRightPanel).toHaveBeenCalledExactlyOnceWith(T("G"));
  });

  it("keeps a background tile's focus untouched when its last sub departs", () => {
    const { ports, calls } = makePorts({
      focusedTerminalId: () => T("OTHER"),
    });

    planEviction(
      ports,
      T("S"),
      T("P"),
      [],
      new Set([T("S")]),
      graph({ P: null, S: "P" }),
    )();

    expect(calls.planCollapsePanelChrome).toHaveBeenCalledExactlyOnceWith(
      T("P"),
    );
    expect(calls.planCollapsePanel).not.toHaveBeenCalled();
    expect(calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), null);
    expect(calls.requestRefocus).not.toHaveBeenCalled();
  });

  it("switches the active sub-tab to a sibling and refocuses", () => {
    const { ports, calls } = makePorts({
      activeSubTab: () => T("S1"),
      focusedTerminalId: () => T("S1"),
    });
    planEviction(
      ports,
      T("S1"),
      T("P"),
      [],
      new Set([T("S1")]),
      graph({ P: null, S1: "P", S2: "P" }),
    )();
    expect(calls.planSelectSubTab).toHaveBeenCalledWith(T("P"), T("S2"));
    expect(calls.requestRefocus).toHaveBeenCalledWith(T("P"));
    expect(calls.planCollapsePanel).not.toHaveBeenCalled();
  });

  it("keeps main-pane focus while repairing a departed active sub tab", () => {
    const { ports, calls } = makePorts({
      activeSubTab: () => T("S1"),
      focusedTerminalId: () => T("P"),
    });
    planEviction(
      ports,
      T("S1"),
      T("P"),
      [],
      new Set([T("S1")]),
      graph({ P: null, S1: "P", S2: "P" }),
    )();
    expect(calls.setActiveSubTab).toHaveBeenCalledExactlyOnceWith(
      T("P"),
      T("S2"),
    );
    expect(calls.planSelectSubTab).not.toHaveBeenCalled();
    expect(calls.requestRefocus).toHaveBeenCalledExactlyOnceWith(T("P"));
  });

  it("repairs a tab dangling at a pane that departed WITH its own parent", () => {
    // R ← M ← G, and R ← S. Close M and G in one frame; R's active tab was G.
    // The pre-fix rule asked only "is the active tab the id being evicted?" (M)
    // and missed G, leaving the strip pointing at a terminal that is gone —
    // exactly the dangling state the invariant forbids.
    const { ports, calls } = makePorts({
      activeSubTab: () => T("G"),
      focusedTerminalId: () => T("OTHER"),
    });
    planEviction(
      ports,
      T("M"),
      T("R"),
      [],
      new Set([T("M"), T("G")]),
      graph({ R: null, M: "R", G: "M", S: "R" }),
    )();
    expect(calls.setActiveSubTab).toHaveBeenCalledExactlyOnceWith(
      T("R"),
      T("S"),
    );
  });

  it("re-homes a middle terminal's children to the root (does not kill them)", () => {
    // R ← M ← G; close M. G must become a child of R, chrome repaired on R.
    const { ports, calls } = makePorts({
      activeSubTab: () => T("M"),
      focusedTerminalId: () => T("M"),
    });
    // Pre-removal graph (list-driven snapshot still has M←G after M left live keys).
    planEviction(
      ports,
      T("M"),
      T("R"),
      [T("R")],
      new Set([T("M")]),
      graph({ R: null, M: "R", G: "M" }),
    )();
    expect(calls.rehomeUnder).toHaveBeenCalledExactlyOnceWith(T("G"), T("R"));
    // Flat remaining under R after M leaves: G (and the departed M filtered out).
    expect(calls.planSelectSubTab).toHaveBeenCalledWith(T("R"), T("G"));
    expect(calls.planPromoteToTopLevel).not.toHaveBeenCalled();
  });

  it("promotes grandchildren when the whole ancestor chain departs in one frame", () => {
    // R and M leave together; G survives → promote G, no chrome under dead R.
    const { ports, calls } = makePorts({
      focusedTerminalId: () => T("M"),
    });
    planEviction(
      ports,
      T("M"),
      T("R"),
      [T("R")],
      new Set([T("R"), T("M")]),
      graph({ R: null, M: "R", G: "M" }),
    )();
    expect(calls.planPromoteToTopLevel).toHaveBeenCalledExactlyOnceWith(
      T("G"),
      T("R"),
    );
    expect(calls.rehomeUnder).not.toHaveBeenCalled();
    expect(calls.planCollapsePanel).not.toHaveBeenCalled();
    expect(calls.planSelectSubTab).not.toHaveBeenCalled();
  });

  it("re-homes under the root even when a middle parent survives", () => {
    // R ← P ← M ← G; only M closes. G rehomes to R (not P); chrome on R.
    const { ports, calls } = makePorts({
      activeSubTab: () => T("M"),
      focusedTerminalId: () => T("M"),
    });
    planEviction(
      ports,
      T("M"),
      T("P"),
      [T("R")],
      new Set([T("M")]),
      graph({ R: null, P: "R", M: "P", G: "M" }),
    )();
    expect(calls.rehomeUnder).toHaveBeenCalledExactlyOnceWith(T("G"), T("R"));
    // Active tab was M; replacement is first remaining flat pane under R (P or G).
    expect(calls.planSelectSubTab).toHaveBeenCalledWith(
      T("R"),
      expect.stringMatching(/^(P|G)$/),
    );
    expect(calls.planPromoteToTopLevel).not.toHaveBeenCalled();
  });
});

const emptyGraph = graph({ P: null });

describe("createEvictionDedup", () => {
  it("skips a departed id already evicted by the imperative path (no double)", () => {
    // `runEvict` is the planner's ACTOR — the writes an eviction owes — so a
    // claim that short-circuits the actor is what this counts.
    const runEvict = vi.fn();
    const d = createEvictionDedup(() => runEvict);
    d.evictImperatively(T("P"), null, [T("P")], true, emptyGraph); // kill: claim + evict
    d.planEvictDeparted(
      T("P"),
      null,
      [T("P")],
      new Set([T("P")]),
      emptyGraph,
    )(); // the later list-drop
    expect(runEvict).toHaveBeenCalledTimes(1); // NOT twice
  });

  it("runs the cleanup for an UNCLAIMED departure (natural exit)", () => {
    const runEvict = vi.fn();
    const d = createEvictionDedup(() => runEvict);
    d.planEvictDeparted(
      T("P"),
      null,
      [T("P")],
      new Set([T("P")]),
      emptyGraph,
    )();
    expect(runEvict).toHaveBeenCalledTimes(1);
  });

  it("does not claim when no list-drop will follow (willDrop=false)", () => {
    const runEvict = vi.fn();
    const d = createEvictionDedup(() => runEvict);
    d.evictImperatively(T("P"), null, [T("P")], false, emptyGraph); // already-gone kill
    d.planEvictDeparted(
      T("P"),
      null,
      [T("P")],
      new Set([T("P")]),
      emptyGraph,
    )(); // an unrelated later departure
    expect(runEvict).toHaveBeenCalledTimes(2); // not skipped → no stale claim leak
  });
});

/** Mount `useActiveReconcile` over the REAL `planEviction` + dedup, with spy
 *  ports and signal-backed list/parents — so a list-drop drives the full
 *  cleanup end-to-end. `getSubTerminalIds` derives from the live list, like the
 *  real store. */
function setupReconcile(init: {
  rawIds: TerminalId[];
  parents: Record<string, TerminalId | null>;
  activeId?: TerminalId | null;
  focusedTerminalId?: TerminalId | null;
  activeSubTab?: Record<string, TerminalId | null>;
  /** Daemon-connected gate (FIX 1). Defaults to CONNECTED so the existing
   *  cleanup tests are unchanged; a supervised-drain test flips it false. */
  connected?: boolean;
  /** Active-host key. Defaults to a stable "local" so the existing single-host
   *  cleanup tests are unchanged; the host-switch test flips it to prove a switch
   *  resets the baseline rather than evicting the departed host's tiles. */
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
    calls.planActivate.mockImplementation((id) => () => {
      state.active = id;
    });
    const eviction = createEvictionDedup(
      (id, parentId, topLevelBefore, departing, removal) =>
        planEviction(ports, id, parentId, topLevelBefore, departing, removal),
    );
    useActiveReconcile({
      rawList: rawIds,
      parentOf: (id) => parents()[id] ?? null,
      activeHostKey: host,
      planEvictDeparted: eviction.planEvictDeparted,
      listIsAuthoritative: connected,
    });
    handles = {
      setRawIds,
      setParents,
      setConnected,
      setHost,
      // Tests call with the 4-arg shape; wrap to supply the live parent graph.
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

    // P's PTY exits — dropped from the list, sub S and top-level Q remain, and
    // NO terminalExit event fires.
    h.setRawIds([T("S"), T("Q")]);

    expect(h.calls.planPromoteToTopLevel).toHaveBeenCalledWith(T("S"), T("P"));
    expect(h.calls.removePanel).toHaveBeenCalledWith(T("P"));
    expect(h.calls.removeRightPanel).toHaveBeenCalledWith(T("P"));
    expect(h.calls.removeSearch).toHaveBeenCalledWith(T("P"));
    // P was active and at index 0 of [P, Q] → focus falls to survivor Q.
    expect(h.calls.planActivate).toHaveBeenCalledWith(T("Q"));
    h.dispose();
  });

  it("(a2) a list-driven promotion carries the from-tile the LIVE graph no longer has", async () => {
    const h = setupReconcile({
      rawIds: [T("P"), T("S")],
      parents: { P: null, S: T("P") },
      activeId: T("P"),
    });
    await tick();

    // P's PTY exits: the live census loses P ENTIRELY — the list AND the parent
    // edges. A live `containingTile` walk would therefore dangle and answer "S
    // itself", silently skipping the posture inheritance. The from-tile must come
    // from the pre-removal snapshot the reconcile carries.
    h.setParents({ S: null });
    h.setRawIds([T("S")]);

    expect(h.calls.planPromoteToTopLevel).toHaveBeenCalledExactlyOnceWith(
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

    // S1's PTY exits — the sub leaves the list; its parentId is gone from
    // metadata but was captured in the pre-removal snapshot.
    h.setRawIds([T("P"), T("S2")]);

    expect(h.calls.planSelectSubTab).toHaveBeenCalledWith(T("P"), T("S2"));
    expect(h.calls.requestRefocus).toHaveBeenCalledWith(T("P"));
    expect(h.calls.planPromoteToTopLevel).not.toHaveBeenCalled();
    h.dispose();
  });

  it("(c) kill path does the full cleanup once — the list-drop reconcile is a no-op", async () => {
    const h = setupReconcile({
      rawIds: [T("P"), T("S")],
      parents: { P: null, S: T("P") },
      activeId: T("P"),
    });
    await tick();

    // handleKill's imperative path evicts synchronously (subs still present),
    // claiming P.
    h.evictImperatively(T("P"), null, [T("P")], true);
    expect(h.calls.planPromoteToTopLevel).toHaveBeenCalledTimes(1);

    // The kill's list-drop then arrives → reconcile must skip (claimed).
    h.setRawIds([T("S")]);

    expect(h.calls.planPromoteToTopLevel).toHaveBeenCalledTimes(1); // NOT twice
    h.dispose();
  });

  it("(d) SUPPRESSES the eviction while the daemon is NOT connected (supervised drain)", async () => {
    // A `recycleKaval` restart holds `restarting` (published BEFORE the drain), so
    // the client sees the daemon not-connected while the drain empties the list.
    // The departures are the server's doing and are undone by restore, so the
    // reconcile must NOT fire its authoritative `chrome.setParent(sub,null)`
    // promote (the "Failed to set parent" toast) — nor any other eviction.
    const h = setupReconcile({
      rawIds: [T("P"), T("S")],
      parents: { P: null, S: T("P") },
      activeId: T("P"),
      connected: false,
    });
    await tick();

    // The drain empties the whole list — parent P and its sub S both leave.
    h.setRawIds([]);

    expect(h.calls.planPromoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.removePanel).not.toHaveBeenCalled();
    expect(h.calls.removeRightPanel).not.toHaveBeenCalled();
    expect(h.calls.planDropFromMru).not.toHaveBeenCalled();
    expect(h.calls.planActivate).not.toHaveBeenCalled();
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

    h.setRawIds([]); // supervised drain → suppressed
    expect(h.calls.planPromoteToTopLevel).not.toHaveBeenCalled();

    // Reconnect, then the canvas repopulates with a DIFFERENT set. A restore is no
    // longer that case — it brings every terminal back under its saved id, which is
    // a plain re-arrival — but "Start fresh" (forfeit the parked rows, then create)
    // and a host whose terminals genuinely ended both land here, and they are the
    // adverse shape: the prior P/S departure was already folded into the snapshot's
    // `prev` (advanced past it while suppressed), so it is never re-processed, and
    // ids nobody has seen are an arrival rather than a departure. Pinned with new
    // ids BECAUSE a same-id return would pass vacuously: `prev` and the live set
    // would agree and there would be no departure to replay.
    h.setConnected(true);
    h.setParents({ P2: null, S2: T("P2") });
    h.setRawIds([T("P2"), T("S2")]);

    expect(h.calls.planPromoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.removePanel).not.toHaveBeenCalled();
    expect(h.calls.planActivate).not.toHaveBeenCalled();
    h.dispose();
  });

  it("(f) connected batch departure of EVERY top-level tile clamps focus to null (not a dead id)", async () => {
    // All top-level tiles [A,B,C] depart in ONE frame while CONNECTED (a user
    // close-all, not a supervised drain), active A. The auto-switch must clamp to
    // null — there is no survivor. The bug: it filtered only the id being
    // processed out of the pre-removal order, so it landed focus on B (itself a
    // departed id), then echoed that dead id to the server via chrome.setActive.
    const h = setupReconcile({
      rawIds: [T("A"), T("B"), T("C")],
      parents: { A: null, B: null, C: null },
      activeId: T("A"),
    });
    await tick();

    h.setRawIds([]); // every top-level tile leaves at once

    // Focus falls to null — never to a departed id.
    expect(h.calls.planActivate).toHaveBeenCalledWith(null);
    expect(h.calls.planActivate).not.toHaveBeenCalledWith(T("B"));
    expect(h.calls.planActivate).not.toHaveBeenCalledWith(T("C"));
    h.dispose();
  });

  it("(g) connected batch departure keeps focus on a real survivor when some remain", async () => {
    // A,B depart together (active A); C,D survive. Focus must land on a LIVE
    // survivor (the tile now in A's slot), never on the departing sibling B.
    const h = setupReconcile({
      rawIds: [T("A"), T("B"), T("C"), T("D")],
      parents: { A: null, B: null, C: null, D: null },
      activeId: T("A"),
    });
    await tick();

    h.setRawIds([T("C"), T("D")]);

    // A sat at index 0; true survivors are [C,D]; slot 0 → C.
    expect(h.calls.planActivate).toHaveBeenCalledWith(T("C"));
    expect(h.calls.planActivate).not.toHaveBeenCalledWith(T("B"));
    h.dispose();
  });

  it("(h) two rapid imperative closes don't re-focus the first (still-claimed) tile", async () => {
    // The imperative close path reads the LIVE top-level list, which only shrinks
    // when the server's list-drop lands — NOT synchronously on kill. So closing A
    // then B before A's drop arrives feeds B's eviction a `topLevelBefore` that
    // STILL contains the already-killed A. Focus must clamp past every id closed
    // this frame (both A and B are in the dedup's `claimed` set), never back onto
    // the dead A — otherwise it's #1667 via the imperative path, with no self-heal
    // (the later list-drops short-circuit on `claimed`).
    const h = setupReconcile({
      rawIds: [T("A"), T("B")],
      parents: { A: null, B: null },
      activeId: T("A"),
    });
    await tick();

    // Close A imperatively (claims A) → focus falls to the live survivor B.
    h.evictImperatively(T("A"), null, [T("A"), T("B")], true);
    expect(h.calls.planActivate).toHaveBeenLastCalledWith(T("B"));

    // Close B before A's list-drop lands — the live list still holds A, but A is
    // claimed, so focus clamps to null, not back onto the dead A.
    h.evictImperatively(T("B"), null, [T("A"), T("B")], true);
    expect(h.calls.planActivate).toHaveBeenLastCalledWith(null);
    expect(h.calls.planActivate).not.toHaveBeenCalledWith(T("A"));
    h.dispose();
  });

  it("does nothing when a terminal is ADDED (create) or on mount", async () => {
    const h = setupReconcile({
      rawIds: [T("P")],
      parents: { P: null },
      activeId: T("P"),
    });
    await tick();
    expect(h.calls.planActivate).not.toHaveBeenCalled();

    // A create pushes Q into the list — an arrival, not a departure.
    h.setParents({ P: null, Q: null });
    h.setRawIds([T("P"), T("Q")]);

    expect(h.calls.planPromoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.removePanel).not.toHaveBeenCalled();
    expect(h.calls.planActivate).not.toHaveBeenCalled();
    h.dispose();
  });

  it("(f) a HOST SWITCH resets the baseline — the departed host's tiles are NOT evicted", async () => {
    // Host A active: a parent P with sub S, plus top-level Q; P is the active tile.
    const h = setupReconcile({
      rawIds: [T("P"), T("S"), T("Q")],
      parents: { P: null, S: T("P"), Q: null },
      activeId: T("P"),
      host: "local",
    });
    await tick();

    // Switch to host B: the host token flips AND the list re-keys to a DISJOINT id
    // space together (one atomic switch — `activeHost` and the host-scoped list
    // re-key in lockstep). Every host-A id "leaves" the list, but they didn't
    // close — the tab just looked away. NONE of the departure cleanup may fire:
    // no wrong-host promote (setParent) of P's sub, no auto-switch off P.
    h.setParents({ B1: null, B2: null });
    h.setRawIds([T("B1"), T("B2")]);
    h.setHost("remote:B");

    expect(h.calls.planPromoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.planDropFromMru).not.toHaveBeenCalled();
    expect(h.calls.planActivate).not.toHaveBeenCalled();

    // And a REAL close on host B still reconciles normally (baseline advanced to B).
    h.setParents({ B1: null });
    h.setRawIds([T("B1")]);
    expect(h.calls.planDropFromMru).toHaveBeenCalledWith(T("B2"));
    h.dispose();
  });
});
