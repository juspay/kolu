import type { TerminalId, TerminalInfo } from "kolu-common/surface";
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

vi.mock("../wire", () => ({
  client: {},
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
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
  }),
}));
vi.mock("anyagent/cli", () => ({ resumeAgentCommand: () => null }));

/** A `TerminalStore` whose `listSub`/`terminalIds` read the hoisted bag, so a
 *  test can flip a flag and call `isLoading()` to observe the gate directly.
 *  `useSessionRestore` is now a `createSharedRoot` singleton that reads its
 *  collaborators off `useTerminalStore`/`useTerminalCrud`, so we mock those
 *  modules (below) to hand back this fake instead of passing a DI bag. */
vi.mock("./useTerminalStore", () => ({
  useTerminalStore: () => {
    const listSub = Object.assign(() => h.list, {
      pending: () => h.listPending,
    });
    return {
      listSub,
      terminalIds: () => h.terminalIds,
      getMetadata: () => undefined,
      setActiveSilently: () => {},
      activeId: () => null,
      setMruOrder: () => {},
    };
  },
}));
vi.mock("./useTerminalCrud", () => ({
  useTerminalCrud: () => ({
    handleCreate: vi.fn(),
    handleCreateSubTerminal: vi.fn(),
  }),
}));

import { useSessionRestore } from "./useSessionRestore";

const mount = () => useSessionRestore();

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
});
