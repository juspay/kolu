// @vitest-environment happy-dom

/** DRAGGING THE DIVIDER RESIZES THE SPLIT.
 *
 *  The real `@corvu-next/resizable` root, the real handle, the real split store —
 *  mocked only at the wire. Corvu's `sizes` are CONTROLLED here, so a drag only
 *  moves the divider if this component turns Corvu's report back into the value
 *  it hands Corvu. A test that mocks `Resizable` cannot see that loop at all,
 *  which is why this one does not.
 */

import type { ITheme } from "@xterm/xterm";
import { Deferred } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MAIN = "resize-main" as TerminalId;
const SUB = "resize-sub" as TerminalId;

/** The tile's height in the fake layout — Corvu divides pixel deltas by it. */
const ROOT_PX = 400;

const h = vi.hoisted(() => ({
  pendingWrites: [] as Array<Deferred.Deferred<void, Error>>,
  setSubPanel: vi.fn(),
  toastError: vi.fn(),
  writeFocus: vi.fn(),
}));

h.setSubPanel.mockImplementation(() => {
  const gate = Deferred.makeUnsafe<void, Error>();
  h.pendingWrites.push(gate);
  return Deferred.await(gate);
});

/** The terminal's own record, as the active host's collection holds it. */
const record = createRoot(() => {
  const [value, setValue] = createSignal<
    { subPanel?: { collapsed: boolean; panelSize: number } } | undefined
  >({ subPanel: { collapsed: false, panelSize: 0.3 } });
  return { value, setValue };
});

vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => ({
    wire: { terminals: { byKey: () => record.value } },
    view: { focusedTerminalId: () => MAIN, writeFocus: h.writeFocus },
  }),
}));

vi.mock("../wire", () => ({
  activePadiRpc: { chrome: { setSubPanel: h.setSubPanel } },
}));

vi.mock("solid-sonner", () => ({ toast: { error: h.toastError } }));

vi.mock(import("@kolu/padi-client/surface"), async (importOriginal) => ({
  ...(await importOriginal()),
  sleepingArm: () => undefined,
}));

vi.mock("./useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: (id: TerminalId) =>
      id === SUB ? { id, parentId: MAIN } : { id, parentId: null },
    getSplitPaneIds: () => [SUB],
    focusedTerminalId: () => MAIN,
    recordPhases: () => ({ awaited: 0, parked: 0, live: 2 }),
    activeMeta: () => null,
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
vi.mock("./DormantTileBody", () => ({ default: () => <div /> }));
vi.mock("./SubPanelTabBar", () => ({ default: () => <div /> }));

const { default: TerminalContent } = await import("./TerminalContent");
const { useSplitPanelState } = await import("./splitPanelState");
const { useSubPanel } = await import("./useSubPanel");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  record.setValue({ subPanel: { collapsed: false, panelSize: 0.3 } });
  h.pendingWrites.length = 0;
  // Corvu measures the root with `offsetHeight` through a ResizeObserver.
  // happy-dom lays nothing out, so the tile is given a height by hand.
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
    configurable: true,
    get: () => ROOT_PX,
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  dispose?.();
  host?.remove();
  dispose = undefined;
  host = undefined;
  // The split store is a shared root for the whole module, so a test's
  // in-flight entry would otherwise be the next test's starting divider.
  useSplitPanelState().forget(MAIN);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mountContent(): void {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(
    () => (
      <TerminalContent
        terminalId={MAIN}
        visible
        boxDecided
        viewShown
        focused
        theme={{} as ITheme}
        onCloseTerminal={() => {}}
      />
    ),
    host,
  );
}

const handle = (): HTMLElement =>
  host?.querySelector('[data-testid="resize-handle"]') as HTMLElement;

/** The fraction each panel's `flex-basis` actually holds — the divider's
 *  position as the user sees it, not as the store believes it. */
function paneFractions(): [number, number] {
  const panels = [
    ...(host?.querySelectorAll("[data-corvu-resizable-panel]") ?? []),
  ] as HTMLElement[];
  expect(panels).toHaveLength(2);
  // Corvu writes `flex-basis: 70%`.
  return panels.map((p) => Number.parseFloat(p.style.flexBasis) / 100) as [
    number,
    number,
  ];
}

/** Press the divider, move the pointer by `dy` pixels, release. */
function dragHandleBy(dy: number): void {
  const el = handle();
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
  el.dispatchEvent(
    new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }),
  );
  window.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, clientX: 0, clientY: dy }),
  );
  window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
}

