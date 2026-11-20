import type { TerminalInfo, TerminalMetadata } from "@kolu/padi-client/surface";
import { Effect } from "effect";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  lifecycleKind: (() => "connected") as () => "connected" | "restarted",
  listPending: true,
  list: undefined as TerminalInfo[] | undefined,
  terminalIds: [] as TerminalId[],
  awaited: 0,
  sessionPending: true,
  savedSession: null as unknown,
  sessionVersion: (() => 0) as () => number,
  pushSavedSession: (_value: unknown) => {},
}));

const rpc = vi.hoisted(() => ({
  restore: vi.fn(
    (): Effect.Effect<{ activeTerminalId: string | null }> =>
      Effect.succeed({ activeTerminalId: null }),
  ),
  import: vi.fn(() => Effect.void),
  forfeit: vi.fn(() => Effect.void),
  create: vi.fn(() => Effect.void),
  sendInput: vi.fn(() => Effect.void),
}));

vi.mock("../wire", async () => {
  const { mockPadiMap, mockGroundedActiveHost } = await import(
    "../hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    groundedActiveHost: mockGroundedActiveHost(() => LOCAL_HOST),
    activePadiRpc: {
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
    activeHost: () => ({ kind: "local" }),
  };
});
vi.mock("../hostScope/activeWire", () => ({
  savedSessionSub: { pending: () => h.sessionPending },
  savedSession: () => {
    h.sessionVersion();
    return h.savedSession;
  },
}));
vi.mock("../rpc/rpc", () => ({
  lifecycle: () => ({ kind: h.lifecycleKind() }),
}));
vi.mock("../right-panel/useRightPanel", () => ({
  useRightPanel: () => ({ seedHistory: () => {} }),
}));
const subPanelSpy = vi.hoisted(() => ({ setActiveSubTab: vi.fn() }));
vi.mock("./useSubPanel", () => ({
  useSubPanel: () => ({
    paneChrome: () => ({ activeSubTab: null }),
    setActiveSubTab: subPanelSpy.setActiveSubTab,
  }),
}));
const toastSpy = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: toastSpy.success,
    error: toastSpy.error,
    warning: () => {},
  }),
}));

import { addHost, resetHosts } from "../hostScope/mockHostMap.testlib";
import {
  ANSWERED_TILE_DEADLINE_MS,
  useSessionRestore,
} from "./useSessionRestore";
import type { TerminalStore } from "./useTerminalStore";

{
  const [version, bump] = createSignal(0);
  h.sessionVersion = version;
  h.pushSavedSession = (value: unknown) => {
    h.savedSession = value;
    bump((n) => n + 1);
  };
}

beforeEach(() => {
  h.lifecycleKind = () => "connected";
  resetHosts();
  addHost(LOCAL_HOST);
});

function makeStore(): TerminalStore {
  const listSub = Object.assign(() => h.list, { pending: () => h.listPending });
  return {
    listSub,
    terminalIds: () => h.terminalIds,
    recordPhases: () => ({ awaited: h.awaited, parked: 0, live: 0 }),
    getMetadata: () => undefined,
    setActiveSilently: () => {},
    activeId: () => null,
    reconcileLiveIds: () => {},
  } as unknown as TerminalStore;
}

const mount = () => useSessionRestore({ store: makeStore() });

