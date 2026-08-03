/** Per-host canvas state (shape B) — the acceptance suite for srid's live bug:
 *  splits/focus lost on host switch, blank canvas on switch-to-a-host-with-tiles.
 *
 *  These began as RED-FIRST proofs of four confirmed defects — per-host selection
 *  facts stranded in app-lifetime singletons, never re-keyed on `activeHost`:
 *    - `useViewState.ts` `activeId` / `mruOrder` (per-host, unkeyed),
 *    - `useSessionRestore.ts` the one-shot `decided`/`seeded` latches (never reset
 *      on switch, so a switch never re-runs `hydrateFromTerminals` for the new host),
 *    - `useTileStore.ts` the selection half (a verbatim re-export of the same
 *      `useViewState` signals).
 *
 *  W7 flipped the fix from enumeration to OWNERSHIP: the per-host selection state
 *  now lives in the per-host `scopedByEntry` owner (`hostScope/*`), and the hooks
 *  (`useViewState`, `useSessionRestore`) are WINDOWS onto the active host's scope.
 *  Switching `activeHost` re-keys which owner the windows read, so a host's focus +
 *  MRU survive a switch-away IN THAT OWNER; `useSessionRestore`'s latch is per-host,
 *  so a host's FIRST visit seeds from its server SavedSession (adopting its active
 *  tile immediately — zero dock click) while a switch-BACK keeps the in-memory
 *  record (in-memory wins; savedSession seeds only the first visit).
 *
 *  Fixture (adapted for W7; the three `it(...)` blocks are BYTE-IDENTICAL): it
 *  stands up a REAL `scopedByEntry` over a MOCK `padiMap` — a synchronous,
 *  signal-backed `entries` membership + the real HostKey codec — so the windows
 *  read the real owner machinery, not a parallel model. `loadHost(host, ids,
 *  activeId)` is ADD-AS-MEMBER (+ first activation): it adds the host to `entries`
 *  AND re-keys the list/metadata/saved-session accessors to that host's id space
 *  together, exactly as `padiMap.entries` + `padiMap.useEntry(activeHost)` re-keying
 *  produce on a real host switch. The driven signals are module-level and stable
 *  (the app-lifetime owner tracks `activeHost` + membership once); `beforeEach`
 *  EMPTIES membership first, disposing the prior test's owners (lazy-again-after-
 *  re-add), for full per-test isolation.
 *
 *  (Pre-W7, this fixture wired ONE `useViewState()` self-contained per-host store
 *  driven by a mocked `activeHost`, with NO `padiMap` in its `vi.mock("./wire")`.
 *  It pinned the WIRING alongside the behavior, so it could not survive the
 *  wiring's deletion — run against the W7 facade it fails at import with
 *  `No "padiMap" export is defined on the "./wire" mock` (hostScopes.ts's
 *  `scopedByEntry(padiMap, …)`). The three assertion blocks are unchanged; only
 *  the fixture is refactored to the real owner. See the commit message for the
 *  fixture old→new map + that red-run record.) */

import { Effect } from "effect";
import type {
  SavedSession,
  TerminalInfo,
  TerminalMetadata,
} from "@kolu/padi/surface";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { batch, createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcSpy = vi.hoisted(() => ({
  setActive: vi.fn(() => Effect.void),
}));

// Hoisted mutable slots the mock reads THROUGH — assigned to the module-level
// driven signals below (created with the code-under-test's own solid instance).
// The mock factory closes over the BAG, not a snapshot, so it always reads the
// live signal.
const bag = vi.hoisted(() => ({
  savedSession: (() => null) as () => SavedSession | null,
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
}));

// The `./wire` mock stands up the MOCK `padiMap` the real `scopedByEntry` owner
// reads — a synchronous, signal-backed `entries` membership + the real HostKey
// codec, from the shared `mockHostMap` testlib. `loadHost` drives membership via
// its `addHost`; `beforeEach` empties it via `resetHosts`.
vi.mock("./wire", async () => {
  const { mockPadiMap, mockGroundedActiveHost } = await import(
    "./hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    // The GROUNDED accessor the per-host scope reads — the shared testlib composition.
    groundedActiveHost: mockGroundedActiveHost(() => bag.activeHost()),
    // `createViewState`'s `writeFocus` reports the active tile through the
    // per-host procedure face `padiRpcOf(host)`.
    padiRpcOf: () => ({
      chrome: { setActive: rpcSpy.setActive },
    }),
    activePadiRpc: {
      session: {
        restore: vi.fn(() => Effect.void),
        forfeit: vi.fn(() => Effect.void),
        import: vi.fn(() => Effect.void),
      },
      lifecycle: {
        create: vi.fn(() => Effect.void),
        sendInput: vi.fn(() => Effect.void),
      },
    },
    // The per-tab active host — flips on a switch; drives the per-host keying in
    // the `scopedByEntry` owner that BOTH `useViewState` (view) and
    // `useSessionRestore` (the latch) read.
    activeHost: () => bag.activeHost(),
  };
});
// The saved-session facades moved OUT of `wire.ts` into `hostScope/activeWire` at W9
// (to break the `wire ↔ hostScopes` cycle); `useSessionRestore` imports them from there.
vi.mock("./hostScope/activeWire", () => ({
  savedSessionSub: { pending: () => false },
  savedSession: () => bag.savedSession(),
}));

// `createHostPrefs`'s per-host prefs (`showSleeping` via `perHostBoolPref`,
// `activityWindow` via `perHostPref`) and `createViewState`'s posture
// (`canvasMaximized` via `perHostBoolPref`) — stub each to a plain in-memory
// signal-shaped pair honoring the passed `fallback`, so the test needs no real
// `localStorage`. The three blocks below exercise only `activeId`/`mruOrder`, so
// these prefs' values are never asserted.
vi.mock("./persistedPref", () => {
  const stub = <T>(fallback: T) => {
    let v = fallback;
    return [
      () => v,
      (next: T | ((prev: T) => T)) => {
        v = typeof next === "function" ? (next as (p: T) => T)(v) : next;
      },
    ];
  };
  return {
    persistedPref: <T>(opts: { fallback: T }) => stub(opts.fallback),
    perHostBoolPref: (opts: { fallback: boolean }) => stub(opts.fallback),
    perHostPref: <T>(opts: { fallback: T }) => stub(opts.fallback),
  };
});

vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
    info: () => {},
  }),
}));

