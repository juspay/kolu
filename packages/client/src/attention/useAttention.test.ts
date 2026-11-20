/** A page that resumes from what it saved can raise marks on its first frame —
 *  and whether it may depends on a preference the server sends a moment after
 *  the page loads. Until that frame lands, `preferences()` answers the
 *  defaults (alerts on), so a user who switched **Attention alerts** off would
 *  be marked on every reload whose padi frame beat the preferences frame. */

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
// The per-host mirror is driven by hand below; the Conductor's side of the
// bell has nothing to say here.
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

import { registerHostFacts, writeHostMarks } from "./attentionMarks";
import { attentionRecordOf } from "./savedAttention";
import { useAttention } from "./useAttention";

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => localStorage.clear());

it("a resumed first frame raises no mark before the preferences have arrived, nor after they say alerts are off", async () => {
  // The last page saw nothing finished; while kolu was down A finished.
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
      registerHostFacts("local", () => ({
        reported: true,
        live: true,
        liveIds: [],
        byClass: { asking: [], working: [], linger: [], finished: [A] },
      }));
      writeHostMarks("local", {});
      useAttention({
        activeId: () => null,
        focusedId: () => null,
        activate: () => {},
        activeSubject: () => ({ title: "t", description: undefined }),
        terminalIds: () => [A],
        activeAgentState: () => undefined,
      });
      await flush();
      // Defaults say alerts are on; that is not the user's answer yet.
      expect(attentionRecordOf("local").isUnread(A)).toBe(false);
      // The user's answer: off.
      setAlerts(false);
      setArrived(true);
      await flush();
      expect(attentionRecordOf("local").isUnread(A)).toBe(false);
    } finally {
      dispose();
    }
  });
});
