// @vitest-environment happy-dom
/**
 * A slept FAMILY renders per PANE: sleep freezes a terminal and its splits
 * together, so the tile keeps its `Resizable` + tab strip while each pane swaps
 * its own `Terminal` for a dormant body — the main pane gets the full
 * (`size="tile"`) body, every dormant split the compact (`size="sub"`) one.
 *
 * This is the regression the old whole-tile swap could not express: with the
 * parent asleep, a sub pane rendered `Terminal` unconditionally, so a dormant
 * child read as an *exited* one (an attach verdict on a PTY-less record). The
 * assertion is therefore negative as well as positive — a dormant pane must show
 * NO live terminal.
 */

import type { ITheme } from "@xterm/xterm";
import type { TerminalId } from "kolu-common/surface";
import type { Component, JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const MAIN = "dormant-main" as TerminalId;
const SUB = "dormant-sub" as TerminalId;

/** Which terminal ids are dormant for the NEXT mount. Flipped per test; each test
 *  mounts once (metas are plain objects, so there is no reactive source to nudge). */
const h = vi.hoisted(() => ({ dormant: new Set<string>() }));

vi.mock("@corvu/resizable", () => {
  type Bag = { children?: JSX.Element } & Record<string, unknown>;
  const Root: Component<Bag> = (props) => <div>{props.children}</div>;
  const Panel: Component<Bag> = (props) => <div>{props.children}</div>;
  const Handle: Component<Bag> = () => <div data-testid="resize-handle" />;
  return { default: Object.assign(Root, { Panel, Handle }) };
});

vi.mock(import("@kolu/padi-client/surface"), async (importOriginal) => ({
  ...(await importOriginal()),
  // The real one is a discriminant on `state`; the store mock below hands each
  // pane the state this test set up, so the component's per-pane swap is what is
  // under test, not the arm helper.
  sleepingArm: (m: { state?: string } | null | undefined) =>
    m?.state === "sleeping" ? (m as never) : undefined,
}));

vi.mock("./useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: (id: TerminalId) => ({
      id,
      state: h.dormant.has(id) ? ("sleeping" as const) : ("active" as const),
      parentId: id === SUB ? MAIN : null,
    }),
    getSplitPaneIds: () => [SUB],
    focusedTerminalId: () => MAIN,
    activeMeta: () => null,
  }),
}));

vi.mock("./useSubPanel", () => ({
  useSubPanel: () => ({
    peekSubPanel: () => ({
      collapsed: false,
      panelSize: 0.3,
      activeSubTab: SUB,
      refocusNonce: 0,
    }),
    setPanelSize: vi.fn(),
    expandPanel: vi.fn(),
    expandAndFocusPanel: vi.fn(),
    collapsePanel: vi.fn(),
    selectSubTab: vi.fn(),
    focusMainPane: vi.fn(),
    focusVisibleSubPane: vi.fn(),
  }),
}));

vi.mock("./useTerminalCrud", () => ({
  useTerminalCrud: () => ({
    handleWake: vi.fn(),
    handleCreateSubTerminal: vi.fn(),
  }),
}));

vi.mock("./useTerminalSearch", () => ({
  useTerminalSearch: () => ({ isOpen: () => false, setOpen: vi.fn() }),
}));

vi.mock("./Terminal", () => ({
  default: (props: { isSub?: boolean }) => (
    <div data-testid={props.isSub ? "sub-terminal" : "main-terminal"} />
  ),
}));
vi.mock("./DormantTileBody", () => ({
  default: (props: { terminalId: string; size?: "tile" | "sub" }) => (
    <div
      data-testid="dormant-tile-body"
      data-size={props.size ?? "tile"}
      data-terminal-id={props.terminalId}
    />
  ),
}));
vi.mock("./SubPanelTabBar", () => ({
  default: () => <div data-testid="sub-panel-tab-bar" />,
}));

const { default: TerminalContent } = await import("./TerminalContent");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

function mount(): void {
  host = document.createElement("div");
  document.body.append(host);
  dispose = render(
    () => (
      <TerminalContent
        terminalId={MAIN}
        visible
        focused
        theme={{} as ITheme}
        onCloseTerminal={() => {}}
      />
    ),
    host,
  );
}

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  h.dormant = new Set();
});

describe("TerminalContent — a dormant family renders pane by pane", () => {
  it("a dormant split shows the compact body, never a live Terminal", () => {
    h.dormant = new Set([SUB]);
    mount();

    expect(host?.querySelector('[data-testid="main-terminal"]')).not.toBeNull();
    expect(host?.querySelector('[data-testid="sub-terminal"]')).toBeNull();

    const body = host?.querySelector('[data-testid="dormant-tile-body"]');
    expect(body?.getAttribute("data-size")).toBe("sub");
    expect(body?.getAttribute("data-terminal-id")).toBe(SUB);
  });

  it("a asleep tile keeps its tab strip: tile-sized main body, compact split bodies", () => {
    h.dormant = new Set([MAIN, SUB]);
    mount();

    // Nothing live behind either pane.
    expect(host?.querySelector('[data-testid="main-terminal"]')).toBeNull();
    expect(host?.querySelector('[data-testid="sub-terminal"]')).toBeNull();

    // The tile is still a tile — its split chrome is how the family is shown.
    expect(
      host?.querySelector('[data-testid="sub-panel-tab-bar"]'),
    ).not.toBeNull();

    const bodies = [
      ...(host?.querySelectorAll("[data-testid=dormant-tile-body]") ?? []),
    ];
    expect(bodies.map((b) => b.getAttribute("data-size"))).toEqual([
      "tile",
      "sub",
    ]);
    expect(bodies.map((b) => b.getAttribute("data-terminal-id"))).toEqual([
      MAIN,
      SUB,
    ]);
  });
});
