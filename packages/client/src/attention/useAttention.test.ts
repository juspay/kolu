/** A page that resumes from what it saved can raise marks on its first frame —
 *  and whether it may depends on a preference the server sends a moment after
 *  the page loads. Until that frame lands, `preferences()` answers the
 *  defaults (alerts on), so a user who switched **Attention alerts** off would
 *  be marked on every reload whose padi frame beat the preferences frame. It
 *  also pins that a question asked with the Conductor in front of you chimes
 *  without a desktop notification. */

import type { Preferences } from "kolu-common/surface";
import type { Membership } from "kolu-work";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const wire = vi.hoisted(() => ({
  arrived: (): boolean => false,
  alerts: (): boolean => true,
}));
const conductor = vi.hoisted(() => ({
  asks: (): { ownAsks: string[]; workAsks: string[] } | undefined => undefined,
  inMode: (): boolean => false,
  popups: [] as string[],
}));
/** The membership index, which a case swaps for a signal it moves. */
const works = vi.hoisted(() => ({
  membership: (): ReadonlyMap<string, Membership> => new Map(),
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
  useMembership: () => () => works.membership(),
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

import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import { hostMarks, registerHostFacts, writeHostMarks } from "./attentionMarks";
import { holdConductorScreen } from "./conductorScreens";
import { attentionRecordOf } from "./savedAttention";
import { useAttention } from "./useAttention";

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A host whose attention frame a case drives by hand: `finish` moves a
 *  terminal into the finished list, `work` puts it back to work. */
function drivenHost(encHost: string) {
  const [frame, setFrame] = createSignal<{
    asking: TerminalId[];
    working: TerminalId[];
    linger: TerminalId[];
    finished: TerminalId[];
  }>({ asking: [], working: [], linger: [], finished: [] });
  registerHostFacts(encHost, () => ({
    reported: true,
    live: true,
    liveIds: [],
    byClass: frame(),
  }));
  writeHostMarks(encHost, {});
  return {
    finish: (id: TerminalId) =>
      setFrame({ asking: [], working: [], linger: [], finished: [id] }),
    work: (id: TerminalId) =>
      setFrame({ asking: [], working: [id], linger: [], finished: [] }),
  };
}

/** Run the engine over the shown host `local`, with `focused` its focused
 *  pane, for the length of `body`.
 *
 *  The owner holds the engine and NOTHING else: `body` runs outside it, so
 *  the signals a case drives are written with no owner in scope, as the app
 *  writes them (a write inside an owned scope is a Solid 2 error). */
async function withAttention(
  focused: TerminalId | null,
  body: () => Promise<void>,
): Promise<void> {
  wire.arrived = () => true;
  wire.alerts = () => true;
  const dispose = createRoot((disposeRoot) => {
    useAttention({
      activeId: () => focused,
      focusedId: () => focused,
      activate: () => {},
      activeSubject: () => ({ title: "t", description: undefined }),
      terminalIds: () => [],
      activeAgentState: () => undefined,
    });
    return disposeRoot;
  });
  try {
    await body();
  } finally {
    dispose();
  }
}

beforeEach(() => {
  localStorage.clear();
  // The marks live in each host's record for the page's life: clear them
  // through the record, so no case inherits another's.
  for (const host of [
    "local",
    "remote:box-1",
    "remote:box-2",
    "remote:box-3",
    "remote:box-4",
    "remote:box-5",
    "remote:box-6",
  ])
    attentionRecordOf(host).clearAllUnread();
  conductor.asks = () => undefined;
  conductor.inMode = () => false;
  conductor.popups.length = 0;
  works.membership = () => new Map();
  vi.restoreAllMocks();
});

describe("which terminals are marked unread", () => {
  it("marks a terminal on a host you are not on, on that host's record", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const away = drivenHost("remote:box-1");
    await withAttention(null, async () => {
      await settle();
      away.finish(A);
      await settle();
      expect(attentionRecordOf("remote:box-1").isUnread(A)).toBe(true);
      expect(attentionRecordOf("local").isUnread(A)).toBe(false);
    });
  });

  it("on the canvas the focused pane is in front; behind the Conductor it is marked and chimes", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const chimes = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const here = drivenHost("local");
    await withAttention(A, async () => {
      await settle();
      // The canvas is on screen and A is the pane you are in: seen.
      here.finish(A);
      await settle();
      expect(attentionRecordOf("local").isUnread(A)).toBe(false);
      expect(chimes).not.toHaveBeenCalled();
      // The Conductor covers the canvas: the same pane is no longer in front.
      conductor.inMode = () => true;
      here.work(A);
      await settle();
      here.finish(A);
      await settle();
      expect(attentionRecordOf("local").isUnread(A)).toBe(true);
      expect(chimes).toHaveBeenCalledTimes(1);
    });
  });

  it("a screen of the terminal showing in the Conductor lifts its mark and keeps it off, until it stops showing", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    conductor.inMode = () => true;
    const away = drivenHost("remote:box-2");
    await withAttention(null, async () => {
      await settle();
      away.finish(A);
      await settle();
      expect(attentionRecordOf("remote:box-2").isUnread(A)).toBe(true);
      // Look, or the live pane, comes to show it: the mark lifts.
      const release = holdConductorScreen(`remote:box-2/${A}`);
      await settle();
      expect(attentionRecordOf("remote:box-2").isUnread(A)).toBe(false);
      // A ping while it shows: in front of you, no mark.
      away.work(A);
      await settle();
      away.finish(A);
      await settle();
      expect(attentionRecordOf("remote:box-2").isUnread(A)).toBe(false);
      // It stops showing: the next ping marks it.
      release();
      away.work(A);
      await settle();
      away.finish(A);
      await settle();
      expect(attentionRecordOf("remote:box-2").isUnread(A)).toBe(true);
    });
  });
});