vi.mock("./rpc/rpc", () => ({ lifecycle: () => ({ kind: "connected" }) }));
vi.mock("./right-panel/useRightPanel", () => ({
  useRightPanel: () => ({ seedPanel: () => {} }),
}));
import { addHost, resetHosts } from "./hostScope/mockHostMap.testlib";
import { useSessionRestore } from "./terminal/useSessionRestore";
import { useSubPanel } from "./terminal/useSubPanel";
import type { TerminalStore } from "./terminal/useTerminalStore";
import { useViewState } from "./useViewState";

/** Solid flushes `createEffect` on a microtask; a macrotask tick drains it. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The two hosts a switch moves between — distinct `HostKey`s that `encodeHostKey`
 *  maps to distinct record keys ("local" vs "remote:B"). */
const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };

// The driven state — module-level STABLE signals (the code's own solid instance),
// wired into `bag`. The app-lifetime `scopedByEntry` owner tracks `activeHost`
// ONCE, so `activeHost` must be one stable signal for the whole suite; a per-test
// reassignment would strand the owner's memo on a disposed signal. (Membership is
// the shared `mockHostMap` signal, driven by `addHost`/`resetHosts`.)
const [driveHost, setDriveHost] = createSignal<HostKey>(HOST_A);
const [driveList, setDriveList] = createSignal<TerminalInfo[] | undefined>(
  undefined,
);
const [driveMeta, setDriveMeta] = createSignal<
  Record<string, TerminalMetadata>
>({});
const [driveSaved, setDriveSaved] = createSignal<SavedSession | null>(null);
bag.activeHost = driveHost;
bag.savedSession = driveSaved;

beforeEach(() => {
  // Empty membership FIRST — a member leaving `entries` disposes its owner, so
  // this drops every per-host owner the prior test built (lazy-again-after-re-add:
  // the next `loadHost` re-adds each host as a FRESH owner). Then reset the rest.
  resetHosts();
  setDriveHost(HOST_A);
  setDriveList(undefined);
  setDriveMeta({});
  setDriveSaved(null);
});

const savedTerminal = (id: string): SavedSession["terminals"][number] => ({
  id,
  state: "active" as const,
  cwd: `/${id}`,
  git: null,
  pr: { kind: "absent" as const },
  location: { kind: "local" as const },
  lastActivityAt: 0,
});

const activeMeta = (): TerminalMetadata =>
  ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;

/** Wires ONE `useViewState()` window (the app-lifetime singleton the real app
 *  builds inside `useTerminalStore`'s `createSharedRoot`, App.tsx:83) into ONE
 *  `useSessionRestore()` mount (ditto) — minus the metadata/webgl machinery this
 *  bug doesn't touch — over the REAL `scopedByEntry` owner (the mock `padiMap`).
 *  `loadHost(host, ids, activeId)` performs a real switch: ADD the host to
 *  `entries` (add-as-member), flip `activeHost` (first activation), AND re-key the
 *  list/metadata/saved-session accessors to that host's id space together, exactly
 *  as `padiMap.entries` + `padiMap.useEntry(activeHost)` re-keying produce on a
 *  real host switch. */
