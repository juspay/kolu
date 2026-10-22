// @vitest-environment happy-dom
/**
 * The close path routes PER ARM. A live tile can hold a split that was slept on
 * its own, and the close must then DISCARD that split while it KILLS the tile.
 *
 * Sending the dormant split a kill is the bug this pins: the server answers
 * `TerminalNotFound` for a sleeping id, the close path swallows it
 * (`Effect.ignore`) and evicts locally — so the sleeping record survives with a
 * `parentId` naming a killed terminal, the autosave persists the orphan, and
 * the next boot's restore refuses it ("missing parent") forever.
 */

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const parent = "crud-parent";
  const sub = "crud-sub";
  return {
    parent,
    sub,
    subSleeping: true,
    kill: [] as string[],
    discard: [] as string[],
  };
});

vi.mock("../wire", async () => {
  const { Effect: E } = await import("effect");
  return {
    activePadiRpc: {
      lifecycle: {
        kill: (input: { id: string }) => {
          h.kill.push(input.id);
          return E.succeed({ id: input.id });
        },
        discardSleeping: (input: { id: string }) => {
          h.discard.push(input.id);
          return E.succeed(undefined);
        },
      },
    },
  };
});

vi.mock("./useTerminalStore", () => {
  const meta = (id: string) => ({
    id,
    parentId: id === h.sub ? h.parent : null,
    state: id === h.sub && h.subSleeping ? "sleeping" : "active",
    git: { kind: "none" },
    cwd: "/work/repo",
  });
  return {
    useTerminalStore: () => ({
      getMetadata: meta,
      getSplitPaneIds: (id: string) => (id === h.parent ? [h.sub] : []),
      terminalIds: () => [h.parent],
      listSub: () => [meta(h.parent), meta(h.sub)],
      activeId: () => h.parent,
      activeMeta: () => meta(h.parent),
      active: () => ({ id: h.parent, meta: meta(h.parent) }),
      focusedTerminalId: () => h.parent,
      activate: vi.fn(),
      forgetFromMru: vi.fn(),
      reset: vi.fn(),
      setActiveSilently: vi.fn(),
      getDisplayInfo: () => undefined,
      isWorktreeShared: () => false,
    }),
  };
});

vi.mock("./useSubPanel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useSubPanel")>();
  return {
    ...actual,
    // The REAL `repairTileTabs` stays — it is the eviction cleanup under test's
    // own path; only the singleton it drives is stubbed.
    useSubPanel: () =>
      ({
        collapsePanel: vi.fn(),
        collapsePanelChrome: vi.fn(),
        peekSubPanel: () => ({
          collapsed: false,
          panelSize: 0.3,
          activeSubTab: null,
          refocusNonce: 0,
        }),
        setActiveSubTab: vi.fn(),
        selectSubTab: vi.fn(),
        requestRefocus: vi.fn(),
        removePanel: vi.fn(),
        togglePanel: vi.fn(),
        focusSubTab: vi.fn(),
        focusMainPane: vi.fn(),
        focusVisibleSubPane: vi.fn(),
        setPanelSize: vi.fn(),
        expandAndFocusPanel: vi.fn(),
        seedSplitTab: () => () => {},
      }) as unknown as ReturnType<typeof actual.useSubPanel>,
  };
});

vi.mock("../right-panel/useRightPanel", () => ({
  useRightPanel: () => ({
    removePanel: vi.fn(),
    adoptTileCollapsed: () => () => {},
    showInspector: vi.fn(),
    reveal: vi.fn(),
  }),
}));

vi.mock("./useTerminalSearch", () => ({
  useTerminalSearch: () => ({ removeTerminal: vi.fn(), reset: vi.fn() }),
}));
vi.mock("../canvas/usePendingLayouts", () => ({
  usePendingLayouts: () => ({}),
}));
vi.mock("../settings/useTips", () => ({
  useTips: () => ({ showTipOnce: vi.fn() }),
}));
vi.mock("../kaval/useDaemonStatus", () => ({
  refuseIfWarming: () => false,
}));
vi.mock("../exportScrollbackAsPdf", () => ({
  exportScrollbackAsPdf: vi.fn(),
}));
vi.mock("../exportSessionAsHtml", () => ({
  exportSessionAsHtml: vi.fn(),
}));
vi.mock("@kolu/solid-logtail", () => ({
  writeTextToClipboard: vi.fn(),
}));
vi.mock("solid-sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    warning: vi.fn(),
  },
}));

const { useTerminalCrud } = await import("./useTerminalCrud");

describe("closing a mixed family", () => {
  it("discards a dormant split and kills the live tile", async () => {
    h.kill = [];
    h.discard = [];
    h.subSleeping = true;
    const crud = useTerminalCrud();

    await Effect.runPromise(crud.handleKillWithSubs(h.parent as never));

    // The split takes its own arm…
    expect(h.discard).toEqual([h.sub]);
    // …and the tile its own. Crucially, no kill was ever aimed at the dormant
    // split — that is the request the server answers `TerminalNotFound`.
    expect(h.kill).toEqual([h.parent]);
  });

  it("kills every member of a live family", async () => {
    h.kill = [];
    h.discard = [];
    h.subSleeping = false;
    const crud = useTerminalCrud();

    await Effect.runPromise(crud.handleKillWithSubs(h.parent as never));

    expect(h.discard).toEqual([]);
    expect(h.kill).toEqual([h.sub, h.parent]);
  });
});