describe("a terminal the Conductor drives", () => {
  /** The membership index naming `A` on `encHost` with `driver`. */
  const naming = (
    encHost: string,
    driver: Membership["driver"],
  ): ReadonlyMap<string, Membership> =>
    new Map([
      [
        fleetTerminalRef(encHost, A),
        { work: "w", title: "w", role: "planner", driver },
      ],
    ]);

  it("finishing on a host you are not on: not unread, not counted, no chime", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const chimes = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    works.membership = () => naming("remote:box-3", "conductor");
    const away = drivenHost("remote:box-3");
    await withAttention(null, async () => {
      await settle();
      away.finish(A);
      await settle();
      expect(attentionRecordOf("remote:box-3").isUnread(A)).toBe(false);
      expect(hostMarks("remote:box-3").unseenFinished()).toBe(0);
      expect(chimes).not.toHaveBeenCalled();
    });
  });

  it("taken over, it is marked, counted and chimes; handed back, the mark lifts and the count drops", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const chimes = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const [membership, setMembership] = createSignal(
      naming("remote:box-4", "you"),
    );
    works.membership = membership;
    const away = drivenHost("remote:box-4");
    await withAttention(null, async () => {
      await settle();
      away.finish(A);
      await settle();
      expect(attentionRecordOf("remote:box-4").isUnread(A)).toBe(true);
      expect(hostMarks("remote:box-4").unseenFinished()).toBe(1);
      expect(chimes).toHaveBeenCalledTimes(1);
      setMembership(naming("remote:box-4", "conductor"));
      await settle();
      expect(attentionRecordOf("remote:box-4").isUnread(A)).toBe(false);
      expect(hostMarks("remote:box-4").unseenFinished()).toBe(0);
    });
  });

  it("marked before the works record names it, the mark lifts once it says the Conductor drives it", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const [membership, setMembership] = createSignal<
      ReadonlyMap<string, Membership>
    >(new Map());
    works.membership = membership;
    const away = drivenHost("remote:box-5");
    await withAttention(null, async () => {
      await settle();
      away.finish(A);
      await settle();
      expect(attentionRecordOf("remote:box-5").isUnread(A)).toBe(true);
      expect(hostMarks("remote:box-5").unseenFinished()).toBe(1);
      setMembership(naming("remote:box-5", "conductor"));
      await settle();
      expect(attentionRecordOf("remote:box-5").isUnread(A)).toBe(false);
      expect(hostMarks("remote:box-5").unseenFinished()).toBe(0);
    });
  });

  it("a driven member this browser cannot resolve does not stop the lift for the others", async () => {
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    // A member whose host key is not canonical: a ref no record can be read by.
    const unresolvable: [string, Membership] = [
      "gone-host/22222222-2222-4222-8222-222222222222",
      { work: "w", title: "w", role: "planner", driver: "conductor" },
    ];
    const [membership, setMembership] = createSignal<
      ReadonlyMap<string, Membership>
    >(new Map());
    works.membership = membership;
    const away = drivenHost("remote:box-6");
    await withAttention(null, async () => {
      await settle();
      away.finish(A);
      await settle();
      expect(attentionRecordOf("remote:box-6").isUnread(A)).toBe(true);
      expect(() => setMembership(new Map([unresolvable]))).not.toThrow();
      await settle();
      expect(() =>
        setMembership(
          new Map([unresolvable, ...naming("remote:box-6", "conductor")]),
        ),
      ).not.toThrow();
      await settle();
      expect(attentionRecordOf("remote:box-6").isUnread(A)).toBe(false);
      expect(hostMarks("remote:box-6").unseenFinished()).toBe(0);
    });
  });
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
  // The host's facts and its membership are published OUTSIDE the owner: a
  // store write inside an owned scope is a Solid 2 error.
  registerHostFacts("local", () => ({
    reported: true,
    live: true,
    liveIds: [],
    byClass: { asking: [], working: [], linger: [], finished: [A] },
  }));
  writeHostMarks("local", {});
  const dispose = createRoot((disposeRoot) => {
    useAttention({
      activeId: () => null,
      focusedId: () => null,
      activate: () => {},
      activeSubject: () => ({ title: "t", description: undefined }),
      terminalIds: () => [A],
      activeAgentState: () => undefined,
    });
    return disposeRoot;
  });
  try {
    await settle();
    // Defaults say alerts are on; that is not the user's answer yet.
    expect(attentionRecordOf("local").isUnread(A)).toBe(false);
    // The user's answer: off.
    setAlerts(false);
    setArrived(true);
    await settle();
    expect(attentionRecordOf("local").isUnread(A)).toBe(false);
  } finally {
    dispose();
  }
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
  const dispose = createRoot((disposeRoot) => {
    useAttention({
      activeId: () => null,
      focusedId: () => null,
      activate: () => {},
      activeSubject: () => ({ title: "t", description: undefined }),
      terminalIds: () => [],
      activeAgentState: () => undefined,
    });
    return disposeRoot;
  });
  try {
    // The server's first word: nothing is being asked. The baseline.
    setAsks({ ownAsks: [], workAsks: [] });
    await settle();
    // The window is away: the first question chimes and raises a popup.
    setAsks({ ownAsks: ["c1"], workAsks: [] });
    await settle();
    expect(chimes).toHaveBeenCalledTimes(1);
    expect(conductor.popups).toEqual(["conductor"]);
    // Back in front of it. The question is answered, and a second is asked.
    focused.mockReturnValue(true);
    setAsks({ ownAsks: [], workAsks: [] });
    await settle();
    setAsks({ ownAsks: ["c2"], workAsks: [] });
    await settle();
    // One more chime for it, and no second popup.
    expect(chimes).toHaveBeenCalledTimes(2);
    expect(conductor.popups).toEqual(["conductor"]);
  } finally {
    dispose();
  }
});
