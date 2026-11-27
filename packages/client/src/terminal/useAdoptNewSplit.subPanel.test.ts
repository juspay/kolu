/** THE SPLIT-ARRIVAL ADOPTION OVER THE REAL SUB-PANEL. The other adoption
 *  suite drives the hook through spy ports, and a spy is exactly what hides
 *  this: the adoption's writes ARE the subject here. `planExpandPanel` and
 *  `setActiveSubTab` are written from the arrival mirror's APPLY ARM, whose
 *  compute has just folded the terminal census — so a reader that folds that
 *  same census with a tile's panel state (the WebGL tile budget,
 *  `useTerminalStore.ts`, through `tileWebglCost`) re-ran inside the effect's
 *  frame against the list the arm was answering. Solid grades that
 *  `EFFECT_RELAY_TEAR`, advisory at the first sighting and `warn` at the
 *  third — and three splits arriving in one session is an ordinary thing. This
 *  file fails on the FIRST sighting rather than waiting for the escalation,
 *  and it takes all three anyway. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import { Effect } from "effect";
import { LOCAL_HOST } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import {
  createEffect,
  createMemo,
  createRoot,
  createStore,
  flush,
} from "solid-js";
import { expect, it, vi } from "vitest";
import type { HostViewState } from "../hostScope/createViewState";

/** The host scope the real `useSubPanel` reads through: this file's own view
 *  state, built from `createViewState` in the test's root. */
const h = vi.hoisted(() => ({
  view: undefined as HostViewState | undefined,
  /** The pane the right panel treats as focused — the tile, until a seeded
   *  split is inspected. */
  focused: null as string | null,
}));

vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () =>
    h.view === undefined
      ? undefined
      : {
          view: h.view,
          // No terminal records here: every tile's saved split reads its one
          // default. The keys stream is still present, as every host wire has
          // one — the split settle rule subscribes to it.
          wire: { terminals: undefined, terminalKeys: () => [] },
        },
}));

vi.mock("../wire", () => ({
  padiRpcOf: () => ({
    chrome: {
      setActive: () => Effect.void,
      setRightPanel: () => Effect.void,
    },
  }),
  activePadiRpc: {
    chrome: {
      setSubPanel: () => Effect.void,
      setRightPanel: () => Effect.void,
    },
  },
  activeHost: () => "local",
  preferences: () => ({
    newTerminalCollapsed: false,
    rightPanel: { size: 0.25, codeTabTreeSize: 0.35 },
  }),
  updatePreferences: () => {},
}));

// The right panel resolves "which pane am I talking about" through the
// terminal store; this file's census is the store it reads.
vi.mock("./useTerminalStore", () => ({
  useTerminalStore: () => ({
    activeId: () => h.focused,
    focusedTerminalId: () => h.focused,
    getMetadata: () => undefined,
  }),
}));

vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({ tileCount: () => 1 }),
}));

vi.mock("solid-sonner", () => ({ toast: { error: vi.fn() } }));

import { createViewState } from "../hostScope/createViewState";
import { useRightPanel } from "../right-panel/useRightPanel";
import { useAdoptNewSplit } from "./useAdoptNewSplit";
import { useSubPanel } from "./useSubPanel";
import {
  admitWebglTiles,
  tileWebglCost,
  WEBGL_CONTEXT_CAP,
} from "./webglBudget";

const T = (s: string) => s as TerminalId;
const P = T("p0000000-0000-4000-8000-000000000001");
const SUBS = [
  T("s1000000-0000-4000-8000-000000000002"),
  T("s2000000-0000-4000-8000-000000000003"),
  T("s3000000-0000-4000-8000-000000000004"),
];

interface Row {
  id: TerminalId;
  parentId: TerminalId | null;
}

