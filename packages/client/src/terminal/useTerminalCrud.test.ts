import type { TerminalId } from "kolu-common/surface";
import { createRoot } from "solid-js";
import { describe, expect, it, vi } from "vitest";

// `handleKillWithSubsStrict` is the load-bearing logic behind a failed sleep's
// rollback decision (codex F10): rolling the sleeping snapshot back is only safe
// when NOTHING was torn down. The hook iterates subs-first then the parent, so a
// failure can land after an earlier kill already succeeded — that partial case
// must surface as `PartialKillError` so the caller KEEPS the snapshot (the only
// durable copy of the killed pieces) instead of deleting recovery state.
//
// Drive the kill RPC through a hoisted bag and stub every module the crud
// singleton pulls at import time, so the hook loads under Node without a socket.
const h = vi.hoisted(() => ({
  subs: [] as TerminalId[],
  // Map of terminal id → outcome: "ok" resolves, otherwise reject with a fault
  // carrying that string as its `code`.
  killOutcome: {} as Record<string, string>,
  killed: [] as TerminalId[],
}));

vi.mock("../wire", () => ({
  client: {
    terminal: {
      kill: vi.fn(async ({ id }: { id: TerminalId }) => {
        const outcome = h.killOutcome[id] ?? "ok";
        if (outcome !== "ok") throw { code: outcome, message: outcome };
        h.killed.push(id);
      }),
      setParent: vi.fn(async () => {}),
    },
  },
  preferences: () => ({ shuffleTheme: false }),
}));
vi.mock("../kaval/useDaemonStatus", () => ({ refuseIfWarming: () => false }));
vi.mock("../right-panel/useRightPanel", () => ({
  useRightPanel: () => ({ removePanel: () => {} }),
}));
vi.mock("./useSubPanel", () => ({
  useSubPanel: () => ({
    getSubPanel: () => ({ activeSubTab: null }),
    setActiveSubTab: () => {},
    removePanel: () => {},
    collapsePanel: () => {},
  }),
}));
vi.mock("./useTerminalSearch", () => ({
  useTerminalSearch: () => ({ removeTerminal: () => {}, reset: () => {} }),
}));
vi.mock("../settings/useTips", () => ({
  useTips: () => ({ showTipOnce: () => {} }),
}));
vi.mock("solid-sonner", () => ({
  toast: Object.assign(() => {}, {
    loading: () => 0,
    success: () => {},
    error: () => {},
    warning: () => {},
  }),
}));
vi.mock("./useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: () => undefined,
    getSubTerminalIds: (id: TerminalId) =>
      id === ("root" as TerminalId) ? h.subs : [],
    terminalIds: () => ["root" as TerminalId, ...h.subs],
    indexOf: () => 0,
    activeId: () => null,
    setMruOrder: () => {},
    activate: () => {},
  }),
}));

import { PartialKillError, useTerminalCrud } from "./useTerminalCrud";

const root = "root" as TerminalId;
const sub1 = "sub1" as TerminalId;
const sub2 = "sub2" as TerminalId;

function reset(subs: TerminalId[], killOutcome: Record<string, string>) {
  h.subs = subs;
  h.killOutcome = killOutcome;
  h.killed = [];
}

describe("handleKillWithSubsStrict — partial-teardown signalling (F10)", () => {
  it("rethrows PLAIN when the first kill fails (nothing destroyed → safe to roll back)", async () => {
    await createRoot(async (dispose) => {
      // One sub; the FIRST kill (sub1) fails outright — nothing was torn down.
      reset([sub1], { [sub1]: "INTERNAL" });
      const crud = useTerminalCrud();
      await expect(crud.handleKillWithSubsStrict(root)).rejects.toSatisfy(
        (err) => !(err instanceof PartialKillError),
      );
      expect(h.killed).toEqual([]);
      dispose();
    });
  });

  it("rethrows PartialKillError when a LATER kill fails after an earlier success (snapshot must survive)", async () => {
    await createRoot(async (dispose) => {
      // sub1 kills fine, sub2 fails — the tree is now partially torn down.
      reset([sub1, sub2], { [sub2]: "INTERNAL" });
      const crud = useTerminalCrud();
      await expect(crud.handleKillWithSubsStrict(root)).rejects.toBeInstanceOf(
        PartialKillError,
      );
      expect(h.killed).toEqual([sub1]);
      dispose();
    });
  });

  it("treats NOT_FOUND as success and continues the tree", async () => {
    await createRoot(async (dispose) => {
      // sub1 already gone (NOT_FOUND = success), sub2 and root kill cleanly.
      reset([sub1, sub2], { [sub1]: "NOT_FOUND" });
      const crud = useTerminalCrud();
      await expect(
        crud.handleKillWithSubsStrict(root),
      ).resolves.toBeUndefined();
      expect(h.killed).toEqual([sub2, root]);
      dispose();
    });
  });
});
