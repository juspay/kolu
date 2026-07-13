import type { TerminalInfo, TerminalMetadata } from "@kolu/padi/surface";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `isLoading` is a pure read over three reactive inputs: the terminal list's
// pending flag, the live terminal count, and the saved-session cell's pending
// flag. Drive those three through a plain hoisted bag and stub every module
// `useSessionRestore` pulls at import time so the hook loads under Node without
// a live socket, toast DOM, or the SSR-only `solid-js/web` build.
const h = vi.hoisted(() => ({
  listPending: true,
  list: undefined as TerminalInfo[] | undefined,
  terminalIds: [] as TerminalId[],
  // How many listed terminals' records haven't composed yet — the `awaited` arm of
  // the metadata census the gate now reads instead of the session cell as a timing
  // proxy. Non-zero while a reload's live records are in flight.
  awaited: 0,
  sessionPending: true,
  savedSession: null as unknown,
}));

// Spies for every RPC `handleRestoreSession` could conceivably fire. The W1.R6
// contract: restore issues ONLY `session.restore` — the former client respawn
// loop (`lifecycle.create` / `sendInput`) is DELETED, so those must stay at zero.
// (`lifecycle.restoreSleeping` was also part of that dead loop and is now retired
// from the padi surface entirely — see #1784's W12 disposition.)
const rpc = vi.hoisted(() => ({
  restore: vi.fn(async () => {}),
  import: vi.fn(async () => {}),
  forfeit: vi.fn(async () => {}),
  create: vi.fn(async () => {}),
  sendInput: vi.fn(async () => {}),
}));

// Spread the REAL (browser-safe) module so every schema kolu-common/surface pulls from
// here — e.g. `HostDaemonInventorySchema` — stays present; override only `activePadiRpc`.
// Keep the REAL (browser-safe) `@kolu/padi/surface` — its schemas
// (`HostDaemonInventorySchema`, …) must stay present; the RPC double moved to
// `../wire`'s `activePadiRpc` (production now calls `activePadiRpc.surface.*`).
vi.mock("../wire", async () => {
  // W7: the restore latch is owned by the per-host `scopedByEntry` owner, which
  // reads `padiMap`. Stand up the shared mock map (single static local member —
  // these tests never switch hosts); `beforeEach` resets it so each test's latch
  // starts fresh.
  const { mockPadiMap, mockPadiRpcOf, mockGroundedActiveHost } = await import(
    "../hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    padiRpcOf: mockPadiRpcOf(vi.fn(async () => {})),
    // The GROUNDED accessor the per-host scope reads — the shared testlib composition,
    // pinned to the static local host (`beforeEach` adds LOCAL_HOST to membership).
    groundedActiveHost: mockGroundedActiveHost(() => LOCAL_HOST),
    activePadiRpc: {
      surface: {
        session: {
          restore: rpc.restore,
          import: rpc.import,
          forfeit: rpc.forfeit,
        },
        lifecycle: {
          create: rpc.create,
          sendInput: rpc.sendInput,
        },
      },
    },
    // Per-host latch keying (shape B). These tests are single-host — a stable local
    // key keeps the latch behavior identical to the pre-per-host app-lifetime latch.
    activeHost: () => ({ kind: "local" }),
  };
});
// The saved-session facades moved OUT of `wire.ts` into `hostScope/activeWire` at W9
// (to break the `wire ↔ hostScopes` cycle); `useSessionRestore` imports them from there
// now. Drive them through the same hoisted bag.
vi.mock("../hostScope/activeWire", () => ({
  savedSessionSub: { pending: () => h.sessionPending },
  savedSession: () => h.savedSession,
}));
vi.mock("../rpc/rpc", () => ({ lifecycle: () => ({ kind: "connected" }) }));
vi.mock("../right-panel/useRightPanel", () => ({
  useRightPanel: () => ({ seedPanel: () => {} }),
}));
const subPanelSpy = vi.hoisted(() => ({ setActiveSubTab: vi.fn() }));
vi.mock("./useSubPanel", () => ({
  useSubPanel: () => ({
    seedPanel: () => {},
    getSubPanel: () => ({ activeSubTab: null }),
    setActiveSubTab: subPanelSpy.setActiveSubTab,
  }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn() }));
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: toastSpy.success,
    error: () => {},
    warning: () => {},
  }),
}));
vi.mock("anyagent/cli", () => ({ resumeFormFor: () => null }));

import { addHost, resetHosts } from "../hostScope/mockHostMap.testlib";
import { useSessionRestore } from "./useSessionRestore";
import type { TerminalStore } from "./useTerminalStore";