describe("useSessionRestore — isLoading gate (cold-launch restore race)", () => {
  it("keeps loading on an empty list until the saved-session cell reports", () => {
    createRoot((dispose) => {
      h.listPending = true;
      h.list = undefined;
      h.terminalIds = [];
      h.awaited = 0;
      h.sessionPending = true;
      const session = mount();

      expect(session.isLoading()).toBe(true);

      h.listPending = false;
      h.list = [];
      h.terminalIds = [];
      expect(session.isLoading()).toBe(true);

      h.sessionPending = false;
      expect(session.isLoading()).toBe(false);

      dispose();
    });
  });

  it("holds loading while a reload's records are still awaited, even after the session cell resolves", () => {
    createRoot((dispose) => {
      h.listPending = false;
      h.list = [{ id: "t1" } as TerminalInfo, { id: "t2" } as TerminalInfo];
      h.terminalIds = [];
      h.awaited = 2;
      h.sessionPending = false;
      const session = mount();

      expect(session.isLoading()).toBe(true);

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
      h.sessionPending = true;
      const session = mount();

      expect(session.isLoading()).toBe(false);

      dispose();
    });
  });

  it("shows the restore card at a reboot cold boot with PARKED entries in the list", async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            h.listPending = false;
            h.list = [{ id: "p0" } as TerminalInfo];
            h.terminalIds = [];
            h.awaited = 0;
            h.sessionPending = false;
            h.savedSession = {
              terminals: [
                {
                  id: "p0",
                  state: "active",
                  cwd: "/a",
                  git: { kind: "none" },
                  pr: { kind: "absent" },
                  location: { kind: "local" },
                  lastActivityAt: 0,
                },
              ],
              activeTerminalId: "p0",
              savedAt: 1,
              resumableIds: [],
            };
            const session = mount();
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
  it("issues session.restore with resume intent and ZERO lifecycle.* RPCs", async () => {
    rpc.restore.mockClear();
    rpc.create.mockClear();
    rpc.sendInput.mockClear();

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
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
                  git: { kind: "none" },
                  pr: { kind: "absent" },
                  location: { kind: "local" },
                  lastActivityAt: 0,
                },
              ],
              activeTerminalId: "0",
              savedAt: 1,
              resumableIds: ["0"],
            };
            const session = mount();
            await new Promise((r) => setTimeout(r, 0));

            await Effect.runPromise(
              session.handleRestoreSession({
                resumeAgents: true,
                optOutIds: [],
              }),
            );

            expect(rpc.restore).toHaveBeenCalledTimes(1);
            expect(rpc.restore).toHaveBeenCalledWith({
              resumeAgents: true,
              optOutIds: undefined,
            });
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
              git: { kind: "none" },
              pr: { kind: "absent" as const },
              location: { kind: "local" as const },
              lastActivityAt: 0,
            });
            h.savedSession = {
              terminals: [savedTerminal("0"), savedTerminal("1")],
              activeTerminalId: "0",
              savedAt: 1,
              resumableIds: ["0", "1"],
            };
            const session = mount();
            await new Promise((r) => setTimeout(r, 0));

            await Effect.runPromise(
              session.handleRestoreSession({
                resumeAgents: true,
                optOutIds: ["1"],
              }),
            );

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

