import type {
  SavedSession,
  TerminalInfo,
  TerminalMetadata,
} from "@kolu/padi-client/surface";
import { Effect } from "effect";
import type { HostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { batch, createRoot, createSignal } from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpcSpy = vi.hoisted(() => ({
  setActive: vi.fn(() => Effect.void),
}));

const bag = vi.hoisted(() => ({
  savedSession: (() => null) as () => SavedSession | null,
  activeHost: (() => ({ kind: "local" })) as () => HostKey,
}));

vi.mock("./wire", async () => {
  const { mockPadiMap, mockGroundedActiveHost } = await import(
    "./hostScope/mockHostMap.testlib"
  );
  return {
    padiMap: mockPadiMap,
    groundedActiveHost: mockGroundedActiveHost(() => bag.activeHost()),
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
    activeHost: () => bag.activeHost(),
  };
});
vi.mock("./hostScope/activeWire", () => ({
  savedSessionSub: { pending: () => false },
  savedSession: () => bag.savedSession(),
}));

vi.mock("./persistedPref", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./persistedPref")>();
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
    ...actual,
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
  useRightPanel: () => ({ seedHistory: () => {} }),
}));

import { addHost, resetHosts } from "./hostScope/mockHostMap.testlib";
import { useSessionRestore } from "./terminal/useSessionRestore";
import { useSubPanel } from "./terminal/useSubPanel";
import type { TerminalStore } from "./terminal/useTerminalStore";
import { useViewState } from "./useViewState";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const HOST_A: HostKey = { kind: "local" };
const HOST_B: HostKey = { kind: "remote", target: "B" };

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
  git: { kind: "none" },
  pr: { kind: "absent" as const },
  location: { kind: "local" as const },
  lastActivityAt: 0,
  promptedAt: null,
});

const activeMeta = (): TerminalMetadata =>
  ({ state: "active", parentId: undefined }) as unknown as TerminalMetadata;

type HostSnapshot = {
  host: HostKey;
  ids: readonly [string, string];
  activeTerminalId: string;
};

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

  function loadHost(snapshot: HostSnapshot) {
    const [a, b] = snapshot.ids;
    batch(() => {
      addHost(snapshot.host);
      setDriveHost(snapshot.host);
      setDriveMeta({ [a]: activeMeta(), [b]: activeMeta() });
      setDriveList([{ id: a }, { id: b }] as TerminalInfo[]);
      setDriveSaved({
        terminals: [savedTerminal(a), savedTerminal(b)],
        activeTerminalId: snapshot.activeTerminalId,
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

        loadHost({ host: HOST_A, ids: ["A1", "A2"], activeTerminalId: "A2" });
        await flush();
        expect(view.activeId()).toBe("A2" as TerminalId);

        loadHost({ host: HOST_B, ids: ["B1", "B2"], activeTerminalId: "B1" });
        await flush();

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

        loadHost({ host: HOST_A, ids: ["A1", "A2"], activeTerminalId: "A2" });
        await flush();

        loadHost({ host: HOST_B, ids: ["B1", "B2"], activeTerminalId: "B1" });
        await flush();

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
        loadHost({ host: HOST_A, ids: ["A1", "A2"], activeTerminalId: "A2" });
        await flush();
        expect(view.activeId()).toBe("A2" as TerminalId);

        loadHost({ host: HOST_B, ids: ["B1", "B2"], activeTerminalId: "B1" });
        await flush();
        expect(view.activeId()).toBe("B1" as TerminalId);

        loadHost({ host: HOST_A, ids: ["A1", "A2"], activeTerminalId: "A1" });
        await flush();

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
