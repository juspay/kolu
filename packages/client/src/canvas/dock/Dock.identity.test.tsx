// @vitest-environment happy-dom
/** Exercise the production Dock / DockList keyed loops with fresh tree objects.
 * Only the row's external services and paint are replaced; structural owners
 * (section, cluster, row) and their accessor props are the actual components. */
import { createMemo, createSignal, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { expect, it, vi } from "vitest";
import type { DockTree } from "./dockTree";
import type { TerminalId } from "kolu-common/surface";
const fixture = vi.hoisted(() => ({
  tree: (() => undefined) as unknown as () => DockTree,
  builds: 0,
  wakes: 0,
}));
vi.mock("./useDockOrder", () => ({ useDockOrder: () => () => fixture.tree() }));
vi.mock("../../wire", () => ({ encActiveHost: () => "local" }));
vi.mock("../../persistedPref", () => ({
  persistedPref: (options: { fallback: unknown }) =>
    createSignal(options.fallback),
}));
vi.mock("../../settings/tips", () => ({ CONTEXTUAL_TIPS: {} }));
vi.mock("../../settings/useTips", () => ({
  useTips: () => ({ showTipOnce: () => {} }),
}));
vi.mock("../useViewPosture", () => ({
  useViewPosture: () => ({ mode: () => "tiled" }),
}));
vi.mock("../../tile/useTileStore", () => ({
  useTileStore: () => ({ isActiveTile: () => false, activate: () => {} }),
}));
vi.mock("../../terminal/useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: () => undefined,
    setDockOrder: () => {},
  }),
}));
vi.mock("./useDockFocus", () => ({ useDockFocus: () => () => {} }));
vi.mock("./useDockReparent", () => ({ useDockReparent: () => () => {} }));
vi.mock("./useSectionAttention", () => ({
  useSectionAttention: () => () => ({
    activeIds: [],
    askingIds: [],
    unseenIds: [],
  }),
}));
vi.mock("./useDockRowDrag", () => ({
  useDockRowDrag: () => ({}),
  useDraggedRowId: () => () => null,
  useDockDropVerdict: () => () => undefined,
  dockDropContext: () => ({}),
}));
vi.mock("./NeedsYouStrip", () => ({ NeedsYouStrip: () => null }));
vi.mock("./HiddenFooter", () => ({ HiddenFooter: () => null }));
vi.mock("./DockShortcutHint", () => ({ DockShortcutHint: () => null }));
vi.mock("./dockRowData", () => ({
  createDockRowData: () => () => ({ meta: {}, info: {} }),
  dockRowLabel: () => "row",
}));
vi.mock("./useDockRowBag", () => ({
  useDockRowBag:
    () => (props: { id: string; recencyAt: () => number | null }) => {
      fixture.builds++;
      const value = createMemo(() => {
        fixture.wakes++;
        return props.recencyAt();
      });
      return {
        id: props.id,
        get recency() {
          return value();
        },
      };
    },
}));
vi.mock("@kolu/solid-dockrow", () => ({
  DockSection: (p: {
    repo: string;
    children: JSX.Element;
    header: JSX.Element;
  }) => (
    <section data-repo={p.repo}>
      {p.header}
      {p.children}
    </section>
  ),
  DockCluster: (p: { label: string; children: JSX.Element }) => (
    <div data-cluster={p.label}>{p.children}</div>
  ),
  DockRow: (p: { id: string; recency: number }) => (
    <span data-row={p.id}>{p.recency}</span>
  ),
}));
vi.mock("@thisbeyond/solid-dnd", () => ({
  DragDropProvider: (p: { children: JSX.Element }) => p.children,
  SortableProvider: (p: { children: JSX.Element }) => p.children,
  DragDropSensors: () => null,
  DragOverlay: () => null,
  createSortable: () => ({ ref: () => {}, dragActivators: {} }),
  createDroppable: () => ({ ref: () => {} }),
  maybeTransformStyle: () => ({}),
  closestCenter: () => null,
}));
import Dock, { setDockMode } from "./Dock";
import { DockList } from "./DockList";
function tree(tick: number): DockTree {
  const rows = ["a", "b"].map((id) => ({
    id: id as TerminalId,
    bucket: "idle" as const,
    pip: "idle" as const,
    asking: false,
    ts: id === "a" ? tick : 0,
    subRows: [],
  }));
  return {
    groups: [
      {
        name: "repo",
        color: "red",
        clusters: [{ label: "branch", rows }],
        topRows: rows,
        allTopRows: rows,
        railEntries: [],
      },
    ],
    flatShortcutRows: rows,
    needsYou: [],
    hiddenCount: 0,
    sleepingCount: 0,
    order: [],
  } as unknown as DockTree;
}
for (const kind of ["desktop", "touch"] as const)
  it(`${kind}: holds section/cluster/row identity and does not rebuild rows on a tick`, () => {
    const [value, setValue] = createSignal(tree(0));
    fixture.tree = value;
    fixture.builds = 0;
    fixture.wakes = 0;
    const host = document.createElement("div");
    document.body.append(host);
    setDockMode("cards");
    const dispose = render(
      () =>
        kind === "desktop" ? (
          <Dock onCreate={() => {}} onOpenWorkspaceSearch={() => {}} />
        ) : (
          <DockList onSelect={() => {}} />
        ),
      host,
    );
    try {
      const section = host.querySelector("section"),
        cluster = host.querySelector("[data-cluster]"),
        rows = [...host.querySelectorAll("[data-row]")];
      expect(rows).toHaveLength(2);
      expect(section).not.toBeNull();
      if (kind === "desktop") expect(cluster).not.toBeNull();
      const builds = fixture.builds;
      setValue(tree(1));
      expect(host.querySelector("section")).toBe(section);
      expect(host.querySelector("[data-cluster]")).toBe(cluster);
      expect([...host.querySelectorAll("[data-row]")]).toEqual(rows);
      expect(rows[0]?.textContent).toBe("1");
      expect(rows[1]?.textContent).toBe("0");
      expect(fixture.builds).toBe(builds);
      // Both accessor props are rechecked once, with no owner reconstruction.
      expect(fixture.wakes).toBe(4);
    } finally {
      dispose();
      host.remove();
    }
  });