function mountTwoHostFixture() {
  const listSub = Object.assign(() => driveList(), { pending: () => false });
  const terminalIds = () =>
    (driveList() ?? [])
      .map((t) => t.id)
      .filter((id) => !driveMeta()[id]?.parentId) as TerminalId[];
  const getMetadata = (id: TerminalId) => driveMeta()[id];

  const view = useViewState();
  const subPanel = useSubPanel();
  const store = {
    listSub,
    terminalIds,
    getMetadata,
    recordPhases: () => ({ awaited: 0, parked: 0, live: 0 }),
    setActiveSilently: (id: TerminalId | null) =>
      id === null ? subPanel.clearFocus() : subPanel.focusVisiblePane(id),
    activeId: view.activeId,
    reconcileLiveIds: view.reconcileLiveIds,
  } as unknown as TerminalStore;

  useSessionRestore({ store });

  function loadHost(
    target: HostKey,
    ids: readonly [string, string],
    activeTerminalId: string,
  ) {
    const [a, b] = ids;
    // Re-key membership + host + list/metadata/saved-session together (one batch =
    // one atomic switch). ADD-AS-MEMBER: the target joins `entries` (the owner's
    // disposal authority) as it becomes active — mirroring the real app, where a
    // host is in the pool before you switch to it. Flipping `activeHost` re-keys
    // the host-scoped readouts through the `scopedByEntry` owner in lockstep — the
    // hydration effect never observes host B paired with host A's stale list (in
    // the real app the readouts go PENDING on switch, gating that intermediate out;
    // here the batch collapses it). Without this, the effect would seed B's record
    // from A's still-current terminals before B's own arrive.
    batch(() => {
      addHost(target);
      setDriveHost(target);
      setDriveMeta({ [a]: activeMeta(), [b]: activeMeta() });
      setDriveList([{ id: a }, { id: b }] as TerminalInfo[]);
      setDriveSaved({
        terminals: [savedTerminal(a), savedTerminal(b)],
        activeTerminalId,
        savedAt: 1,
      });
    });
  }

  return { view, store, loadHost };
}

describe("per-host canvas state (shape B)", () => {
  it("(ii) switching to a host B with live terminals adopts B's OWN saved-active id — ZERO dock click", async () => {
    await createRoot(async (dispose) => {
      try {
        const { view, store, loadHost } = mountTwoHostFixture();

        // Host A active: A1/A2, server-active = A2.
        loadHost(HOST_A, ["A1", "A2"], "A2");
        await flush();
        expect(view.activeId()).toBe("A2" as TerminalId);

        // Switch to host B — disjoint ids, B's OWN saved session says B1 is active.
        loadHost(HOST_B, ["B1", "B2"], "B1");
        await flush();

        // B's first visit seeds from B's savedSession: activeId adopts B1 and it
        // resolves to a real B record — the canvas shows B immediately, no dock click.
        expect(view.activeId()).toBe("B1" as TerminalId);
        expect(store.getMetadata(view.activeId() as TerminalId)).toBeDefined();
      } finally {
        dispose();
      }
    });
  });

  it("(iii) no cross-host bleed — activeId/mruOrder hold B's ids once B is active, never A's", async () => {
    await createRoot(async (dispose) => {
      try {
        const { view, loadHost } = mountTwoHostFixture();

        loadHost(HOST_A, ["A1", "A2"], "A2");
        await flush();

        loadHost(HOST_B, ["B1", "B2"], "B1");
        await flush();

        // Each host's selection lives in its OWN record; switching swaps which
        // record the accessors read, so B active never surfaces A's ids.
        expect(["A1", "A2"]).not.toContain(view.activeId());
        expect(view.mruOrder()).toEqual(
          expect.not.arrayContaining(["A1", "A2"]),
        );
        expect(view.mruOrder()).toContain("B1" as TerminalId);
      } finally {
        dispose();
      }
    });
  });

  it("(i) switching back A→B→A restores A's IN-MEMORY view (in-memory wins; savedSession seeds only the first visit)", async () => {
    await createRoot(async (dispose) => {
      try {
        const { view, loadHost } = mountTwoHostFixture();

        // Host A active, server-active = A2 → A's record seeds activeId = A2.
        loadHost(HOST_A, ["A1", "A2"], "A2");
        await flush();
        expect(view.activeId()).toBe("A2" as TerminalId);

        // Switch away to B (seeds B's record).
        loadHost(HOST_B, ["B1", "B2"], "B1");
        await flush();
        expect(view.activeId()).toBe("B1" as TerminalId);

        // While away, host A's server-side active changes to A1 (another client, or
        // a close-and-refocus). Switch BACK to A with that NOW-current saved session.
        loadHost(HOST_A, ["A1", "A2"], "A1");
        await flush();

        // Shape B: A's record is already seeded, so the switch-back keeps its
        // IN-MEMORY selection (A2 — the split panes + focus you left) rather than
        // re-seeding from the server's changed A1. savedSession seeds only the
        // first visit; a deliberate in-session restore is the re-seed path.
        expect(view.activeId()).toBe("A2" as TerminalId);
        expect(view.mruOrder()).toContain("A2" as TerminalId);
        expect(view.mruOrder()).toEqual(
          expect.not.arrayContaining(["B1", "B2"]),
        );
      } finally {
        dispose();
      }
    });
  });
});
