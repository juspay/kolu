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
 *  The shape-B fix landed: `useViewState` holds a per-host `HostView` record keyed
 *  by the canonical host string; switching `activeHost` SWAPS which record the
 *  accessors read/write, so a host's focus + MRU survive a switch-away IN MEMORY.
 *  `useSessionRestore`'s latches are per-host, so a host's FIRST visit seeds from
 *  its server SavedSession (adopting its active tile immediately — zero dock click)
 *  while a switch-BACK keeps the in-memory record (in-memory wins; savedSession
 *  seeds only the first visit).
 *
 *  Fixture: ONE `useViewState()` instance feeds ONE `useSessionRestore()` mount —
 *  the exact composition `useTerminalStore`'s `createSharedRoot` builds once at
 *  `App.tsx:83`. A host switch is simulated exactly as `wire.ts` performs one:
 *  `activeHost` flips AND the list/metadata/saved-session accessors re-key to that
 *  host's id space together (they all ride `padiMap.useEntry(activeHost)`). */

import type {
  SavedSession,
  TerminalInfo,
  TerminalMetadata,
} from "@kolu/padi/surface";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { batch, createRoot, createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

const rpcSpy = vi.hoisted(() => ({
  setActive: vi.fn(async () => {}),
}));

// Hoisted mutable slots the mock reads through — reassigned to REAL
// `createSignal` accessors inside `mountTwoHostFixture` so the hydration
// effect stays properly reactive (same trick `useTerminalMetadata.test.ts`
// uses: the mock factory closes over the BAG, not a snapshot of its
// contents, so a later reassignment is visible on the next read).
const bag = vi.hoisted(() => ({
  savedSession: (() => null) as () => SavedSession | null,
  savedSessionPending: (() => false) as () => boolean,
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
}));

vi.mock("./wire", () => ({
  activePadiRpc: {
    surface: {
      chrome: { setActive: rpcSpy.setActive },
      session: {
        restore: vi.fn(async () => {}),
        forfeit: vi.fn(async () => {}),
        import: vi.fn(async () => {}),
      },
      lifecycle: {
        create: vi.fn(async () => {}),
        restoreSleeping: vi.fn(async () => {}),
        sendInput: vi.fn(async () => {}),
      },
    },
  },
  savedSessionSub: { pending: () => bag.savedSessionPending() },
  savedSession: () => bag.savedSession(),
  // The per-tab active host — flips on a switch; drives the per-host keying in
  // BOTH `useViewState` (the HostView record) and `useSessionRestore` (the latch).
  activeHost: () => bag.activeHost(),
}));

// `useViewState`'s `canvasMaximized` pref — stub to a plain in-memory
// signal-shaped pair so the test doesn't need a real `localStorage`.
vi.mock("./persistedPref", () => ({
  boolPref: () => {
    let v = false;
    return [
      () => v,
      (next: boolean | ((prev: boolean) => boolean)) => {
        v =
          typeof next === "function"
            ? (next as (p: boolean) => boolean)(v)
            : next;
      },
    ];
  },
}));

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
vi.mock("./terminal/useSubPanel", () => ({
  useSubPanel: () => ({
    seedPanel: () => {},
    getSubPanel: () => ({ activeSubTab: null }),
    setActiveSubTab: () => {},
  }),
}));

import { useSessionRestore } from "./terminal/useSessionRestore";
import type { TerminalStore } from "./terminal/useTerminalStore";
import { useViewState } from "./useViewState";

/** Solid flushes `createEffect` on a microtask; a macrotask tick drains it. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The two hosts a switch moves between — distinct `HostKey`s that `encodeHostKey`
 *  maps to distinct record keys ("local" vs "remote:B"). */
const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };

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

/** Wires ONE `useViewState()` instance (the app-lifetime singleton the real app
 *  builds inside `useTerminalStore`'s `createSharedRoot`, App.tsx:83) into ONE
 *  `useSessionRestore()` mount (ditto) — minus the metadata/webgl machinery this
 *  bug doesn't touch. `loadHost(host, ids, activeId)` performs a real switch:
 *  flip `activeHost` AND re-key the list/metadata/saved-session accessors to that
 *  host's id space together, exactly as `padiMap.useEntry(activeHost)` re-keying
 *  produces on a real host switch. */
function mountTwoHostFixture() {
  const [list, setList] = createSignal<TerminalInfo[] | undefined>(undefined);
  const [meta, setMeta] = createSignal<Record<string, TerminalMetadata>>({});
  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );
  const [host, setHost] = createSignal<HostKey>(HOST_A);

  bag.savedSession = savedSession;
  bag.savedSessionPending = () => false;
  bag.activeHost = host;

  const listSub = Object.assign(() => list(), { pending: () => false });
  const terminalIds = () =>
    (list() ?? [])
      .map((t) => t.id)
      .filter((id) => !meta()[id]?.parentId) as TerminalId[];
  const getMetadata = (id: TerminalId) => meta()[id];

  const view = useViewState();
  const store = {
    listSub,
    terminalIds,
    getMetadata,
    recordPhases: () => ({ awaited: 0, parked: 0, live: 0 }),
    setActiveSilently: view.setActiveSilently,
    activeId: view.activeId,
    setMruOrder: view.setMruOrder,
  } as unknown as TerminalStore;

  useSessionRestore({ store });

  function loadHost(
    target: HostKey,
    ids: readonly [string, string],
    activeTerminalId: string,
  ) {
    const [a, b] = ids;
    // Re-key host + list/metadata/saved-session together (one batch = one atomic
    // switch). This mirrors the real app, where flipping `activeHost` re-keys the
    // host-scoped readouts through `padiMap.useEntry` in lockstep — the hydration
    // effect never observes host B paired with host A's stale list (in the real
    // app the readouts go PENDING on switch, gating that intermediate out; here the
    // batch collapses it). Without this, the effect would seed B's record from A's
    // still-current terminals before B's own arrive.
    batch(() => {
      setHost(target);
      setMeta({ [a]: activeMeta(), [b]: activeMeta() });
      setList([{ id: a }, { id: b }] as TerminalInfo[]);
      setSavedSession({
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
