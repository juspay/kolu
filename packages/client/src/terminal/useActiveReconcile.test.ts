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

/** Let SolidJS flush the queued reactive effects (they don't run inside the
 *  synchronous `createRoot` batch). After this, signal writes made OUTSIDE the
 *  batch flush the reconcile effect synchronously. */
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("pickAutoSwitchTarget", () => {
  it("picks the survivor now in the removed tile's slot, clamped to the last", () => {
    expect(pickAutoSwitchTarget([T("a"), T("c")], 1)).toBe(T("c")); // removed middle
    expect(pickAutoSwitchTarget([T("b"), T("c")], 0)).toBe(T("b")); // removed first
    expect(pickAutoSwitchTarget([T("a"), T("b")], 2)).toBe(T("b")); // removed last → clamp
    expect(pickAutoSwitchTarget([], 0)).toBeNull(); // nothing left
    expect(pickAutoSwitchTarget([T("a")], -1)).toBeNull(); // never top-level → null
  });
});

/** Spy ports for `evictTerminal`. `getSubTerminalIds` / `activeId` /
 *  `activeSubTab` are supplied per-test; the mutating seams are spies. */
function makePorts(over: {
  getSubTerminalIds?: (parentId: TerminalId) => readonly TerminalId[];
  activeId?: () => TerminalId | null;
  activeSubTab?: (parentId: TerminalId) => TerminalId | null;
}) {
  const calls = {
    promoteToTopLevel: vi.fn<(id: TerminalId) => void>(),
    activate: vi.fn<(id: TerminalId | null) => void>(),
    dropFromMru: vi.fn<(id: TerminalId) => void>(),
    collapse: vi.fn<(id: TerminalId) => void>(),
    setActiveSubTab:
      vi.fn<(parentId: TerminalId, subId: TerminalId | null) => void>(),
    requestRefocus: vi.fn<(id: TerminalId) => void>(),
    removeSub: vi.fn<(id: TerminalId) => void>(),
    removeRightPanel: vi.fn<(id: TerminalId) => void>(),
    removeSearch: vi.fn<(id: TerminalId) => void>(),
  };
  const ports: TerminalEvictionPorts = {
    getSubTerminalIds: over.getSubTerminalIds ?? (() => []),
    activeId: over.activeId ?? (() => null),
    activate: calls.activate,
    dropFromMru: calls.dropFromMru,
    promoteToTopLevel: calls.promoteToTopLevel,
    subPanel: {
      collapse: calls.collapse,
      activeSubTab: over.activeSubTab ?? (() => null),
      setActiveSubTab: calls.setActiveSubTab,
      requestRefocus: calls.requestRefocus,
      remove: calls.removeSub,
    },
    removeRightPanel: calls.removeRightPanel,
    removeSearch: calls.removeSearch,
  };
  return { ports, calls };
}

describe("evictTerminal — top-level branch", () => {
  it("promotes subs, sheds chrome, and auto-switches when active", () => {
    const { ports, calls } = makePorts({
      getSubTerminalIds: (p) => (p === T("P") ? [T("S1"), T("S2")] : []),
      activeId: () => T("P"),
    });
    evictTerminal(ports, T("P"), null, [T("P"), T("Q")], new Set([T("P")]));

    expect(calls.promoteToTopLevel.mock.calls).toEqual([[T("S1")], [T("S2")]]);
    expect(calls.removeSub).toHaveBeenCalledWith(T("P"));
    expect(calls.removeRightPanel).toHaveBeenCalledWith(T("P"));
    expect(calls.removeSearch).toHaveBeenCalledWith(T("P"));
    expect(calls.dropFromMru).toHaveBeenCalledWith(T("P"));
    // Removed at index 0 of [P, Q] → survivor Q.
    expect(calls.activate).toHaveBeenCalledWith(T("Q"));
  });

  it("does not auto-switch when the removed tile was not active", () => {
    const { ports, calls } = makePorts({ activeId: () => T("Q") });
    evictTerminal(ports, T("P"), null, [T("P"), T("Q")], new Set([T("P")]));
    expect(calls.activate).not.toHaveBeenCalled();
  });

  it("clamps focus to null when EVERY top-level tile departs in one frame", () => {
    const { ports, calls } = makePorts({ activeId: () => T("A") });
    // A, B, C all leave this frame — no true survivor, so focus falls to null,
    // never onto a still-departing sibling.
    evictTerminal(
      ports,
      T("A"),
      null,
      [T("A"), T("B"), T("C")],
      new Set([T("A"), T("B"), T("C")]),
    );
    expect(calls.activate).toHaveBeenCalledWith(null);
  });

  it("skips departing siblings when picking the survivor (partial batch)", () => {
    const { ports, calls } = makePorts({ activeId: () => T("A") });
    // A and B leave together; C and D survive. A sat at index 0 → the survivor in
    // that slot is C, never the departing sibling B.
    evictTerminal(
      ports,
      T("A"),
      null,
      [T("A"), T("B"), T("C"), T("D")],
      new Set([T("A"), T("B")]),
    );
    expect(calls.activate).toHaveBeenCalledWith(T("C"));
  });
});