describe("useSessionRestore — forfeit fires session.forfeit; the HOST dismisses the card", () => {
  it("issues session.forfeit({}) and keeps the card until the host pushes null", async () => {
    rpc.forfeit.mockClear();

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            h.listPending = false;
            h.list = [];
            h.terminalIds = [];
            h.sessionPending = false;
            const saved = {
              terminals: [
                {
                  id: "0",
                  state: "active",
                  cwd: "/a",
                  git: { kind: "none" },
                  pr: { kind: "absent" },
                  location: { kind: "local" },
                  lastActivityAt: 0,
                },
              ],
              activeTerminalId: "0",
              savedAt: 1,
              resumableIds: [],
            };
            h.savedSession = saved;
            const session = mount();
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(saved);

            await Effect.runPromise(session.handleForfeitSession());

            expect(rpc.forfeit).toHaveBeenCalledTimes(1);
            expect(rpc.forfeit).toHaveBeenCalledWith({});
            expect(session.savedSession()).toEqual(saved);
            expect(session.isForfeiting()).toBe(false);

            h.pushSavedSession(null);
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

  it("gates a second forfeit while the first is in flight", async () => {
    rpc.forfeit.mockClear();
    const gate = Promise.withResolvers<void>();
    rpc.forfeit.mockImplementationOnce(
      () => Effect.promise(() => gate.promise) as never,
    );

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
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
                  git: { kind: "none" },
                  pr: { kind: "absent" },
                  location: { kind: "local" },
                  lastActivityAt: 0,
                },
              ],
              activeTerminalId: "0",
              savedAt: 1,
              resumableIds: [],
            };
            const session = mount();
            await new Promise((r) => setTimeout(r, 0));

            const first = Effect.runPromise(session.handleForfeitSession());
            await new Promise((r) => setTimeout(r, 0));
            expect(session.isForfeiting()).toBe(true);
            await Effect.runPromise(session.handleForfeitSession());
            expect(rpc.forfeit).toHaveBeenCalledTimes(1);

            gate.resolve();
            await first;
            expect(session.isForfeiting()).toBe(false);

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
  function makeMetaStore(opts: {
    list: TerminalInfo[];
    meta: Record<string, TerminalMetadata>;
  }) {
    let active: string | null = null;
    const setActiveSilently = vi.fn((id: string | null) => {
      active = id;
    });
    const reconcileLiveIds = vi.fn();
    const listSub = Object.assign(() => opts.list, { pending: () => false });
    const store = {
      listSub,
      terminalIds: () => opts.list.map((t) => t.id) as TerminalId[],
      getMetadata: (id: TerminalId) => opts.meta[id],
      setActiveSilently,
      activeId: () => active,
      reconcileLiveIds,
    } as unknown as TerminalStore;
    return { store, setActiveSilently, reconcileLiveIds };
  }

  it("activates the server-active terminal (B), not the first-listed (A)", async () => {
    const activeMeta = (): TerminalMetadata =>
      ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;
    h.sessionPending = false;
    h.savedSession = {
      terminals: [],
      activeTerminalId: "B",
      savedAt: 1,
      resumableIds: [],
    };
    const { store, setActiveSilently, reconcileLiveIds } = makeMetaStore({
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
            expect(reconcileLiveIds).toHaveBeenCalledWith(["B", "A"]);
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

describe("useSessionRestore — the restored active tile does NOT ride the session-cell echo", () => {
  const activeMeta = (): TerminalMetadata =>
    ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;

  const consumedBlob = {
    terminals: [],
    activeTerminalId: "t-1",
    savedAt: 1,
    resumableIds: [],
  };

  it("seeds the host-reported active tile when the restored terminals beat the session push", async () => {
    h.listPending = false;
    h.sessionPending = false;
    h.savedSession = consumedBlob;
    rpc.restore.mockImplementationOnce(() =>
      Effect.succeed({ activeTerminalId: "t-1" }),
    );

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            const [list, setList] = createSignal<TerminalInfo[] | undefined>(
              [],
            );
            const [meta, setMeta] = createSignal<
              Record<string, TerminalMetadata>
            >({});
            const setActiveSilently = vi.fn();
            const store = {
              listSub: Object.assign(() => list(), { pending: () => false }),
              terminalIds: () =>
                (list() ?? []).map((t) => t.id) as TerminalId[],
              getMetadata: (id: TerminalId) => meta()[id],
              setActiveSilently,
              activeId: () => null,
              reconcileLiveIds: () => {},
            } as unknown as TerminalStore;

            const session = useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(consumedBlob);

            await Effect.runPromise(session.handleRestoreSession({}));
            setMeta({ "t-0": activeMeta(), "t-1": activeMeta() });
            setList([{ id: "t-0" }, { id: "t-1" }] as TerminalInfo[]);
            await new Promise((r) => setTimeout(r, 0));

            expect(setActiveSilently).toHaveBeenCalledWith("t-1");
            expect(setActiveSilently).not.toHaveBeenCalledWith("t-0");

            setActiveSilently.mockClear();
            h.pushSavedSession({
              terminals: [],
              activeTerminalId: "t-1",
              savedAt: 2,
              resumableIds: [],
            });
            await new Promise((r) => setTimeout(r, 0));
            expect(setActiveSilently).not.toHaveBeenCalled();

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

describe("useSessionRestore — the seed WAITS for the answered tile to reach the list", () => {
  const activeMeta = (): TerminalMetadata =>
    ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;

  it("does not seed while the answered id is absent, then seeds it once its delta lands", async () => {
    h.listPending = false;
    h.sessionPending = false;
    h.savedSession = {
      terminals: [],
      activeTerminalId: "t-1",
      savedAt: 1,
      resumableIds: [],
    };
    rpc.restore.mockImplementationOnce(() =>
      Effect.succeed({ activeTerminalId: "t-1" }),
    );

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            const [list, setList] = createSignal<TerminalInfo[] | undefined>(
              [],
            );
            const [meta, setMeta] = createSignal<
              Record<string, TerminalMetadata>
            >({});
            const setActiveSilently = vi.fn();
            const store = {
              listSub: Object.assign(() => list(), { pending: () => false }),
              terminalIds: () =>
                (list() ?? []).map((t) => t.id) as TerminalId[],
              getMetadata: (id: TerminalId) => meta()[id],
              setActiveSilently,
              activeId: () => null,
              reconcileLiveIds: () => {},
            } as unknown as TerminalStore;

            const session = useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(h.savedSession);

            await Effect.runPromise(session.handleRestoreSession({}));

            setMeta({ "t-0": activeMeta() });
            setList([{ id: "t-0" }] as TerminalInfo[]);
            await new Promise((r) => setTimeout(r, 0));
            expect(setActiveSilently).not.toHaveBeenCalled();

            setMeta({ "t-0": activeMeta(), "t-1": activeMeta() });
            setList([{ id: "t-0" }, { id: "t-1" }] as TerminalInfo[]);
            await new Promise((r) => setTimeout(r, 0));
            expect(setActiveSilently).toHaveBeenCalledTimes(1);
            expect(setActiveSilently).toHaveBeenCalledWith("t-1");

            setActiveSilently.mockClear();
            h.pushSavedSession({
              terminals: [],
              activeTerminalId: "t-0",
              savedAt: 2,
              resumableIds: [],
            });
            await new Promise((r) => setTimeout(r, 0));
            expect(setActiveSilently).not.toHaveBeenCalled();

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

describe("useSessionRestore — that wait is BOUNDED (the answered tile never arrives)", () => {
  const activeMeta = (): TerminalMetadata =>
    ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;

  function deferringHarness() {
    const [list, setList] = createSignal<TerminalInfo[] | undefined>([]);
    const [meta, setMeta] = createSignal<Record<string, TerminalMetadata>>({});
    const setActiveSilently = vi.fn();
    const store = {
      listSub: Object.assign(() => list(), { pending: () => false }),
      terminalIds: () => (list() ?? []).map((t) => t.id) as TerminalId[],
      getMetadata: (id: TerminalId) => meta()[id],
      setActiveSilently,
      activeId: () => null,
      reconcileLiveIds: () => {},
    } as unknown as TerminalStore;
    const deliver = (...ids: string[]) => {
      setMeta(Object.fromEntries(ids.map((id) => [id, activeMeta()])));
      setList(ids.map((id) => ({ id })) as TerminalInfo[]);
    };
    return { store, deliver, setActiveSilently };
  }

  const consumedBlob = {
    terminals: [],
    activeTerminalId: "t-1",
    savedAt: 1,
    resumableIds: [],
  };

  beforeEach(() => {
    toastSpy.error.mockClear();
    h.listPending = false;
    h.sessionPending = false;
    h.savedSession = consumedBlob;
    rpc.restore.mockImplementationOnce(() =>
      Effect.succeed({ activeTerminalId: "t-1" }),
    );
  });

  it("seeds via the blob fallback and reports, once the deadline passes with the answered id still absent", async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            const { store, deliver, setActiveSilently } = deferringHarness();
            const session = useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));

            await Effect.runPromise(session.handleRestoreSession({}));
            vi.useFakeTimers();

            deliver("t-0");
            await vi.advanceTimersByTimeAsync(0);
            expect(setActiveSilently).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(ANSWERED_TILE_DEADLINE_MS - 1);
            expect(setActiveSilently).not.toHaveBeenCalled();
            expect(toastSpy.error).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(1);
            expect(setActiveSilently).toHaveBeenCalledTimes(1);
            expect(setActiveSilently).toHaveBeenCalledWith("t-0");
            expect(toastSpy.error).toHaveBeenCalledTimes(1);
            expect(toastSpy.error.mock.calls[0]?.[0]).toContain("t-1");

            deliver("t-0", "t-1");
            await vi.advanceTimersByTimeAsync(ANSWERED_TILE_DEADLINE_MS);
            expect(setActiveSilently).toHaveBeenCalledTimes(1);
            expect(toastSpy.error).toHaveBeenCalledTimes(1);

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          } finally {
            vi.useRealTimers();
          }
        })();
      });
    });
  });

  it("an arrival a tick before the deadline seeds the answered tile and DISARMS the timer", async () => {
    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            const { store, deliver, setActiveSilently } = deferringHarness();
            const session = useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));

            await Effect.runPromise(session.handleRestoreSession({}));
            vi.useFakeTimers();

            deliver("t-0");
            await vi.advanceTimersByTimeAsync(ANSWERED_TILE_DEADLINE_MS - 1);
            expect(setActiveSilently).not.toHaveBeenCalled();

            deliver("t-0", "t-1");
            await vi.advanceTimersByTimeAsync(0);
            expect(setActiveSilently).toHaveBeenCalledTimes(1);
            expect(setActiveSilently).toHaveBeenCalledWith("t-1");
            expect(toastSpy.error).not.toHaveBeenCalled();

            await vi.advanceTimersByTimeAsync(ANSWERED_TILE_DEADLINE_MS * 2);
            expect(setActiveSilently).toHaveBeenCalledTimes(1);
            expect(toastSpy.error).not.toHaveBeenCalled();

            dispose();
            resolve();
          } catch (err) {
            dispose();
            reject(err);
          } finally {
            vi.useRealTimers();
          }
        })();
      });
    });
  });
});

