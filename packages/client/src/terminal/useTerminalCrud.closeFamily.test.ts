// @vitest-environment happy-dom
/**
 * The close path routes PER ARM and evicts DEEPEST-FIRST.
 *
 * ARM: a live tile can hold a split that was slept on its own, and the close must
 * then DISCARD that split while it KILLS the tile. Sending the dormant split a
 * kill is the bug this pins: the server answers `TerminalNotFound` for a sleeping
 * id, the close path swallows it (`Effect.ignore`) and evicts locally — so the
 * sleeping record survives with a `parentId` naming a killed terminal, the
 * autosave persists the orphan, and the next boot's restore refuses it
 * ("missing parent") forever.
 *
 * ORDER: a split's eviction re-homes the children that survive it. Evicting a
 * middle split before its own child would re-home that child against a record the
 * same close already removed — a `setParent` into the void. Deepest-first makes
 * that unspellable, which the `chrome.setParent` spy below asserts (it would
 * otherwise be called for a 3-deep family).
 */

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  /** id → parentId (null for a tile). Mutated per test. */
  const tree = new Map<string, string | null>();
  const sleeping = new Set<string>();
  return {
    tree,
    sleeping,
    kill: [] as string[],
    discard: [] as string[],
    setParent: [] as Array<{ id: string; parentId: string | null }>,
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
      chrome: {
        setParent: (input: { id: string; parentId: string | null }) => {
          h.setParent.push(input);
          return E.succeed(undefined);
        },
      },
    },
  };
});

vi.mock("./useTerminalStore", () => {
  const meta = (id: string) => ({
    id,
    parentId: h.tree.get(id) ?? null,
    state: h.sleeping.has(id) ? "sleeping" : "active",
    git: { kind: "none" },
    cwd: "/work/repo",
  });
  /** Every descendant of `id`, in tree-map order (the store's flat projection). */
  const descendants = (id: string): string[] => {
    const out: string[] = [];
    for (const [child] of h.tree) {
      let cur = h.tree.get(child) ?? null;
      while (cur !== null) {
        if (cur === id) {
          out.push(child);
          break;
        }
        cur = h.tree.get(cur) ?? null;
      }
    }
    return out;
  };
  const roots = () =>
    [...h.tree.entries()].filter(([, p]) => p === null).map(([id]) => id);
  return {
    useTerminalStore: () => ({
      getMetadata: meta,
      getSplitPaneIds: descendants,
      terminalIds: roots,
      listSub: () => [...h.tree.keys()].map(meta),
      activeId: () => roots()[0] ?? null,
      activeMeta: () => {
        const id = roots()[0];
        return id === undefined ? null : meta(id);
      },
      active: () => {
        const id = roots()[0];
        return { id: id ?? null, meta: id === undefined ? null : meta(id) };
      },
      focusedTerminalId: () => roots()[0] ?? null,
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

const TILE = "crud-tile";
const SPLIT = "crud-split";
const GRAND = "crud-grand";

function resetFamily(shape: Record<string, string | null>, sleeping: string[]) {
  h.tree.clear();
  h.sleeping.clear();
  h.kill = [];
  h.discard = [];
  h.setParent = [];
  for (const [id, parentId] of Object.entries(shape)) h.tree.set(id, parentId);
  for (const id of sleeping) h.sleeping.add(id);
}

describe("closing a mixed family", () => {
  it("discards a dormant split and kills the live tile", async () => {
    resetFamily({ [TILE]: null, [SPLIT]: TILE }, [SPLIT]);
    const crud = useTerminalCrud();

    await Effect.runPromise(crud.handleKillWithSubs(TILE as never));

    // The split takes its own arm…
    expect(h.discard).toEqual([SPLIT]);
    // …and the tile its own. Crucially, no kill was ever aimed at the dormant
    // split — that is the request the server answers `TerminalNotFound`.
    expect(h.kill).toEqual([TILE]);
  });

  it("kills every member of a live family", async () => {
    resetFamily({ [TILE]: null, [SPLIT]: TILE }, []);
    const crud = useTerminalCrud();

    await Effect.runPromise(crud.handleKillWithSubs(TILE as never));

    expect(h.discard).toEqual([]);
    expect(h.kill).toEqual([SPLIT, TILE]);
  });

  it("a 3-deep discard evicts deepest-first — no re-home into deleted records", async () => {
    resetFamily({ [TILE]: null, [SPLIT]: TILE, [GRAND]: SPLIT }, [
      TILE,
      SPLIT,
      GRAND,
    ]);
    const crud = useTerminalCrud();

    // The server removes the whole dormant subtree in one call; the CLIENT's
    // local eviction must not promote a grandchild whose record is already gone.
    // Evicting the middle split first would fire `setParent(GRAND, TILE)`.
    await Effect.runPromise(
      crud.handleDiscard(TILE as never).pipe(Effect.ignore),
    );

    expect(h.discard).toEqual([TILE]);
    expect(h.setParent).toEqual([]);
  });

  it("a 3-deep kill evicts deepest-first — same rule, same reason", async () => {
    resetFamily({ [TILE]: null, [SPLIT]: TILE, [GRAND]: SPLIT }, []);
    const crud = useTerminalCrud();

    await Effect.runPromise(crud.handleKillWithSubs(TILE as never));

    expect(h.kill).toEqual([GRAND, SPLIT, TILE]);
    expect(h.setParent).toEqual([]);
  });
});