describe("evictTerminal — sub-terminal branch", () => {
  it("collapses the parent's panel AND clears the active tab when the last sub departs", () => {
    const { ports, calls } = makePorts({
      getSubTerminalIds: () => [], // no siblings remain
    });
    evictTerminal(ports, T("S"), T("P"), [], new Set([T("S")]));
    expect(calls.collapse).toHaveBeenCalledWith(T("P"));
    // The active tab is cleared so it can't dangle at the departed sub — the
    // invariant "activeSubTab is null or a live sub" that lets adopt/restore
    // trust a plain null-check.
    expect(calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), null);
    expect(calls.promoteToTopLevel).not.toHaveBeenCalled();
  });

  it("switches the active sub-tab to a sibling and refocuses", () => {
    const { ports, calls } = makePorts({
      getSubTerminalIds: (p) => (p === T("P") ? [T("S2")] : []), // S1 already gone
      activeSubTab: () => T("S1"),
    });
    evictTerminal(ports, T("S1"), T("P"), [], new Set([T("S1")]));
    expect(calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), T("S2"));
    expect(calls.requestRefocus).toHaveBeenCalledWith(T("P"));
    expect(calls.collapse).not.toHaveBeenCalled();
  });

  it("refocuses without switching when the removed sub was not the active tab", () => {
    const { ports, calls } = makePorts({
      getSubTerminalIds: (p) => (p === T("P") ? [T("S2")] : []),
      activeSubTab: () => T("S2"), // a different tab is active
    });
    evictTerminal(ports, T("S1"), T("P"), [], new Set([T("S1")]));
    expect(calls.setActiveSubTab).not.toHaveBeenCalled();
    expect(calls.requestRefocus).toHaveBeenCalledWith(T("P"));
  });
});

describe("createEvictionDedup", () => {
  it("skips a departed id already evicted by the imperative path (no double)", () => {
    const runEvict = vi.fn();
    const d = createEvictionDedup(runEvict);
    d.evictImperatively(T("P"), null, [T("P")], true); // kill: claim + evict
    d.evictDeparted(T("P"), null, [T("P")], new Set([T("P")])); // the later list-drop
    expect(runEvict).toHaveBeenCalledTimes(1); // NOT twice
  });

  it("runs the cleanup for an UNCLAIMED departure (natural exit)", () => {
    const runEvict = vi.fn();
    const d = createEvictionDedup(runEvict);
    d.evictDeparted(T("P"), null, [T("P")], new Set([T("P")]));
    expect(runEvict).toHaveBeenCalledTimes(1);
  });

  it("does not claim when no list-drop will follow (willDrop=false)", () => {
    const runEvict = vi.fn();
    const d = createEvictionDedup(runEvict);
    d.evictImperatively(T("P"), null, [T("P")], false); // already-gone kill
    d.evictDeparted(T("P"), null, [T("P")], new Set([T("P")])); // an unrelated later departure
    expect(runEvict).toHaveBeenCalledTimes(2); // not skipped → no stale claim leak
  });
});

/** Mount `useActiveReconcile` over the REAL `evictTerminal` + dedup, with spy
 *  ports and signal-backed list/parents — so a list-drop drives the full
 *  cleanup end-to-end. `getSubTerminalIds` derives from the live list, like the
 *  real store. */
