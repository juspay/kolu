/** The attention engine's two CROSS-HOST navigations — the violet capsule's
 *  jump, and the OS-notification click router — switch the active host and then
 *  land on a terminal, in one handler.
 *
 *  A Solid 2 write is staged until the flush, so without landing the switch the
 *  landing verb (and the jump's cycle anchor, `deps.activeId()`) still resolve
 *  the host being LEFT: the foreign id is written into the departing host's
 *  focus and visit trail, and the target host is never focused. These cases run
 *  the real per-host owner (`hostScopes` over the mock host map) and drive each
 *  handler in ONE synchronous run, with no settle between. */

import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import type { Preferences, TerminalId } from "kolu-common/surface";
import type { Membership } from "kolu-work";
import { createRoot, createSignal, flush } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const bag = vi.hoisted(() => ({
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
  setActiveHost: (() => {}) as (
    next: HostKey | ((p: HostKey) => HostKey),
  ) => void,
}));

/** The notification-click handler the engine registers — a case fires it the
 *  way the browser does. */
const notified = vi.hoisted(() => ({
  onClick: undefined as ((data: unknown) => void) | undefined,
}));

// `./wire` must serve BOTH the engine's reads (active host, preferences) and
// the per-host owner's (`padiMap` + the grounded active host) — one mock, the
// mock host map underneath. The dynamic import is `vi.mock`'s hoisting
// contract: the factory runs before the file's own imports.
vi.mock("../wire", async () => {
  const { mockPadiMap, mockGroundedActiveHost } = await import(
    "../hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    activeHost: () => bag.activeHost(),
    setActiveHost: (next: HostKey | ((p: HostKey) => HostKey)) =>
      bag.setActiveHost(next),
    padiRpcOf: () => ({ chrome: { setActive: () => Effect.void } }),
    activePadiRpc: { chrome: { setSubPanel: () => Effect.void } },
    interpretClientError: () => {},
    preferencesArrived: () => true,
    preferences: () => ({ attentionAlerts: true }) as Preferences,
    groundedActiveHost: mockGroundedActiveHost(() => bag.activeHost()),
  };
});

// The Conductor's side says nothing: these cases are about the two terminal
// routes. (Same stubs as `useAttention.test.ts`'s harness.)
vi.mock("./useAttentionFacts", () => ({ useAttentionFacts: () => ({}) }));
vi.mock("../conductor/useConductorFacts", () => ({
  conductorAsks: () => undefined,
  useConductorFacts: () => () => undefined,
  useConductorBadge: () => ({ waiting: () => 0 }),
}));
vi.mock("../conductor/useWorks", () => ({
  useMembership: () => () => new Map<string, Membership>(),
  useNeedsYou: () => () => [],
  useWorkMap: () => () => new Map(),
  useWorkKeys: () => () => [],
  useWorkAt: () => undefined,
}));
vi.mock("../conductor/useConductorMode", () => ({
  conductorMode: () => false,
  enterConductorMode: () => {},
  exitConductorMode: () => {},
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
    onClick: (fn: (data: unknown) => void) => {
      notified.onClick = fn;
      return () => {
        notified.onClick = undefined;
      };
    },
  },
}));

import { activeScope, hostScopeOf } from "../hostScope/hostScopes";
import { addHost, resetHosts } from "../hostScope/mockHostMap.testlib";
import { registerHostFacts, writeHostMarks } from "./attentionMarks";
import { jumpToAsking } from "./attentionNav";
import { useAttention } from "./useAttention";
import { useVisitRecency } from "../terminal/visitRecency";

const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };
const B1 = "11111111-1111-4111-8111-111111111111" as TerminalId;
const B2 = "22222222-2222-4222-8222-222222222222" as TerminalId;

const [driveHost, setDriveHost] = createSignal<HostKey>(HOST_A);
bag.activeHost = driveHost;
bag.setActiveHost = (next) => {
  setDriveHost(next as HostKey);
};

/** The landing verb the app hands the engine (`store.activate`): it resolves
 *  the ACTIVE host's owned view and writes the focus there. */
const activate = (id: TerminalId): void => {
  activeScope()?.view.writeFocus({ id, tileHint: id });
};

/** Make `host` active and land the switch — the arrange half, outside the
 *  handler under test. */
function goTo(host: HostKey): void {
  setDriveHost(host);
  flush();
}

beforeEach(() => {
  resetHosts();
  setDriveHost(HOST_A);
  localStorage.clear();
  notified.onClick = undefined;
});

/** Both hosts in the pool, B already visited (its owner retained, with B1 its
 *  selected tile) and asking on two terminals, with A the host on screen. */
function fleetAskingOnB(): void {
  addHost(HOST_A);
  addHost(HOST_B);
  registerHostFacts("remote:B", () => ({
    reported: true,
    live: true,
    liveIds: [B1, B2],
    byClass: { asking: [B1, B2], working: [], linger: [], finished: [] },
  }));
  writeHostMarks("remote:B", {});
  goTo(HOST_B);
  activate(B1);
  goTo(HOST_A);
}

/** Run the engine for the length of `body`, with the host-scoped landing verbs
 *  the app gives it. `body` runs OUTSIDE the owner, as a real click does. */
function withAttention(body: () => void): void {
  const dispose = createRoot((disposeRoot) => {
    useAttention({
      activeId: () => activeScope()?.view.activeId() ?? null,
      focusedId: () => activeScope()?.view.focusedTerminalId() ?? null,
      activate,
      activeSubject: () => ({ title: "t", description: undefined }),
      terminalIds: () => [],
      activeAgentState: () => undefined,
    });
    return disposeRoot;
  });
  try {
    body();
  } finally {
    dispose();
  }
}

describe("the attention engine's cross-host landings", () => {
  it("the capsule's jump cycles on the TARGET host's selection and focuses there", () => {
    fleetAskingOnB();
    withAttention(() => {
      // One click on B's violet capsule while viewing A.
      jumpToAsking("remote:B");
      flush();

      // B's own selected tile (B1) is the cycle anchor, so the jump walks on to
      // B2 — anchored on A's selection it would land back on B1.
      expect(hostScopeOf(HOST_B)?.view.focusedTerminalId()).toBe(B2);
      expect(hostScopeOf(HOST_A)?.view.focusedTerminalId()).toBeNull();
      expect(useVisitRecency().mruForHost(HOST_A)).toEqual([]);
    });
  });

  it("a notification click for another host's terminal focuses it on that host", () => {
    fleetAskingOnB();
    withAttention(() => {
      const click = notified.onClick;
      if (!click) throw new Error("the engine registered no click handler");
      click({ kind: "terminal", host: "remote:B", terminalId: B2 });
      flush();

      expect(hostScopeOf(HOST_B)?.view.focusedTerminalId()).toBe(B2);
      expect(hostScopeOf(HOST_A)?.view.focusedTerminalId()).toBeNull();
      expect(useVisitRecency().mruForHost(HOST_A)).toEqual([]);
    });
  });

  it("a stale `host`-shaped notification routes the same way", () => {
    fleetAskingOnB();
    withAttention(() => {
      const click = notified.onClick;
      if (!click) throw new Error("the engine registered no click handler");
      click({ kind: "host", host: "remote:B", id: B2 });
      flush();

      expect(hostScopeOf(HOST_B)?.view.focusedTerminalId()).toBe(B2);
      expect(hostScopeOf(HOST_A)?.view.focusedTerminalId()).toBeNull();
    });
  });
});
