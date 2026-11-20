import type { TerminalId } from "kolu-common/surface";
import { batch, createEffect, createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import type { HydrationPhase } from "../hostScope/createSessionRestore";
import { type SplitAdoptPorts, useAdoptNewSplit } from "./useAdoptNewSplit";

const T = (s: string) => s as TerminalId;

const tick = () => new Promise((r) => setTimeout(r, 0));

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
    seedSplitTab: vi.fn<(subId: TerminalId, parentId: TerminalId) => void>(),
  };
  let handles!: {
    setRawIds: (v: TerminalId[]) => void;
    setParents: (v: Record<string, TerminalId | null>) => void;
    setPhase: (v: HydrationPhase) => void;
    setHost: (v: string) => void;
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
      seedSplitTab: calls.seedSplitTab,
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
    const h = setupAdopt({ rawIds: [T("P")], parents: { P: null } });
    await tick();
    expect(h.calls.expandPanel).not.toHaveBeenCalled();

    batch(() => {
      h.setParents({ P: null, S: T("P") });
      h.setRawIds([T("P"), T("S")]);
    });

    expect(h.calls.expandPanel).toHaveBeenCalledWith(T("P"));
    expect(h.calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), T("S"));
    expect(h.calls.seedSplitTab).toHaveBeenCalledWith(T("S"), T("P"));
    h.dispose();
  });

  it("(b) don't steal — a new split expands but does NOT select when one is already active", async () => {
    const h = setupAdopt({
      rawIds: [T("P"), T("S1")],
      parents: { P: null, S1: T("P") },
      activeSubTab: { P: T("S1") },
    });
    await tick();

    batch(() => {
      h.setParents({ P: null, S1: T("P"), S2: T("P") });
      h.setRawIds([T("P"), T("S1"), T("S2")]);
    });

    expect(h.calls.expandPanel).toHaveBeenCalledWith(T("P"));
    expect(h.calls.setActiveSubTab).not.toHaveBeenCalled();
    h.dispose();
  });

  it("(c) does NOT adopt during load/restore (phase not seeded), then DOES adopt a later live arrival", async () => {
    const h = setupAdopt({
      rawIds: [T("P")],
      parents: { P: null },
      phase: "decided",
    });
    await tick();

    batch(() => {
      h.setParents({ P: null, S1: T("P") });
      h.setRawIds([T("P"), T("S1")]);
    });
    expect(h.calls.expandPanel).not.toHaveBeenCalled();
    expect(h.calls.setActiveSubTab).not.toHaveBeenCalled();

    h.setPhase("seeded");
    await tick();
    expect(h.calls.expandPanel).not.toHaveBeenCalled();

    batch(() => {
      h.setParents({ P: null, S1: T("P"), S2: T("P") });
      h.setRawIds([T("P"), T("S1"), T("S2")]);
    });
    expect(h.calls.expandPanel).toHaveBeenCalledWith(T("P"));
    expect(h.calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), T("S2"));
    expect(h.calls.setActiveSubTab).toHaveBeenCalledTimes(1);
    h.dispose();
  });

  it("(g) seeds the tab from the arrival's TRUE parent — a nested external split", async () => {
    const h = setupAdopt({
      rawIds: [T("P"), T("S")],
      parents: { P: null, S: T("P") },
    });
    await tick();

    batch(() => {
      h.setParents({ P: null, S: T("P"), G: T("S") });
      h.setRawIds([T("P"), T("S"), T("G")]);
    });

    expect(h.calls.seedSplitTab).toHaveBeenCalledExactlyOnceWith(
      T("G"),
      T("S"),
    );
    expect(h.calls.expandPanel).toHaveBeenCalledExactlyOnceWith(T("P"));
    h.dispose();
  });

  it("(d) a top-level arrival is ignored — only splits (parentId) are adopted", async () => {
    const h = setupAdopt({ rawIds: [T("P")], parents: { P: null } });
    await tick();

    batch(() => {
      h.setParents({ P: null, Q: null });
      h.setRawIds([T("P"), T("Q")]);
    });

    expect(h.calls.expandPanel).not.toHaveBeenCalled();
    expect(h.calls.setActiveSubTab).not.toHaveBeenCalled();
    expect(h.calls.seedSplitTab).not.toHaveBeenCalled();
    h.dispose();
  });

  it("(e) subs present at mount are baseline — never adopted", async () => {
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
    const h = setupAdopt({
      rawIds: [T("P"), T("S")],
      parents: { P: null, S: T("P") },
      host: "local",
    });
    await tick();

    batch(() => {
      h.setParents({ B1: null, B2: T("B1") });
      h.setRawIds([T("B1"), T("B2")]);
      h.setHost("remote:B");
    });
    expect(h.calls.expandPanel).not.toHaveBeenCalled();

    batch(() => {
      h.setParents({ B1: null, B2: T("B1"), B3: T("B1") });
      h.setRawIds([T("B1"), T("B2"), T("B3")]);
    });
    expect(h.calls.expandPanel).toHaveBeenCalledWith(T("B1"));
    expect(h.calls.setActiveSubTab).toHaveBeenCalledWith(T("B1"), T("B3"));
    h.dispose();
  });
});

describe("useAdoptNewSplit — composed with hydration", () => {
  it("baselines a restored split on the seed-boundary flush, then adopts a later live split", async () => {
    const latch = { phase: "decided" as HydrationPhase };
    const calls = {
      expandPanel: vi.fn<(parentId: TerminalId) => void>(),
      setActiveSubTab:
        vi.fn<(parentId: TerminalId, subId: TerminalId) => void>(),
      seedSplitTab: vi.fn<(subId: TerminalId, parentId: TerminalId) => void>(),
    };
    let handles!: {
      deliverSeedBoundary: () => void;
      deliverLiveSplit: () => void;
      dispose: () => void;
    };
    createRoot((dispose) => {
      const [rawIds, setRawIds] = createSignal<TerminalId[]>([T("P")]);
      const [parents, setParents] = createSignal<
        Record<string, TerminalId | null>
      >({ P: null });
      useAdoptNewSplit({
        rawList: rawIds,
        parentOf: (id) => parents()[id] ?? null,
        activeHostKey: () => "local",
        restorePhase: () => latch.phase,
        ports: {
          expandPanel: calls.expandPanel,
          activeSubTab: () => null,
          setActiveSubTab: calls.setActiveSubTab,
          seedSplitTab: calls.seedSplitTab,
        },
      });
      createEffect(() => {
        if (parents().S === T("P") && latch.phase === "decided") {
          latch.phase = "seeded";
        }
      });
      handles = {
        deliverSeedBoundary: () =>
          batch(() => {
            setParents({ P: null, S: T("P") });
            setRawIds([T("P"), T("S")]);
          }),
        deliverLiveSplit: () =>
          batch(() => {
            setParents({ P: null, S: T("P"), S2: T("P") });
            setRawIds([T("P"), T("S"), T("S2")]);
          }),
        dispose,
      };
    });
    await tick();

    handles.deliverSeedBoundary();
    expect(calls.expandPanel).not.toHaveBeenCalled();
    expect(calls.setActiveSubTab).not.toHaveBeenCalled();
    expect(calls.seedSplitTab).not.toHaveBeenCalled();

    handles.deliverLiveSplit();
    expect(calls.expandPanel).toHaveBeenCalledWith(T("P"));
    expect(calls.setActiveSubTab).toHaveBeenCalledWith(T("P"), T("S2"));
    handles.dispose();
  });
});
