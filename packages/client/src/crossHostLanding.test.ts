/** CROSS-HOST LANDING — a host switch and a landing that resolves the ACTIVE
 *  host's scope, in ONE handler.
 *
 *  On Solid 1 the `activeHost → activated → index → activeScope` chain
 *  recomputed before the switch setter returned, so the landing verb beside it
 *  (`store.activate`, `useDockFocus`) already addressed the host it was landing
 *  on. Solid 2 STAGES a write until the next flush: outside one, every reader —
 *  memos included — is served the committed value, so a landing in the same
 *  handler still resolves the DEPARTING host. The foreign id is then written
 *  into the host you just left (its focus, its visit trail, its `chrome.setActive`
 *  report), and a metadata-gated landing cannot find the id at all and toasts
 *  "Terminal no longer exists".
 *
 *  These cases drive switch-and-land in ONE synchronous run, with no `settle()`
 *  between, over the REAL per-host owner (`hostScopes` on the mock host map) —
 *  so the chain under test is the production one, not a stand-in. */

import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal, flush } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The `./wire` mock stands up the mock `padiMap` the real per-host owner reads,
// plus the per-tab `activeHost` signal (and its setter, which `selectHostTab`
// drives) that keys it.
const bag = vi.hoisted(() => ({
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
  setActiveHost: (() => {}) as (
    next: HostKey | ((p: HostKey) => HostKey),
  ) => void,
}));

/** The dock landing's store, driven by the cases below: its metadata answer is
 *  resolved through the REAL `activeScope()` memo, exactly as the production
 *  store's metadata window is. */
const store = vi.hoisted(() => ({
  getMetadata: (() => undefined) as (id: TerminalId) => unknown,
  focusTerminal: (() => {}) as (id: TerminalId) => void,
}));

/** Warnings the dock landing raises — the false "Terminal no longer exists". */
const toasted = vi.hoisted(() => ({ warnings: [] as string[] }));

vi.mock("./wire", async () => {
  const { mockPadiMap, mockGroundedActiveHost } = await import(
    "./hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    activeHost: () => bag.activeHost(),
    setActiveHost: (next: HostKey | ((p: HostKey) => HostKey)) =>
      bag.setActiveHost(next),
    padiRpcOf: () => ({ chrome: { setActive: () => Effect.void } }),
    activePadiRpc: { chrome: { setSubPanel: () => Effect.void } },
    interpretClientError: () => {},
    groundedActiveHost: mockGroundedActiveHost(() => bag.activeHost()),
  };
});

vi.mock("./terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: (id: TerminalId) => store.getMetadata(id),
    focusTerminal: (id: TerminalId) => store.focusTerminal(id),
  }),
}));

vi.mock("solid-sonner", () => ({
  toast: {
    warning: (message: string) => {
      toasted.warnings.push(message);
    },
  },
}));

import { useOpenTile } from "./conductor/useOpenTile";
import { activeScope, hostScopeOf } from "./hostScope/hostScopes";
import { addHost, resetHosts } from "./hostScope/mockHostMap.testlib";
import { selectFleetTerminal } from "./palette/fleetActions";
import { useVisitRecency } from "./terminal/visitRecency";

const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };
const TID_A = "11111111-1111-4111-8111-111111111111" as TerminalId;
const TID_B = "22222222-2222-4222-8222-222222222222" as TerminalId;

// Module-level STABLE active-host signal (the app-lifetime owner tracks it ONCE).
const [driveHost, setDriveHost] = createSignal<HostKey>(HOST_A);
bag.activeHost = driveHost;
bag.setActiveHost = (next) => {
  setDriveHost(next as HostKey);
};

/** The landing verb, standing for `store.activate`: it resolves the ACTIVE
 *  host's owned view and writes the focus there — the same one reactive read
 *  (`activeScope()`) the real store's `view()` makes. */
const activate = (id: TerminalId): void => {
  activeScope()?.view.writeFocus({ id, tileHint: id });
};

/** Which host the active scope currently resolves to — identity-compared
 *  against the owners `hostScopeOf` holds (it creates none). */
function activeEncoded(): string | undefined {
  const scope = activeScope();
  if (scope === undefined) return undefined;
  if (scope === hostScopeOf(HOST_A)) return "local";
  if (scope === hostScopeOf(HOST_B)) return "remote:B";
  return undefined;
}

/** Each host owns its own terminal — a landing on the wrong host cannot find
 *  the id it was handed, which is what the dock's metadata gate asks. */
const TERMINALS: Record<string, readonly TerminalId[]> = {
  local: [TID_A],
  "remote:B": [TID_B],
};

beforeEach(() => {
  // Empty membership FIRST — disposes the prior case's per-host owners — then
  // reset the active host and the persisted visit trail.
  resetHosts();
  setDriveHost(HOST_A);
  localStorage.clear();
  toasted.warnings = [];
  store.getMetadata = (id) => {
    const host = activeEncoded();
    return host !== undefined && TERMINALS[host]?.includes(id)
      ? { id }
      : undefined;
  };
  store.focusTerminal = activate;
});

/** Both hosts are connected pool members (a fleet row only exists for one),
 *  with A the one being viewed — and A's owner BORN, as it is in an app that
 *  has been rendering A's canvas. (The owner index is lazy: left untouched,
 *  the handler under test would be what first builds it, and the departing
 *  host would have no owner to assert about.) */
function poolOfTwo(): void {
  addHost(HOST_A);
  addHost(HOST_B);
  setDriveHost(HOST_A);
  flush();
  if (activeScope() === undefined || activeScope() !== hostScopeOf(HOST_A)) {
    throw new Error("HOST_A's owner was not built");
  }
}

describe("a host switch and a landing in one handler", () => {
  it("a foreign palette row lands on the row's own host, leaving the departing host's focus and visit trail untouched", () => {
    poolOfTwo();

    // ONE handler, as the palette row's `onSelect` runs it: switch, then land.
    selectFleetTerminal(HOST_B, TID_B, HOST_A, setDriveHost, activate);
    flush();

    expect(hostScopeOf(HOST_B)?.view.focusedTerminalId()).toBe(TID_B);
    expect(useVisitRecency().mruForHost(HOST_B)).toEqual([TID_B]);
    // The host you left keeps its own focus and its own trail — a foreign id
    // written there is both a wrong landing and a persisted lie. (The trail is
    // the FACT; this host's `mruOrder` is that trail narrowed to its census.)
    expect(hostScopeOf(HOST_A)?.view.focusedTerminalId()).toBeNull();
    expect(useVisitRecency().mruForHost(HOST_A)).toEqual([]);
  });

  it("a same-host palette row still lands with no switch", () => {
    poolOfTwo();

    selectFleetTerminal(HOST_A, TID_A, HOST_A, setDriveHost, activate);
    flush();

    expect(hostScopeOf(HOST_A)?.view.focusedTerminalId()).toBe(TID_A);
    expect(hostScopeOf(HOST_B)).toBeUndefined();
  });

  it("the Conductor's open-tile reaches a tile on another host without the false 'no longer exists' toast", () => {
    poolOfTwo();
    const { openTileAt, dispose } = createRoot((dispose) => ({
      openTileAt: useOpenTile(),
      dispose,
    }));
    try {
      // The click handler on a `create` card / watched row: one step.
      openTileAt({ host: "remote:B", id: TID_B });
      flush();

      expect(toasted.warnings).toEqual([]);
      expect(hostScopeOf(HOST_B)?.view.focusedTerminalId()).toBe(TID_B);
      expect(hostScopeOf(HOST_A)?.view.focusedTerminalId()).toBeNull();
    } finally {
      dispose();
    }
  });
});
