// @vitest-environment happy-dom

import type { ITheme } from "@xterm/xterm";
import type { TerminalId } from "kolu-common/surface";
import { type Component, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const MAIN = "focus-intent-main" as TerminalId;
const SUB = "focus-intent-sub" as TerminalId;

const h = vi.hoisted(() => ({
  onExpand: undefined as (() => void) | undefined,
  onPointerDown: undefined as (() => void) | undefined,
  expandPanel: vi.fn(),
  expandAndFocusPanel: vi.fn(),
  collapsePanel: vi.fn(),
  collapsePanelChrome: vi.fn(),
}));

vi.mock("@corvu/resizable", () => {
  type Bag = { children?: JSX.Element } & Record<string, unknown>;
  const Root: Component<Bag> = (props) => <div>{props.children}</div>;
  const Panel: Component<Bag> = (props) => {
    if (typeof props.onExpand === "function") {
      h.onExpand = props.onExpand as () => void;
    }
    return <div>{props.children}</div>;
  };
  const Handle: Component<Bag> = (props) => {
    if (typeof props.onPointerDown === "function") {
      h.onPointerDown = () =>
        (props.onPointerDown as (event: PointerEvent) => void)(
          new PointerEvent("pointerdown"),
        );
    }
    return <div data-testid="resize-handle" />;
  };
  return { default: Object.assign(Root, { Panel, Handle }) };
});

vi.mock(import("@kolu/padi/surface"), async (importOriginal) => ({
  ...(await importOriginal()),
  sleepingArm: () => undefined,
}));

vi.mock("./useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: (id: TerminalId) =>
      id === SUB ? { id, parentId: MAIN } : { id, parentId: null },
    getSubTerminalIds: () => [SUB],
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
    expandPanel: h.expandPanel,
    expandAndFocusPanel: h.expandAndFocusPanel,
    collapsePanel: h.collapsePanel,
    collapsePanelChrome: h.collapsePanelChrome,
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

vi.mock("./Terminal", () => ({ default: () => <div /> }));
vi.mock("./DormantTileBody", () => ({ default: () => <div /> }));
vi.mock("./SubPanelTabBar", () => ({ default: () => <div /> }));

const { default: TerminalContent } = await import("./TerminalContent");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  h.onExpand = undefined;
  h.onPointerDown = undefined;
  vi.clearAllMocks();
});

describe("TerminalContent panel expansion intent", () => {
  it("keeps a controlled expand chrome-only but focuses after a handle gesture", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
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

    expect(h.onExpand).toBeTypeOf("function");
    h.onExpand?.();
    expect(h.expandPanel).toHaveBeenCalledExactlyOnceWith(MAIN);
    expect(h.expandAndFocusPanel).not.toHaveBeenCalled();

    h.onPointerDown?.();
    h.onExpand?.();
    expect(h.expandAndFocusPanel).toHaveBeenCalledExactlyOnceWith(MAIN);
  });
});
