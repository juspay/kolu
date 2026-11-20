import type { Preferences } from "kolu-common/surface";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({
  arrived: (): boolean => false,
  alerts: (): boolean => true,
}));
vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" }),
  setActiveHost: () => {},
  preferencesArrived: () => wire.arrived(),
  preferences: () => ({ attentionAlerts: wire.alerts() }) as Preferences,
}));
vi.mock("./useAttentionFacts", () => ({ useAttentionFacts: () => ({}) }));
vi.mock("../conductor/useConductorFacts", () => ({
  conductorAsks: () => undefined,
  useConductorFacts: () => () => undefined,
  useConductorBadge: () => ({ waiting: () => 0 }),
}));
vi.mock("../conductor/useWorks", () => ({
  useMembership: () => () => new Map(),
  useNeedsYou: () => () => [],
  useWorkMap: () => () => new Map(),
}));
vi.mock("../conductor/onScreen", () => ({
  afterViewKnown: (decide: () => void) => decide,
  isNeedInView: () => false,
}));
vi.mock("../conductor/useConductorMode", () => ({
  conductorMode: () => false,
  enterConductorMode: () => {},
}));
vi.mock("../conductor/workListing", () => ({ showWork: () => {} }));
vi.mock("../attentionNotify", () => ({
  notify: {
    requestPermission: async () => {},
    show: async () => {},
    onClick: () => () => {},
  },
}));

import { registerHostAttention } from "./attentionMarks";
import { attentionRecordOf } from "./savedAttention";
import { useAttention } from "./useAttention";

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => localStorage.clear());

it("a resumed first frame raises no mark before the preferences have arrived, nor after they say alerts are off", async () => {
  attentionRecordOf("local").remember({
    frame: { asking: [], finished: [] },
    latched: [],
    unseenFinished: [],
  });
  const [arrived, setArrived] = createSignal(false);
  const [alerts, setAlerts] = createSignal(true);
  wire.arrived = arrived;
  wire.alerts = alerts;
  await createRoot(async (dispose) => {
    try {
      registerHostAttention("local", {
        facts: () => ({
          reported: true,
          live: true,
          liveIds: [],
          byClass: { asking: [], working: [], linger: [], finished: [A] },
        }),
      });
      useAttention({
        activeId: () => null,
        focusedId: () => null,
        activate: () => {},
        activeSubject: () => ({ title: "t", description: undefined }),
        terminalIds: () => [A],
        activeAgentState: () => undefined,
      });
      await flush();
      expect(attentionRecordOf("local").isUnread(A)).toBe(false);
      setAlerts(false);
      setArrived(true);
      await flush();
      expect(attentionRecordOf("local").isUnread(A)).toBe(false);
    } finally {
      dispose();
    }
  });
});
