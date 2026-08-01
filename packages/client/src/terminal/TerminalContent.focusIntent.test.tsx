// @vitest-environment happy-dom

import type { ITheme } from "@xterm/xterm";
import type { TerminalId } from "kolu-common/surface";
import type { Component, JSX } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";

const MAIN = "focus-intent-main" as TerminalId;
const SUB = "focus-intent-sub" as TerminalId;

const h = vi.hoisted(() => ({
  onExpand: undefined as (() => void) | undefined,
  onCollapse: undefined as (() => void) | undefined,
  onHandleDragStart: undefined as (() => void) | undefined,
  onHandleDragEnd: undefined as (() => void) | undefined,
  onPointerCancel: undefined as (() => void) | undefined,
  onLostPointerCapture: undefined as (() => void) | undefined,
  onKeyDown: undefined as ((key: string) => void) | undefined,
  onBlur: undefined as (() => void) | undefined,
  expandPanel: vi.fn(),
  expandAndFocusPanel: vi.fn(),
  collapsePanel: vi.fn(),
  collapsePanelChrome: vi.fn(),
  focusMainPane: vi.fn(),
  focusVisibleSubPane: vi.fn(),
}));

vi.mock("@corvu/resizable", () => {
  type Bag = { children?: JSX.Element } & Record<string, unknown>;
  const Root: Component<Bag> = (props) => <div>{props.children}</div>;
  const Panel: Component<Bag> = (props) => {
    if (typeof props.onExpand === "function") {
      h.onExpand = props.onExpand as () => void;
    }
    if (typeof props.onCollapse === "function") {
      h.onCollapse = props.onCollapse as () => void;
    }
    return <div>{props.children}</div>;
  };
  const Handle: Component<Bag> = (props) => {
    if (typeof props.onHandleDragStart === "function") {
      h.onHandleDragStart = () =>
        (props.onHandleDragStart as (event: PointerEvent) => void)(
          new PointerEvent("pointerdown"),
        );
    }
    if (typeof props.onHandleDragEnd === "function") {
      h.onHandleDragEnd = () =>
        (props.onHandleDragEnd as (event: PointerEvent) => void)(
          new PointerEvent("pointerup"),
        );
    }
    if (typeof props.onPointerCancel === "function") {
      h.onPointerCancel = () =>
        (props.onPointerCancel as (event: PointerEvent) => void)(
          new PointerEvent("pointercancel"),
        );
    }
    if (typeof props.onLostPointerCapture === "function") {
      h.onLostPointerCapture = () =>
        (props.onLostPointerCapture as (event: PointerEvent) => void)(
          new PointerEvent("lostpointercapture"),
        );
    }
    if (typeof props.onKeyDown === "function") {
      h.onKeyDown = (key) =>
        (props.onKeyDown as (event: KeyboardEvent) => void)(
          new KeyboardEvent("keydown", { key }),
        );
    }
    if (typeof props.onBlur === "function") {
      h.onBlur = () =>
        (props.onBlur as (event: FocusEvent) => void)(new FocusEvent("blur"));
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
    expandPanel: h.expandPanel,
    expandAndFocusPanel: h.expandAndFocusPanel,
    collapsePanel: h.collapsePanel,
    collapsePanelChrome: h.collapsePanelChrome,
    selectSubTab: vi.fn(),
    focusMainPane: h.focusMainPane,
    focusVisibleSubPane: h.focusVisibleSubPane,
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
  default: (props: { isSub?: boolean; onFocus?: () => void }) => (
    <button
      type="button"
      data-testid={props.isSub ? "sub-terminal" : "main-terminal"}
      onPointerDown={props.onFocus}
    />
  ),
}));
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
  h.onCollapse = undefined;
  h.onHandleDragStart = undefined;
  h.onHandleDragEnd = undefined;
  h.onPointerCancel = undefined;
  h.onLostPointerCapture = undefined;
  h.onKeyDown = undefined;
  h.onBlur = undefined;
  vi.clearAllMocks();
});

describe("TerminalContent panel expansion intent", () => {
  function mountContent(): void {
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
  }

  it("ignores controlled transitions but focuses after a handle gesture", () => {
    mountContent();

    expect(h.onExpand).toBeTypeOf("function");
    h.onExpand?.();
    h.onCollapse?.();
    expect(h.expandPanel).not.toHaveBeenCalled();
    expect(h.collapsePanel).not.toHaveBeenCalled();
    expect(h.expandAndFocusPanel).not.toHaveBeenCalled();

    h.onHandleDragStart?.();
    h.onCollapse?.();
    expect(h.collapsePanel).toHaveBeenCalledExactlyOnceWith(MAIN);
    h.onExpand?.();
    expect(h.expandAndFocusPanel).toHaveBeenCalledExactlyOnceWith(MAIN);
  });

  it("clears pointer intent when the resize gesture is cancelled", () => {
    mountContent();

    h.onHandleDragStart?.();
    h.onPointerCancel?.();
    h.onExpand?.();

    expect(h.expandPanel).not.toHaveBeenCalled();
    expect(h.expandAndFocusPanel).not.toHaveBeenCalled();
    expect(h.onHandleDragEnd).toBeTypeOf("function");
    expect(h.onLostPointerCapture).toBeTypeOf("function");
  });

  it("does not treat keyboard navigation as resize intent", () => {
    mountContent();

    h.onKeyDown?.("Tab");
    h.onExpand?.();
    expect(h.expandPanel).not.toHaveBeenCalled();

    h.onKeyDown?.("ArrowRight");
    h.onBlur?.();
    h.onExpand?.();
    expect(h.expandPanel).not.toHaveBeenCalled();
    expect(h.expandAndFocusPanel).not.toHaveBeenCalled();
  });

  it("treats Corvu's Enter toggle as explicit resize intent", () => {
    mountContent();

    h.onKeyDown?.("Enter");
    h.onExpand?.();

    expect(h.expandAndFocusPanel).toHaveBeenCalledExactlyOnceWith(MAIN);
  });

  it("commits the exact pane entered by the pointer", () => {
    mountContent();

    const enter = (selector: string) =>
      (host?.querySelector(selector) as HTMLElement).dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true }),
      );

    enter('[data-testid="main-terminal"]');
    expect(h.focusMainPane).toHaveBeenCalledExactlyOnceWith(MAIN);

    enter('[data-testid="sub-terminal"]');
    expect(h.focusVisibleSubPane).toHaveBeenCalledExactlyOnceWith(MAIN, SUB);
  });
});
