/** THREE HOST SWITCHES, THROUGH THE REAL ENGINE AND THE REAL HOST CHIP BINDING.
 *
 *  `useAttention`'s "you looked" effect clears a host's unseen-finished dot from
 *  an apply arm keyed on `encodeHostKey(activeHost())`. The host chip's tab
 *  binding (`host/HostSelectorStrip.tsx:262-266`) folds BOTH legs of that one
 *  switch in a single computation: `marks.asking()` and `marks.unseenFinished()`
 *  — which that arm writes through `attentionMarks` — together with `isActive()`,
 *  read off the same `activeHost` root the arm is keyed on. A reader of both is
 *  exactly what an unsettled effect-origin write tears: the binding answers once
 *  for the switch itself (new active host, STALE dot) and again when the mark
 *  lands.
 *
 *  So the victim here is that binding, narrowed to its two attributes and driven
 *  by the real engine: each round switches TO a host that has an unseen finish
 *  waiting, which is the only case `markHostSeen` writes in at all
 *  (`attentionCore.ts:242-248` writes only when the set is non-empty).
 *
 *  Three switches, because an advisory tear escalates to a warning on the third —
 *  and the assertion is an EMPTY diagnostics list, `info` included, so the first
 *  sighting is already the failure. The shown state is asserted after every
 *  switch: the visited host's chip carries no dot and its tally is zero, while
 *  the host still holding a finish keeps its dot. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { encodeHostKey, type HostKey } from "kolu-common/hostKey";
import type { Preferences, TerminalId } from "kolu-common/surface";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
} from "solid-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const bag = vi.hoisted(() => ({
  active: (): HostKey => ({ kind: "local" }),
  setActive: (_h: HostKey) => {},
}));

vi.mock("../wire", async () => {
  const { createSignal } = await import("solid-js");
  const [active, setActive] = createSignal<HostKey>({ kind: "local" });
  bag.active = active;
  bag.setActive = (h: HostKey) => {
    setActive(h);
  };
  return {
    // THE ROOT both legs of the chip binding share: a switch is driven the way
    // every surface drives it — by writing the active host.
    activeHost: () => active(),
    setActiveHost: () => {},
    preferencesArrived: () => true,
    preferences: () => ({ attentionAlerts: true }) as Preferences,
  };
});
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
  useWorkKeys: () => () => [],
  useWorkAt: () => undefined,
}));
vi.mock("../conductor/useConductorMode", () => ({
  conductorMode: () => false,
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
    show: async () => {},
    onClick: () => () => {},
  },
}));

import { hostMarks, registerHostFacts, writeHostMarks } from "./attentionMarks";
import { attentionRecordOf } from "./savedAttention";
import { useAttention } from "./useAttention";

const A = "11111111-1111-4111-8111-111111111111" as TerminalId;

const HOSTS = ["remote:box-1", "remote:box-2", "remote:box-3"] as const;
const keyOf = (enc: string): HostKey => ({
  kind: "remote",
  target: enc.slice("remote:".length),
});

const diagnostics = (): string[] =>
  takeSolidDiagnostics().map(
    (event) => `[${event.severity}] ${event.code} ${event.message}`,
  );

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A host whose attention frame this case drives by hand. */
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

/** THE VICTIM: the host chip's tab binding, its two data attributes folded from
 *  the marks store and `isActive()` in ONE computation, exactly as
 *  `HostSelectorStrip.tsx:262-266` writes them. */
function chipTab(encHost: string) {
  return createMemo(
    () => {
      const marks = hostMarks(encHost);
      const isActive = encodeHostKey(bag.active()) === encHost;
      return {
        asking: marks.asking() > 0 && !isActive ? "" : undefined,
        unseen:
          marks.unseenFinished() > 0 && marks.asking() === 0 && !isActive
            ? ""
            : undefined,
      };
    },
    { name: `HostSelectorStrip.tab.${encHost}` },
  );
}

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
});
beforeEach(() => {
  localStorage.clear();
  for (const enc of HOSTS) attentionRecordOf(enc).clearAllUnread();
  vi.restoreAllMocks();
});

it("clears a visited host's dot over three switches with no chip binding left torn", async () => {
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

  const driven = HOSTS.map((enc) => drivenHost(enc));
  const tabs = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    useAttention({
      activeId: () => null,
      focusedId: () => null,
      activate: () => {},
      activeSubject: () => ({ title: "t", description: undefined }),
      terminalIds: () => [],
      activeAgentState: () => undefined,
    });
    const built = HOSTS.map((enc) => chipTab(enc));
    // STANDING, as a mounted strip holds them: a binding nobody reads never
    // re-runs, and a reader that never re-runs cannot be torn.
    for (const tab of built) createEffect(tab, () => {});
    return built;
  });
  await settle();

  // Every host finishes a turn while you are on none of them: three dots.
  for (const host of driven) host.finish(A);
  await settle();
  for (const [i, enc] of HOSTS.entries()) {
    expect(hostMarks(enc).unseenFinished()).toBe(1);
    expect(tabs[i]?.().unseen).toBe("");
  }
  // The boot host's own pass is not this case's subject.
  takeSolidDiagnostics();

  for (const [round, enc] of HOSTS.entries()) {
    bag.setActive(keyOf(enc));
    flush();
    await settle();

    // SHOWN STATE: the host you switched to is seen — no dot, tally zero — and
    // every host you have not visited yet still wears its own.
    expect(hostMarks(enc).unseenFinished()).toBe(0);
    expect(tabs[round]?.().unseen).toBe(undefined);
    expect(tabs[round]?.().asking).toBe(undefined);
    for (const [i, other] of HOSTS.entries()) {
      if (i <= round) continue;
      expect(hostMarks(other).unseenFinished()).toBe(1);
      expect(tabs[i]?.().unseen).toBe("");
    }
    // RED AT THE FIRST SIGHTING: an advisory relay tear is a finding here.
    expect(diagnostics()).toEqual([]);
  }
});
