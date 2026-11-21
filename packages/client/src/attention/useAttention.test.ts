/** A page that resumes from what it saved can raise marks on its first frame —
 *  and whether it may depends on a preference the server sends a moment after
 *  the page loads. Until that frame lands, `preferences()` answers the
 *  defaults (alerts on), so a user who switched **Attention alerts** off would
 *  be marked on every reload whose padi frame beat the preferences frame. It
 *  also pins that a question asked with the Conductor in front of you chimes
 *  without a desktop notification. */

import type { Preferences } from "kolu-common/surface";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({
  arrived: (): boolean => false,
  alerts: (): boolean => true,
}));
const conductor = vi.hoisted(() => ({
  asks: (): { ownAsks: string[]; workAsks: string[] } | undefined => undefined,
  inMode: (): boolean => false,
  popups: [] as string[],
}));
vi.mock("../wire", () => ({
  activeHost: () => ({ kind: "local" }),
  setActiveHost: () => {},
  preferencesArrived: () => wire.arrived(),
  preferences: () => ({ attentionAlerts: wire.alerts() }) as Preferences,
}));
// The per-host mirror is driven by hand below; the Conductor's side says
// nothing unless a test hands it a reading.
vi.mock("./useAttentionFacts", () => ({ useAttentionFacts: () => ({}) }));
vi.mock("../conductor/useConductorFacts", () => ({
  conductorAsks: () => conductor.asks(),
  useConductorFacts: () => () => undefined,
  useConductorBadge: () => ({ waiting: () => 0 }),
}));
vi.mock("../conductor/useWorks", () => ({
  useMembership: () => () => new Map(),
  useNeedsYou: () => () => [],
  useWorkMap: () => () => new Map(),
}));
vi.mock("../conductor/useConductorMode", () => ({
  conductorMode: () => conductor.inMode(),
  enterConductorMode: () => {},
}));
vi.mock("../conductor/workListing", () => ({ showWork: () => {} }));
vi.mock("../conductor/memory/useMemory", () => ({
  memorySheet: { openDialog: () => {} },
  useMemoryNeed: () => () => undefined,
}));
vi.mock("../attentionNotify", () => ({
  notify: {
    requestPermission: async () => {},
    show: async (shown: { tag: string }) => {
      conductor.popups.push(shown.tag);
    },
    onClick: () => () => {},
  },
}));

import { registerHostFacts, writeHostMarks } from "./attentionMarks";
import { attentionRecordOf } from "./savedAttention";
import { useAttention } from "./useAttention";

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
  conductor.asks = () => undefined;
  conductor.inMode = () => false;
  conductor.popups.length = 0;
  vi.restoreAllMocks();
});

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

it("a question asked while the Conductor is in front of you chimes and raises no desktop notification; with the window away it raises one", async () => {
  const [asks, setAsks] = createSignal<
    { ownAsks: string[]; workAsks: string[] } | undefined
  >(undefined);
  wire.arrived = () => true;
  wire.alerts = () => true;
  conductor.asks = asks;
  // The Conductor's tab is the one showing, for the whole test.
  conductor.inMode = () => true;
  const focused = vi.spyOn(document, "hasFocus").mockReturnValue(false);
  const chimes = vi
    .spyOn(HTMLMediaElement.prototype, "play")
    .mockResolvedValue(undefined);
  await createRoot(async (dispose) => {
    try {
      useAttention({
        activeId: () => null,
        focusedId: () => null,
        activate: () => {},
        activeSubject: () => ({ title: "t", description: undefined }),
        terminalIds: () => [],
        activeAgentState: () => undefined,
      });
      // The server's first word: nothing is being asked. The baseline.
      setAsks({ ownAsks: [], workAsks: [] });
      await flush();
      // The window is away: the first question chimes and raises a popup.
      setAsks({ ownAsks: ["c1"], workAsks: [] });
      await flush();
      expect(chimes).toHaveBeenCalledTimes(1);
      expect(conductor.popups).toEqual(["conductor"]);
      // Back in front of it. The question is answered, and a second is asked.
      focused.mockReturnValue(true);
      setAsks({ ownAsks: [], workAsks: [] });
      await flush();
      setAsks({ ownAsks: ["c2"], workAsks: [] });
      await flush();
      // One more chime for it, and no second popup.
      expect(chimes).toHaveBeenCalledTimes(2);
      expect(conductor.popups).toEqual(["conductor"]);
    } finally {
      dispose();
    }
  });
});