beforeEach(() => {
  // The restore latch is per-host owner state now: empty membership to DISPOSE
  // the prior test's local owner (and its latch), then re-add the single local
  // host these tests use — so each test's `decided`/`seeded` starts fresh.
  resetHosts();
  addHost(LOCAL_HOST);
});

/** A `TerminalStore` whose `listSub`/`terminalIds` read the hoisted bag, so a
 *  test can flip a flag and call `isLoading()` to observe the gate directly. */
function makeStore(): TerminalStore {
  const listSub = Object.assign(() => h.list, { pending: () => h.listPending });
  return {
    listSub,
    terminalIds: () => h.terminalIds,
    recordPhases: () => ({ awaited: h.awaited, parked: 0, live: 0 }),
    getMetadata: () => undefined,
    setActiveSilently: () => {},
    activeId: () => null,
    setMruOrder: () => {},
  } as unknown as TerminalStore;
}

const mount = () => useSessionRestore({ store: makeStore() });

describe("useSessionRestore — isLoading gate (cold-launch restore race)", () => {
  it("keeps loading on an empty list until the saved-session cell reports", () => {
    createRoot((dispose) => {
      h.listPending = true;
      h.list = undefined;
      h.terminalIds = [];
      h.awaited = 0; // empty list → no records to await
      h.sessionPending = true;
      const session = mount();

      // Terminal list still pending → loading.
      expect(session.isLoading()).toBe(true);

      // List yields empty (terminals were killed on the previous shutdown) but
      // the session cell hasn't reported yet. The regression: this flipped to
      // NOT loading and rendered the bare empty state, hiding the restore card
      // until a full reload. The gate must stay loading here.
      h.listPending = false;
      h.list = [];
      h.terminalIds = [];
      expect(session.isLoading()).toBe(true);

      // Session cell reports → an honest empty-vs-restore decision can be made.
      h.sessionPending = false;
      expect(session.isLoading()).toBe(false);

      dispose();
    });
  });

  it("holds loading while a reload's records are still awaited, even after the session cell resolves", () => {
    // The restore-card-flash fix at the gate level. On a browser reload the list
    // yields its ids and the session cell resolves, but the per-terminal records
    // haven't composed yet — `terminalIds()` is transiently 0 while `awaited` is
    // non-zero. The OLD gate keyed the wait on `savedSessionSub.pending()` (which
    // resolves first), so it dropped here and flashed the restore card. The census
    // term must hold loading until the records settle.
    createRoot((dispose) => {
      h.listPending = false;
      h.list = [{ id: "t1" } as TerminalInfo, { id: "t2" } as TerminalInfo];
      h.terminalIds = []; // records not composed yet
      h.awaited = 2; // ...both still in flight
      h.sessionPending = false; // session cell already resolved (the old trap)
      const session = mount();

      expect(session.isLoading()).toBe(true);

      // Records compose live → tiles appear, gate drops. No card was ever shown.
      h.terminalIds = ["t1" as TerminalId, "t2" as TerminalId];
      h.awaited = 0;
      expect(session.isLoading()).toBe(false);

      dispose();
    });
  });

  it("does not wait on the session cell when terminals exist", () => {
    createRoot((dispose) => {
      h.listPending = false;
      h.list = [{ id: "t1" } as TerminalInfo];
      h.terminalIds = ["t1" as TerminalId];
      h.sessionPending = true; // still in flight — must not delay the canvas
      const session = mount();

      expect(session.isLoading()).toBe(false);

      dispose();
    });
  });

  it("shows the restore card at a reboot cold boot with PARKED entries in the list", async () => {
    // Regression (W1.R6): a no-survivor reboot seeds PARKED registry entries per
    // saved active — they DO appear in the raw list (they carry `info`) but are
    // off-canvas restore-card rows, so `terminalIds()` filters them out. The
    // empty-vs-restore decision must key on `terminalIds()`, NOT the raw list —
    // otherwise the parked entries read as "not empty" and the restore card
    // never appears after a real reboot with active terminals (the exact case
    // the card exists for).
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            h.listPending = false;
            h.list = [{ id: "p0" } as TerminalInfo]; // parked entry in the raw list
            h.terminalIds = []; // ...excluded from the real (canvas) set
            h.awaited = 0; // parked record has ARRIVED (settled) — not awaited
            h.sessionPending = false;
            h.savedSession = {
              terminals: [
                {
                  id: "p0",
                  state: "active",
                  cwd: "/a",
                  git: null,
                  pr: { kind: "absent" },
                  location: { kind: "local" },
                  lastActivityAt: 0,
                },
              ],
              activeTerminalId: "p0",
              savedAt: 1,
            };
            const session = mount();
            // Let the hydration effect flush so the decision runs.
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(h.savedSession);
            dispose();
            resolve();
          } catch (e) {
            dispose();
            reject(e);
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — restore fires ONLY session.restore (respawn loop deleted)", () => {
  it("issues session.restore with the resume set and ZERO lifecycle.* RPCs", async () => {
    rpc.restore.mockClear();
    rpc.create.mockClear();
    rpc.sendInput.mockClear();

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            // Empty canvas + a saved session in hand → the hydration effect sets
            // the restore card's `savedSession` signal.
            h.listPending = false;
            h.list = [];
            h.terminalIds = [];
            h.sessionPending = false;
            h.savedSession = {
              terminals: [
                {
                  id: "0",
                  state: "active",
                  cwd: "/a",
                  git: null,
                  pr: { kind: "absent" },
                  location: { kind: "local" },
                  lastActivityAt: 0,
                },
              ],
              activeTerminalId: "0",
              savedAt: 1,
            };
            const session = mount();
            // Let the hydration effect flush so `savedSession()` is populated.
            await new Promise((r) => setTimeout(r, 0));

            await session.handleRestoreSession({
              resumeIds: new Set(["0"]),
            });

            // ONE server call — the whole restore.
            expect(rpc.restore).toHaveBeenCalledTimes(1);
            expect(rpc.restore).toHaveBeenCalledWith({ resumeIds: ["0"] });
            // The deleted client respawn loop: zero of these fire.
            expect(rpc.create).not.toHaveBeenCalled();
            expect(rpc.sendInput).not.toHaveBeenCalled();

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });

  it("success toast reports 'Restored N terminals, resumed M agents' counts", async () => {
    // Pre-W1 wording restored (bare "Session restored" was a W1.R6 regression): N =
    // terminals restored, M = the resume opt-in set's size (the resumable rows the
    // card offered). Two saved terminals, one opted in → "Restored 2 terminals,
    // resumed 1 agent" (singular).
    toastSpy.success.mockClear();
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            h.listPending = false;
            h.list = [];
            h.terminalIds = [];
            h.sessionPending = false;
            const savedTerminal = (id: string) => ({
              id,
              state: "active" as const,
              cwd: `/${id}`,
              git: null,
              pr: { kind: "absent" as const },
              location: { kind: "local" as const },
              lastActivityAt: 0,
            });
            h.savedSession = {
              terminals: [savedTerminal("0"), savedTerminal("1")],
              activeTerminalId: "0",
              savedAt: 1,
            };
            const session = mount();
            await new Promise((r) => setTimeout(r, 0));

            await session.handleRestoreSession({ resumeIds: new Set(["0"]) });

            expect(toastSpy.success).toHaveBeenCalledWith(
              "Restored 2 terminals, resumed 1 agent",
              expect.anything(),
            );

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — forfeit fires session.forfeit and dismisses the card", () => {
  it("issues session.forfeit({}) and clears the saved session", async () => {
    rpc.forfeit.mockClear();

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            // Empty canvas + a saved session in hand → the hydration effect sets
            // the restore card's `savedSession` signal, so the forfeit path has
            // something to discard.
            h.listPending = false;
            h.list = [];
            h.terminalIds = [];
            h.sessionPending = false;
            h.savedSession = {
              terminals: [
                {
                  id: "0",
                  state: "active",
                  cwd: "/a",
                  git: null,
                  pr: { kind: "absent" },
                  location: { kind: "local" },
                  lastActivityAt: 0,
                },
              ],
              activeTerminalId: "0",
              savedAt: 1,
            };
            const session = mount();
            // Let the hydration effect flush so `savedSession()` is populated.
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(h.savedSession);

            await session.handleForfeitSession();

            // ONE server call — the explicit discard — with the empty input the
            // contract declares.
            expect(rpc.forfeit).toHaveBeenCalledTimes(1);
            expect(rpc.forfeit).toHaveBeenCalledWith({});
            // The card is dismissed optimistically.
            expect(session.savedSession()).toBeNull();

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — multi-terminal restore seeds the server-active tile", () => {
  // A 2-terminal restore where the server-active is the SECOND-listed terminal
  // (B), not the first (A). `hydrateFromTerminals` must prefer the server's
  // persisted active id, so B is activated + placed first in the MRU.
  //
  // This guards the server-active PREFERENCE with the full restored set present.
  // The incremental-list-delivery race (list arriving [A] then [A,B]) is
  // separately verified NOT to bite: the per-terminal metadata subscription opens
  // reactively off the list (`keys` in useTerminalMetadata), and all restore list
  // frames are published in ONE synchronous server tick (spawnPty is sync), so the
  // full `[A,B]` frame reaches the client before any terminal's metadata
  // round-trip completes — the "wait for all listed metadata" gate can never latch
  // on a partial set with the active id missing.
  function makeMetaStore(opts: {
    list: TerminalInfo[];
    meta: Record<string, TerminalMetadata>;
  }) {
    let active: string | null = null;
    const setActiveSilently = vi.fn((id: string | null) => {
      active = id;
    });
    const setMruOrder = vi.fn();
    const listSub = Object.assign(() => opts.list, { pending: () => false });
    const store = {
      listSub,
      terminalIds: () => opts.list.map((t) => t.id) as TerminalId[],
      getMetadata: (id: TerminalId) => opts.meta[id],
      setActiveSilently,
      activeId: () => active,
      setMruOrder,
    } as unknown as TerminalStore;
    return { store, setActiveSilently, setMruOrder };
  }

  it("activates the server-active terminal (B), not the first-listed (A)", async () => {
    const activeMeta = (): TerminalMetadata =>
      ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;
    h.sessionPending = false;
    h.savedSession = { terminals: [], activeTerminalId: "B", savedAt: 1 };
    const { store, setActiveSilently, setMruOrder } = makeMetaStore({
      list: [{ id: "A" }, { id: "B" }] as TerminalInfo[],
      meta: { A: activeMeta(), B: activeMeta() },
    });

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));
            expect(setActiveSilently).toHaveBeenCalledWith("B");
            expect(setMruOrder).toHaveBeenCalledWith(["B", "A"]);
            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — an in-session restore RE-SEEDS the view (viewSeeded reset)", () => {
  // FIX 2: `viewSeeded` latches true on the first live load so a reconnect doesn't
  // re-pan/re-seed. But an in-session `recycleKaval` restore (no page reload)
  // re-spawns every terminal under FRESH ids and IS a re-seed event. Without the
  // reset in `handleRestoreSession`, the hydration effect short-circuits on the
  // stale latch, so a restored parent's active sub-tab is never set and its split
  // comes back HIDDEN. This drives the real sequence — live load (latch) → drain
  // (empty, restore card) → restore click (reset) → restored terminals arrive —
  // and asserts the restored parent's sub-tab IS seeded on the second hydration.
  // Red-when-reverted: without the reset, the final `setActiveSubTab(P1, S1)` never
  // fires.
  function reactiveStore() {
    const [list, setList] = createSignal<TerminalInfo[] | undefined>(undefined);
    const [meta, setMeta] = createSignal<Record<string, TerminalMetadata>>({});
    let active: string | null = null;
    const listSub = Object.assign(() => list(), { pending: () => false });
    const store = {
      listSub,
      terminalIds: () =>
        (list() ?? [])
          .map((t) => t.id)
          .filter((id) => !meta()[id]?.parentId) as TerminalId[],
      getMetadata: (id: TerminalId) => meta()[id],
      setActiveSilently: (id: string | null) => {
        active = id;
      },
      activeId: () => active,
      setMruOrder: () => {},
    } as unknown as TerminalStore;
    return { store, setList, setMeta };
  }

  const splitMeta = (parentId?: string): TerminalMetadata =>
    ({ state: "active", parentId }) as unknown as TerminalMetadata;

  it("re-runs hydrateFromTerminals for the restored terminals (fresh parent gets its sub-tab)", async () => {
    subPanelSpy.setActiveSubTab.mockClear();
    h.sessionPending = false;
    h.savedSession = {
      terminals: [],
      activeTerminalId: "P0",
      savedAt: 1,
    };

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            const { store, setList, setMeta } = reactiveStore();

            // 1) FIRST live load — a parent P0 with a split S0. viewSeeded latches.
            setMeta({ P0: splitMeta(), S0: splitMeta("P0") });
            setList([{ id: "P0" }, { id: "S0" }] as TerminalInfo[]);
            const session = useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));
            expect(subPanelSpy.setActiveSubTab).toHaveBeenCalledWith(
              "P0" as TerminalId,
              "S0" as TerminalId,
            );

            // 2) The recycle drains the canvas → the re-fetch effect populates the
            // restore card's saved session (terminalIds is now empty).
            setMeta({});
            setList([]);
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(h.savedSession);

            subPanelSpy.setActiveSubTab.mockClear();

            // 3) The user clicks Restore — `handleRestoreSession` resets the latch.
            await session.handleRestoreSession({});

            // 4) The restored terminals arrive under FRESH ids. With the latch
            // reset, the hydration effect re-seeds the restored parent's sub-tab.
            setMeta({ P1: splitMeta(), S1: splitMeta("P1") });
            setList([{ id: "P1" }, { id: "S1" }] as TerminalInfo[]);
            await new Promise((r) => setTimeout(r, 0));

            expect(subPanelSpy.setActiveSubTab).toHaveBeenCalledWith(
              "P1" as TerminalId,
              "S1" as TerminalId,
            );

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          }
        })();
      });
    });
  });
});
