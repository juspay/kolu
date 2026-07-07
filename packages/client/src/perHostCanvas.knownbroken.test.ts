/** KNOWN-BROKEN: per-host canvas state stranded in app-lifetime singletons
 *  (W4 host-axis audit — `broken[]`). The FIX is deferred to a pending
 *  design review; these tests PROVE the defect and must NOT be "fixed" by
 *  editing the assertions — only by fixing `useViewState.ts`/
 *  `useSessionRestore.ts`/`useTileStore.ts` and flipping `.fails` -> `it`.
 *
 *  The four confirmed defects, all the SAME underlying shape (a per-host
 *  fact living in a singleton that is created ONCE and never re-keyed on
 *  `activeHost`):
 *    - `useViewState.ts:17` `activeId` (per-host focused-terminal UUID),
 *    - `useViewState.ts:39` `mruOrder` (per-host MRU),
 *    - `useSessionRestore.ts:28` the one-shot `decided`/`viewSeeded` latches
 *      (never reset on host switch, so a switch never re-runs
 *      `hydrateFromTerminals` for the newly-active host),
 *    - `useTileStore.ts:33` the selection half (`activeId`/`activate`), which
 *      is a verbatim re-export of `useViewState`'s unkeyed signals — so it
 *      inherits the same bug rather than needing its own repro.
 *
 *  Fixture: ONE `useViewState()` instance feeds ONE `useSessionRestore()`
 *  mount — the exact composition `useTerminalStore`'s `createSharedRoot`
 *  builds once at `App.tsx:83` and never re-creates. "Switching hosts" is
 *  simulated exactly as `wire.ts` describes a real switch: the
 *  list/metadata/saved-session accessors re-key to a disjoint id space, with
 *  NO explicit reset/dispose call — because the real app's
 *  `padiMap.useEntry(activeHost)` re-key doesn't issue one either. */

import type {
  SavedSession,
  TerminalInfo,
  TerminalMetadata,
} from "@kolu/padi/surface";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
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

/** Wires ONE `useViewState()` instance (the app-lifetime singleton the real
 *  app builds inside `useTerminalStore`'s `createSharedRoot`, App.tsx:83)
 *  into ONE `useSessionRestore()` mount (ditto) — minus the metadata/webgl
 *  machinery this bug doesn't touch. `loadHost` re-keys the list/metadata/
 *  saved-session accessors to a (possibly disjoint) id set — exactly the
 *  shape `padiMap.useEntry(activeHost)` re-keying produces on a real host
 *  switch, with no explicit reset call (because the real re-key issues none
 *  either — that omission IS the bug under test). */
function mountTwoHostFixture() {
  const [list, setList] = createSignal<TerminalInfo[] | undefined>(undefined);
  const [meta, setMeta] = createSignal<Record<string, TerminalMetadata>>({});
  const [savedSession, setSavedSession] = createSignal<SavedSession | null>(
    null,
  );

  bag.savedSession = savedSession;
  bag.savedSessionPending = () => false;

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

  function loadHost(ids: readonly [string, string], activeTerminalId: string) {
    const [a, b] = ids;
    setMeta({ [a]: activeMeta(), [b]: activeMeta() });
    setList([{ id: a }, { id: b }] as TerminalInfo[]);
    setSavedSession({
      terminals: [savedTerminal(a), savedTerminal(b)],
      activeTerminalId,
      savedAt: 1,
    });
  }

  return { view, store, loadHost };
}

describe("KNOWN-BROKEN pending per-host-canvas fix (W4 host-axis audit)", () => {
  it.fails("(ii) switching to a host B with live terminals adopts B's OWN saved-active id — ZERO dock click", async () => {
    await createRoot(async (dispose) => {
      try {
        const { view, store, loadHost } = mountTwoHostFixture();

        // Host A active: A1/A2, server-active = A2.
        loadHost(["A1", "A2"], "A2");
        await flush();
        // Sanity — the FIRST hydration on a fresh singleton works fine today;
        // the bug is specifically about a SECOND host never re-hydrating.
        expect(view.activeId()).toBe("A2" as TerminalId);

        // Switch to host B — disjoint ids, B's OWN saved session says B1 is
        // active. This is exactly what `padiMap.useEntry(activeHost)`
        // re-keying produces on a real switch.
        loadHost(["B1", "B2"], "B1");
        await flush();

        // FIX EXPECTATION: activeId adopts B's own saved-active terminal, and
        // it resolves to a real B record — the canvas shows B immediately.
        // ACTUAL (broken): `viewSeeded` latched true on A's hydration and is
        // never reset on switch, so `hydrateFromTerminals` never re-runs for
        // B — activeId stays "A2", a UUID that doesn't even exist on B.
        expect(view.activeId()).toBe("B1" as TerminalId);
        expect(store.getMetadata(view.activeId() as TerminalId)).toBeDefined();
      } finally {
        dispose();
      }
    });
  });

  it.fails("(iii) no cross-host bleed — activeId/mruOrder must not still hold host-A UUIDs once B is active", async () => {
    await createRoot(async (dispose) => {
      try {
        const { view, loadHost } = mountTwoHostFixture();

        loadHost(["A1", "A2"], "A2");
        await flush();

        loadHost(["B1", "B2"], "B1");
        await flush();

        // FIX EXPECTATION: neither activeId nor mruOrder still names a
        // host-A id once B is active.
        // ACTUAL (broken): both `activeId` (useViewState.ts:17) and
        // `mruOrder` (useViewState.ts:39) are plain app-lifetime signals
        // never keyed on `activeHost`, so A's ids leak straight into B's
        // view. (The audit's own verdict review found the "wrong-host
        // setParent RPC storm" escalation does NOT reliably fire —
        // `useActiveReconcile` gates it on `daemonConnected()` — so this
        // test scopes the red proof to the CONFIRMED leak, not that
        // contested mechanism.)
        expect(["A1", "A2"]).not.toContain(view.activeId());
        expect(view.mruOrder()).toEqual(
          expect.not.arrayContaining(["A1", "A2"]),
        );
      } finally {
        dispose();
      }
    });
  });

  it.fails("(i) switching back A→B→A re-hydrates host A's CURRENT saved-active id, not a stale carry-over", async () => {
    await createRoot(async (dispose) => {
      try {
        const { view, loadHost } = mountTwoHostFixture();

        // Host A active, server-active = A2.
        loadHost(["A1", "A2"], "A2");
        await flush();
        expect(view.activeId()).toBe("A2" as TerminalId); // sanity

        // Switch away to B.
        loadHost(["B1", "B2"], "B1");
        await flush();

        // While we're away, host A's OWN active terminal changes server-side
        // (another client, or a close-and-refocus) to A1 — the exact case a
        // real re-hydrate-on-switch-back must pick up. Switch BACK to A with
        // its NOW-current saved session.
        loadHost(["A1", "A2"], "A1");
        await flush();

        // FIX EXPECTATION: re-entering A re-hydrates activeId (and the
        // split-pane focus it drives) from A's CURRENT saved session.
        // ACTUAL (broken): `viewSeeded` latched true on the very FIRST
        // hydration and is never reset by a host switch in either
        // direction, so activeId is still "A2" — not even a "stale but
        // matching" carry-over, just frozen from the first load.
        expect(view.activeId()).toBe("A1" as TerminalId);
      } finally {
        dispose();
      }
    });
  });
});