/** Every size this document asked the server to save, in order. */
const savedSizes = (): number[] =>
  h.setSubPanel.mock.calls.map(
    (call) => (call[0] as { panelSize: number }).panelSize,
  );

/** The last whole split state this document asked the server to save. */
const lastSaved = (): { collapsed: boolean; panelSize: number } | undefined =>
  h.setSubPanel.mock.calls.at(-1)?.[0] as
    | { collapsed: boolean; panelSize: number }
    | undefined;

describe("dragging the split divider", () => {
  it("moves the divider, and saves where it was dragged to", () => {
    mountContent();
    expect(paneFractions()).toEqual([0.7, 0.3]);

    // Drag the divider UP by a tenth of the tile: the sub pane grows to 0.4.
    dragHandleBy(-ROOT_PX * 0.1);

    expect(paneFractions()).toEqual([0.6, 0.4]);
    expect(savedSizes().at(-1)).toBeCloseTo(0.4, 5);
  });

  it("keeps the divider where the drag left it once the record echoes", () => {
    mountContent();
    dragHandleBy(-ROOT_PX * 0.1);
    record.setValue({ subPanel: { collapsed: false, panelSize: 0.4 } });

    expect(paneFractions()).toEqual([0.6, 0.4]);
  });

  it("moves the divider with the keyboard too", () => {
    mountContent();
    handle().focus();
    handle().dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    );

    // Corvu's default keyboard delta is 0.1 of the root, toward the sub pane.
    const [, sub] = paneFractions();
    expect(sub).toBeCloseTo(0.2, 5);
    expect(savedSizes().at(-1)).toBeCloseTo(0.2, 5);
  });

  it("writes nothing when nobody touched the divider", () => {
    mountContent();
    record.setValue({ subPanel: { collapsed: false, panelSize: 0.45 } });

    expect(paneFractions()).toEqual([0.55, 0.45]);
    expect(h.setSubPanel).not.toHaveBeenCalled();
  });

  it("mounts a COLLAPSED split without writing it open", () => {
    // kolu#2362's second defect: the first mount after a collapse used to
    // persist the sizes its own programmatic transition produced, and the
    // collapse was gone for good. Nothing here is latched — the record is the
    // source, so Corvu is handed the collapse and echoes it straight back.
    record.setValue({ subPanel: { collapsed: true, panelSize: 0.3 } });
    mountContent();

    expect(paneFractions()).toEqual([1, 0]);
    expect(h.setSubPanel).not.toHaveBeenCalled();
  });

  it("never saves a zero divider from a drag to the bottom", () => {
    mountContent();

    // Corvu reports `[1, 0]` while a panel is on its way to collapsed. The
    // divider's saved position must survive that — it is where the split
    // reopens to.
    dragHandleBy(ROOT_PX * 0.4);

    expect(savedSizes()).not.toContain(0);
    expect(lastSaved()?.panelSize ?? 0.3).toBeGreaterThan(0.02);
  });

  it("collapses and reopens from the command palette's toggle", () => {
    mountContent();
    const panel = useSubPanel();

    panel.togglePanel(MAIN);
    expect(paneFractions()).toEqual([1, 0]);
    expect(lastSaved()).toMatchObject({ collapsed: true, panelSize: 0.3 });

    panel.togglePanel(MAIN);
    expect(paneFractions()).toEqual([0.7, 0.3]);
    expect(lastSaved()).toMatchObject({ collapsed: false, panelSize: 0.3 });
  });
});
