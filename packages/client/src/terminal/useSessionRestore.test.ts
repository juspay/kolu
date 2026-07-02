import type {
  TerminalId,
  TerminalInfo,
  TerminalMetadata,
} from "kolu-common/surface";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";

// `isLoading` is a pure read over three reactive inputs: the terminal list's
// pending flag, the live terminal count, and the saved-session cell's pending
// flag. Drive those three through a plain hoisted bag and stub every module
// `useSessionRestore` pulls at import time so the hook loads under Node without
// a live socket, toast DOM, or the SSR-only `solid-js/web` build.
const h = vi.hoisted(() => ({
  listPending: true,
  list: undefined as TerminalInfo[] | undefined,
  terminalIds: [] as TerminalId[],
  sessionPending: true,
  savedSession: null as unknown,
}));

// Spies for every RPC `handleRestoreSession` could conceivably fire. The W1.R6
// contract: restore issues ONLY `session.restore` — the former client respawn
// loop (`lifecycle.create` / `restoreSleeping` / `sendInput`) is DELETED, so
// those must stay at zero.
const rpc = vi.hoisted(() => ({
  restore: vi.fn(async () => {}),
  import: vi.fn(async () => {}),
  create: vi.fn(async () => {}),
  restoreSleeping: vi.fn(async () => {}),
  sendInput: vi.fn(async () => {}),
}));

vi.mock("@kolu/padi/surface", () => ({
  padiRpc: () => ({
    surface: {
      session: { restore: rpc.restore, import: rpc.import },
      lifecycle: {
        create: rpc.create,
        restoreSleeping: rpc.restoreSleeping,
        sendInput: rpc.sendInput,
      },
    },
  }),
}));

vi.mock("../wire", () => ({
  padi: {},
  savedSessionSub: { pending: () => h.sessionPending },
  savedSession: () => h.savedSession,
}));
vi.mock("../rpc/rpc", () => ({ lifecycle: () => ({ kind: "connected" }) }));
vi.mock("../right-panel/useRightPanel", () => ({
  useRightPanel: () => ({ seedPanel: () => {} }),
}));
vi.mock("./useSubPanel", () => ({
  useSubPanel: () => ({
    seedPanel: () => {},
    getSubPanel: () => ({ activeSubTab: null }),
    setActiveSubTab: () => {},
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

import { useSessionRestore } from "./useSessionRestore";
import type { TerminalStore } from "./useTerminalStore";

/** A `TerminalStore` whose `listSub`/`terminalIds` read the hoisted bag, so a
 *  test can flip a flag and call `isLoading()` to observe the gate directly. */
function makeStore(): TerminalStore {
  const listSub = Object.assign(() => h.list, { pending: () => h.listPending });
  return {
    listSub,
    terminalIds: () => h.terminalIds,
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
    rpc.restoreSleeping.mockClear();
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
            expect(rpc.restoreSleeping).not.toHaveBeenCalled();
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