describe("useSessionRestore — an in-session restore RE-SEEDS the view (viewSeeded reset)", () => {
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
      reconcileLiveIds: () => {},
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
      resumableIds: [],
    };

    await new Promise<void>((resolve, reject) => {
      createRoot((dispose) => {
        void (async () => {
          try {
            const { store, setList, setMeta } = reactiveStore();

            setMeta({ P0: splitMeta(), S0: splitMeta("P0") });
            setList([{ id: "P0" }, { id: "S0" }] as TerminalInfo[]);
            const session = useSessionRestore({ store });
            await new Promise((r) => setTimeout(r, 0));
            expect(subPanelSpy.setActiveSubTab).toHaveBeenCalledWith(
              "P0" as TerminalId,
              "S0" as TerminalId,
            );

            setMeta({});
            setList([]);
            await new Promise((r) => setTimeout(r, 0));
            expect(session.savedSession()).toEqual(h.savedSession);

            subPanelSpy.setActiveSubTab.mockClear();

            await Effect.runPromise(session.handleRestoreSession({}));

            setMeta({ P0: splitMeta(), S0: splitMeta("P0") });
            setList([{ id: "P0" }, { id: "S0" }] as TerminalInfo[]);
            await new Promise((r) => setTimeout(r, 0));

            expect(subPanelSpy.setActiveSubTab).toHaveBeenCalledWith(
              "P0" as TerminalId,
              "S0" as TerminalId,
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

describe("useSessionRestore — savedSession is the host's cell, never a latched local answer", () => {
  it("adopts a LATER host push after a local action (the Restart-kaval regression)", async () => {
    rpc.forfeit.mockClear();
    h.listPending = false;
    h.list = [];
    h.terminalIds = [];
    h.sessionPending = false;
    const before = {
      terminals: [
        {
          id: "0",
          state: "active",
          cwd: "/before",
          git: { kind: "none" },
          pr: { kind: "absent" },
          location: { kind: "local" },
          lastActivityAt: 0,
        },
      ],
      activeTerminalId: "0",
      savedAt: 1,
      resumableIds: [],
    };
    const afterRestart = {
      terminals: [
        {
          id: "1",
          state: "active",
          cwd: "/parked-by-the-restart",
          git: { kind: "none" },
          pr: { kind: "absent" },
          location: { kind: "local" },
          lastActivityAt: 0,
        },
      ],
      activeTerminalId: null,
      savedAt: 2,
      resumableIds: [],
    };

    await createRoot(async (dispose) => {
      try {
        h.savedSession = before;
        const session = mount();
        await new Promise((r) => setTimeout(r, 0));
        expect(session.savedSession()).toEqual(before);

        await Effect.runPromise(session.handleForfeitSession());
        h.pushSavedSession(null);
        expect(session.savedSession()).toBeNull();

        h.pushSavedSession(afterRestart);
        expect(session.savedSession()).toEqual(afterRestart);
      } finally {
        dispose();
      }
    });
  });

  it("answers null on a restarted lifecycle, then the cell again once connected", async () => {
    const [kind, setKind] = createSignal<"connected" | "restarted">(
      "connected",
    );
    h.lifecycleKind = kind;
    h.listPending = false;
    h.list = [];
    h.terminalIds = [];
    h.sessionPending = false;
    const saved = {
      terminals: [],
      activeTerminalId: null,
      savedAt: 1,
      resumableIds: [],
    };

    await createRoot(async (dispose) => {
      try {
        h.savedSession = saved;
        const session = mount();
        await new Promise((r) => setTimeout(r, 0));
        expect(session.savedSession()).toEqual(saved);
        setKind("restarted");
        expect(session.savedSession()).toBeNull();
        setKind("connected");
        expect(session.savedSession()).toEqual(saved);
      } finally {
        dispose();
      }
    });
  });
});