it("adopts three arriving splits with no reader left torn", () => {
  localStorage.clear();
  // THE ROOT, under the product's own store name: the surface subscription's
  // store (`surface/src/solid/createSubscription.ts`), whose records carry
  // `parentId` — what a `lifecycle.create({child-of})` from anywhere lands on.
  const [census, setCensus] = createStore<{ rows: Row[] }>(
    { rows: [{ id: P, parentId: null }] },
    { name: "createSubscription.store" },
  );
  const parentOf = (id: TerminalId): TerminalId | null | undefined =>
    census.rows.find((r) => r.id === id)?.parentId;
  const ids = (): TerminalId[] => census.rows.map((r) => r.id);

  const subPanel = useSubPanel();
  const rightPanel = useRightPanel();
  h.focused = P;
  /** Every budget this test's reader was handed, in order. */
  const budgets: string[][] = [];
  const dispose = createRoot((dispose) => {
    const view = createViewState(
      LOCAL_HOST,
      (id) => {
        const parent = parentOf(id);
        return parent === undefined
          ? { kind: "missing" }
          : parent === null
            ? { kind: "top-level" }
            : { kind: "split", parentId: parent };
      },
      () => null,
      () => ids().filter((id) => parentOf(id) === null),
      ids,
      () => true,
    );
    h.view = view;

    // THE VICTIM, as `useTerminalStore` builds it: the top-level census
    // (`parentId`) folded with each tile's panel state — `collapsed` and
    // `activeSubTab`, both of which the adoption writes — through the
    // product's own cost model.
    const webglTileBudget = createMemo(
      () => {
        const tiles = ids().filter((id) => parentOf(id) === null);
        return admitWebglTiles(
          tiles,
          (id) =>
            tileWebglCost({
              collapsed: subPanel.savedSplit(id).collapsed,
              activeSubTab: subPanel.paneChrome(id).activeSubTab,
            }),
          WEBGL_CONTEXT_CAP,
        );
      },
      {
        name: "webglTileBudget",
        equals: (a, b) =>
          a.length === b.length && a.every((id) => b.includes(id)),
      },
    );
    createEffect(
      () => webglTileBudget(),
      (budget) => {
        budgets.push([...budget]);
      },
      { name: "inBudget" },
    );

    useAdoptNewSplit({
      rawList: ids,
      parentOf,
      activeHostKey: () => "local",
      restorePhase: () => "seeded",
      ports: {
        // THE REAL WRITERS: the panel's own verbs and the right panel's own
        // seed, not spies.
        planExpandPanel: subPanel.planExpandPanel,
        activeSubTab: (parentId) => subPanel.paneChrome(parentId).activeSubTab,
        setActiveSubTab: subPanel.setActiveSubTab,
        seedSplitTab: rightPanel.seedSplitTab,
      },
    });
    return dispose;
  });
  // The tile is on the Inspector — the tab every arrival must inherit, so a
  // split created elsewhere does not flip the panel when you click into it.
  rightPanel.showInspector();
  flush();
  expect(budgets.at(-1)).toEqual([P]);
  // Everything up to the first arrival is this fixture's setup, not its
  // subject.
  takeSolidDiagnostics();

  for (const sub of SUBS) {
    // The user shuts the split panel — the tab strip's own shut button — so
    // the next arrival has a panel to open, exactly as the first one did.
    subPanel.collapsePanelChrome(P);
    flush();
    expect(subPanel.savedSplit(P).collapsed).toBe(true);

    // THE ARRIVAL: one write of the census, from `kolu create --parent`,
    // another client or MCP `lifecycle_create {child-of}`.
    setCensus((draft) => {
      draft.rows.push({ id: sub, parentId: P });
    });
    flush();

    // THE STATE THE ADOPTION LEAVES: the tile's panel is open again, the
    // first arrival holds the strip (an arrival never yanks the view off a
    // split you are already working in), and the newcomer carries the tile's
    // panel tab.
    expect(subPanel.savedSplit(P).collapsed).toBe(false);
    expect(subPanel.paneChrome(P).activeSubTab).toBe(SUBS[0]);
    h.focused = sub;
    expect(rightPanel.activeTab().kind).toBe("inspector");
    h.focused = P;
  }

  // The tile holds its WebGL context throughout: an expanded tile with an
  // active split is one admitted tile, never a frame of neither.
  expect(budgets.at(-1)).toEqual([P]);
  // RED AT THE FIRST SIGHTING: an advisory relay tear is a finding here, and
  // `info` is a grade, not an exemption.
  expect(takeSolidDiagnostics()).toEqual([]);

  h.view = undefined;
  h.focused = null;
  subPanel.removePanel(P);
  for (const sub of SUBS) rightPanel.removePanel(sub);
  rightPanel.removePanel(P);
  dispose();
});