function setupReconcile(init: {
  rawIds: TerminalId[];
  parents: Record<string, TerminalId | null>;
  activeId?: TerminalId | null;
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
    activeSubTab: init.activeSubTab ?? {},
  };
  let handles!: {
    setRawIds: (v: TerminalId[]) => void;
    setParents: (v: Record<string, TerminalId | null>) => void;
    setConnected: (v: boolean) => void;
    setHost: (v: string) => void;
    evictImperatively: ReturnType<
      typeof createEvictionDedup
    >["evictImperatively"];
    calls: ReturnType<typeof makePorts>["calls"];
    dispose: () => void;
  };
  createRoot((dispose) => {
    const [rawIds, setRawIds] = createSignal<TerminalId[]>(init.rawIds);
    const [parents, setParents] = createSignal(init.parents);
    const [connected, setConnected] = createSignal(init.connected ?? true);
    const [host, setHost] = createSignal(init.host ?? "local");
    const { ports, calls } = makePorts({
      getSubTerminalIds: (pid) =>
        rawIds().filter((id) => (parents()[id] ?? null) === pid),
      activeId: () => state.active,
      activeSubTab: (pid) => state.activeSubTab[pid] ?? null,
    });
    calls.activate.mockImplementation((id) => {
      state.active = id;
    });
    const eviction = createEvictionDedup(
      (id, parentId, topLevelBefore, departing) =>
        evictTerminal(ports, id, parentId, topLevelBefore, departing),
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
      evictImperatively: eviction.evictImperatively,
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

    expect(h.calls.promoteToTopLevel).toHaveBeenCalledWith(T("S"));
    expect(h.calls.removeSub).toHaveBeenCalledWith(T("P"));
    expect(h.calls.removeRightPanel).toHaveBeenCalledWith(T("P"));
    expect(h.calls.removeSearch).toHaveBeenCalledWith(T("P"));
    // P was active and at index 0 of [P, Q] → focus falls to survivor Q.
    expect(h.calls.activate).toHaveBeenCalledWith(T("Q"));
    h.dispose();
  });

  it("(b) natural SUB exit switches the parent's sub-panel via the captured parentId", async () => {
    const h = setupReconcile({
      rawIds: [T("P"), T("S1"), T("S2")],
      parents: { P: null, S1: T("P"), S2: T("P") },
      activeSubTab: { P: T("S1") },
    });
    await tick();

    // S1's PTY exits — the sub leaves the list; its parentId is gone from
    // metadata but was captured in the pre-removal snapshot.
    h.setRawIds([T("P"), T("S2")]);

    expect(h.calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), T("S2"));
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

    // handleKill's imperative path evicts synchronously (subs still present),
    // claiming P.
    h.evictImperatively(T("P"), null, [T("P")], true);
    expect(h.calls.promoteToTopLevel).toHaveBeenCalledTimes(1);

    // The kill's list-drop then arrives → reconcile must skip (claimed).
    h.setRawIds([T("S")]);

    expect(h.calls.promoteToTopLevel).toHaveBeenCalledTimes(1); // NOT twice
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

    expect(h.calls.promoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.removeSub).not.toHaveBeenCalled();
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

    h.setRawIds([]); // supervised drain → suppressed
    expect(h.calls.promoteToTopLevel).not.toHaveBeenCalled();

    // Reconnect, then restore repopulates with a FRESH set (new ids). The prior
    // P/S departure was already folded into the snapshot's `prev` (advanced past
    // it while suppressed), so it is never re-processed; the fresh ids are an
    // arrival, not a departure.
    h.setConnected(true);
    h.setParents({ P2: null, S2: T("P2") });
    h.setRawIds([T("P2"), T("S2")]);

    expect(h.calls.promoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.removeSub).not.toHaveBeenCalled();
    expect(h.calls.activate).not.toHaveBeenCalled();
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
    expect(h.calls.activate).toHaveBeenCalledWith(null);
    expect(h.calls.activate).not.toHaveBeenCalledWith(T("B"));
    expect(h.calls.activate).not.toHaveBeenCalledWith(T("C"));
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
    expect(h.calls.activate).toHaveBeenCalledWith(T("C"));
    expect(h.calls.activate).not.toHaveBeenCalledWith(T("B"));
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

    // A create pushes Q into the list — an arrival, not a departure.
    h.setParents({ P: null, Q: null });
    h.setRawIds([T("P"), T("Q")]);

    expect(h.calls.promoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.removeSub).not.toHaveBeenCalled();
    expect(h.calls.activate).not.toHaveBeenCalled();
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
    batch(() => {
      h.setParents({ B1: null, B2: null });
      h.setRawIds([T("B1"), T("B2")]);
      h.setHost("remote:B");
    });

    expect(h.calls.promoteToTopLevel).not.toHaveBeenCalled();
    expect(h.calls.dropFromMru).not.toHaveBeenCalled();
    expect(h.calls.activate).not.toHaveBeenCalled();

    // And a REAL close on host B still reconciles normally (baseline advanced to B).
    batch(() => {
      h.setParents({ B1: null });
      h.setRawIds([T("B1")]);
    });
    expect(h.calls.dropFromMru).toHaveBeenCalledWith(T("B2"));
    h.dispose();
  });
});
