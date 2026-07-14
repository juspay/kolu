import type { TerminalId } from "kolu-common/surface";
import { batch, createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { HydrationPhase } from "../hostScope/createSessionRestore";
import { type SplitAdoptPorts, useAdoptNewSplit } from "./useAdoptNewSplit";

const T = (s: string) => s as TerminalId;

/** Let SolidJS flush queued effects (they don't run inside the synchronous
 *  `createRoot` batch). After this, signal writes made OUTSIDE the batch flush
 *  the adopt effect synchronously — mirrors useActiveReconcile.test. */
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Mount `useAdoptNewSplit` over signal-backed list/parents/host/phase, with spy
 *  sub-panel ports. `activeSubTab` reads a mutable per-parent map so a test can
 *  pin a parent as already-having-an-active-tab (the don't-steal case). */
function setupAdopt(init: {
  rawIds: TerminalId[];
  parents: Record<string, TerminalId | null>;
  phase?: HydrationPhase;
  host?: string;
  activeSubTab?: Record<string, TerminalId | null>;
}) {
  const state = { activeSubTab: init.activeSubTab ?? {} };
  const calls = {
    expandPanel: vi.fn<(parentId: TerminalId) => void>(),
    setActiveSubTab: vi.fn<(parentId: TerminalId, subId: TerminalId) => void>(),
  };
  let handles!: {
    setRawIds: (v: TerminalId[]) => void;
    setParents: (v: Record<string, TerminalId | null>) => void;
    setPhase: (v: HydrationPhase) => void;
    setHost: (v: string) => void;
    /** Pin a parent's active sub-tab (what the sub-panel would report live). */
    setActiveTab: (parentId: string, subId: TerminalId | null) => void;
    calls: typeof calls;
    dispose: () => void;
  };
  createRoot((dispose) => {
    const [rawIds, setRawIds] = createSignal<TerminalId[]>(init.rawIds);
    const [parents, setParents] = createSignal(init.parents);
    const [phase, setPhase] = createSignal<HydrationPhase>(
      init.phase ?? "seeded",
    );
    const [host, setHost] = createSignal(init.host ?? "local");
    const ports: SplitAdoptPorts = {
      expandPanel: calls.expandPanel,
      activeSubTab: (parentId) => state.activeSubTab[parentId] ?? null,
      setActiveSubTab: calls.setActiveSubTab,
    };
    useAdoptNewSplit({
      rawList: rawIds,
      parentOf: (id) => parents()[id] ?? null,
      activeHostKey: host,
      restorePhase: phase,
      ports,
    });
    handles = {
      setRawIds,
      setParents,
      setPhase,
      setHost,
      setActiveTab: (p, s) => {
        state.activeSubTab[p] = s;
      },
      calls,
      dispose,
    };
  });
  return handles;
}

describe("useAdoptNewSplit — adopt an externally-created split", () => {
  it("(a) a new split in a seeded session expands the panel AND selects the tab", async () => {
    // Parent P exists (top-level), no splits yet.
    const h = setupAdopt({ rawIds: [T("P")], parents: { P: null } });
    await tick();
    expect(h.calls.expandPanel).not.toHaveBeenCalled();

    // padi-tui creates a split under P — arrives on the list with parentId = P.
    batch(() => {
      h.setParents({ P: null, S: T("P") });
      h.setRawIds([T("P"), T("S")]);
    });

    expect(h.calls.expandPanel).toHaveBeenCalledWith(T("P"));
    expect(h.calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), T("S"));
    h.dispose();
  });

  it("(b) don't steal — a new split expands but does NOT select when one is already active", async () => {
    // P already has an active split S1 the user is working in.
    const h = setupAdopt({
      rawIds: [T("P"), T("S1")],
      parents: { P: null, S1: T("P") },
      activeSubTab: { P: T("S1") },
    });
    await tick();

    // A second split S2 arrives via padi-tui.
    batch(() => {
      h.setParents({ P: null, S1: T("P"), S2: T("P") });
      h.setRawIds([T("P"), T("S1"), T("S2")]);
    });

    expect(h.calls.expandPanel).toHaveBeenCalledWith(T("P")); // still opens
    expect(h.calls.setActiveSubTab).not.toHaveBeenCalled(); // but doesn't yank focus
    h.dispose();
  });

  it("(c) does NOT adopt during load/restore (phase not seeded), then DOES adopt a later live arrival", async () => {
    // Initial load: the host has not seeded yet, and a restored split streams in.
    const h = setupAdopt({
      rawIds: [T("P")],
      parents: { P: null },
      phase: "decided",
    });
    await tick();

    // Restored split S1 arrives while NOT seeded — hydration owns its tab, so the
    // adopt hook must stay quiet (but record S1 as baseline).
    batch(() => {
      h.setParents({ P: null, S1: T("P") });
      h.setRawIds([T("P"), T("S1")]);
    });
    expect(h.calls.expandPanel).not.toHaveBeenCalled();
    expect(h.calls.setActiveSubTab).not.toHaveBeenCalled();

    // Session seeds. Flipping phase alone must NOT retroactively adopt S1 — it's
    // baseline, not an arrival (phase is sampled, so the effect doesn't even run).
    h.setPhase("seeded");
    await tick();
    expect(h.calls.expandPanel).not.toHaveBeenCalled();

    // NOW a genuinely-new split S2 arrives live → adopted.
    batch(() => {
      h.setParents({ P: null, S1: T("P"), S2: T("P") });
      h.setRawIds([T("P"), T("S1"), T("S2")]);
    });
    expect(h.calls.expandPanel).toHaveBeenCalledWith(T("P"));
    expect(h.calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), T("S2"));
    // S1 was never adopted.
    expect(h.calls.setActiveSubTab).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it("(b2) don't-steal is LIVE-only — a new split IS selected when the active tab is stale (departed sub)", async () => {
    // P once had split S1 (so activeSubTab still points at S1) but S1 was closed —
    // the reconcile collapsed the panel and left activeSubTab dangling at the gone
    // S1. S1 is NOT among P's current subs.
    const h = setupAdopt({
      rawIds: [T("P")],
      parents: { P: null },
      activeSubTab: { P: T("S1") }, // stale — S1 already departed
    });
    await tick();

    // A fresh split S2 arrives via padi-tui. A non-null-only guard would skip
    // selecting (activeSubTab === S1 !== null) and open S2 behind the dead tab;
    // the liveness guard sees S1 is not a live sub of P and selects S2.
    batch(() => {
      h.setParents({ P: null, S2: T("P") });
      h.setRawIds([T("P"), T("S2")]);
    });

    expect(h.calls.expandPanel).toHaveBeenCalledWith(T("P"));
    expect(h.calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), T("S2"));
    h.dispose();
  });

  it("(d) a top-level arrival is ignored — only splits (parentId) are adopted", async () => {
    const h = setupAdopt({ rawIds: [T("P")], parents: { P: null } });
    await tick();

    // A second top-level tile Q — not a split.
    batch(() => {
      h.setParents({ P: null, Q: null });
      h.setRawIds([T("P"), T("Q")]);
    });

    expect(h.calls.expandPanel).not.toHaveBeenCalled();
    expect(h.calls.setActiveSubTab).not.toHaveBeenCalled();
    h.dispose();
  });

  it("(e) subs present at mount are baseline — never adopted", async () => {
    // Reload lands with a split already present (hydration will restore its state).
    const h = setupAdopt({
      rawIds: [T("P"), T("S")],
      parents: { P: null, S: T("P") },
    });
    await tick();

    expect(h.calls.expandPanel).not.toHaveBeenCalled();
    expect(h.calls.setActiveSubTab).not.toHaveBeenCalled();
    h.dispose();
  });

  it("(f) a HOST SWITCH rebaselines — the switched-to host's existing splits are NOT adopted", async () => {
    // Host A: parent P with split S already open.
    const h = setupAdopt({
      rawIds: [T("P"), T("S")],
      parents: { P: null, S: T("P") },
      host: "local",
    });
    await tick();

    // Switch to host B, whose list already carries a split (B2 under B1). The host
    // token flips AND the list re-keys together — B's existing split must NOT be
    // read as an arrival.
    batch(() => {
      h.setParents({ B1: null, B2: T("B1") });
      h.setRawIds([T("B1"), T("B2")]);
      h.setHost("remote:B");
    });
    expect(h.calls.expandPanel).not.toHaveBeenCalled();

    // A genuinely-new split on B (B3) THEN arrives → adopted (baseline advanced to B).
    batch(() => {
      h.setParents({ B1: null, B2: T("B1"), B3: T("B1") });
      h.setRawIds([T("B1"), T("B2"), T("B3")]);
    });
    expect(h.calls.expandPanel).toHaveBeenCalledWith(T("B1"));
    expect(h.calls.setActiveSubTab).toHaveBeenCalledWith(T("B1"), T("B3"));
    h.dispose();
  });
});
