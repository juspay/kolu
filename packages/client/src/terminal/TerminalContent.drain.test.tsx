// @vitest-environment happy-dom

/** A SUPERVISED DRAIN MUST NOT SHUT THE SPLIT.
 *
 *  A kaval recycle empties this host's terminal records without anything
 *  having been closed, and they come back a beat later. While they are gone
 *  `hasSubs()` is false, so `isExpanded()` is false, so the controlled `sizes`
 *  this tile hands Corvu are `[1, 0]` — and Corvu answers that by firing
 *  `onCollapse`. Persisting `collapsed: true` there would LATCH the split shut:
 *  the records return, `hasSubs()` returns, and the saved collapse keeps
 *  `isExpanded()` false for good, so the tab strip the e2e step waits for
 *  (`kaval-daemon.feature:58`) stays inside the `hidden` wrapper.
 *
 *  `handlePanelCollapse`'s `hasSubs()` return is what refuses it — the report
 *  arrives while the records are still gone — and the intent gate beside it
 *  refuses the same thing for a transition that outlives the drain.
 *
 *  The real `@corvu-next/resizable` root, the real split store and the real
 *  `useSubPanel` writers — mocked only at the wire, because the write IS the
 *  subject: a spy on `collapsePanel` would hide the store that performs it.
 *  The mock wire PERSISTS what it is handed, so a collapse written during the
 *  drain is what the restore gives back: the latch, end to end. */

import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";
import type { ITheme } from "@xterm/xterm";
import { Effect } from "effect";
import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal, flush } from "solid-js";
import { render } from "@solidjs/web";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const MAIN = "drain-main" as TerminalId;
const SUB = "drain-sub" as TerminalId;

/** The tile's height in the fake layout — Corvu divides pixel deltas by it. */
const ROOT_PX = 400;

/** What the SERVER holds for this tile's split — what a restore hands back.
 *  A write through `chrome.setSubPanel` lands here, so a collapse persisted
 *  during the drain is what the records say when they return. That is the
 *  latch, end to end. */
const server = { subPanel: { collapsed: false, panelSize: 0.3 } };

const h = vi.hoisted(() => ({ setSubPanel: vi.fn() }));

/** This host's records, as the drain moves them: the split's ids and the
 *  tile's own record both go, and both come back. */
const census = createRoot(() => {
  const [subIds, setSubIds] = createSignal<TerminalId[]>([SUB]);
  const [record, setRecord] = createSignal<
    { subPanel?: { collapsed: boolean; panelSize: number } } | undefined
  >({ ...server });
  return { subIds, setSubIds, record, setRecord };
});

vi.mock("../hostScope/hostScopes", () => ({
  activeScope: () => ({
    wire: {
      terminals: { byKey: () => census.record },
      terminalKeys: () => (census.subIds().length > 0 ? ["drain-main"] : []),
    },
    view: { focusedTerminalId: () => MAIN, writeFocus: vi.fn() },
  }),
}));

vi.mock("../wire", () => ({
  activePadiRpc: {
    chrome: {
      setSubPanel: (input: {
        collapsed: boolean;
        panelSize: number;
      }): Effect.Effect<void> => {
        h.setSubPanel(input);
        server.subPanel = {
          collapsed: input.collapsed,
          panelSize: input.panelSize,
        };
        return Effect.void;
      },
    },
  },
}));

vi.mock("solid-sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock(import("@kolu/padi-client/surface"), async (importOriginal) => ({
  ...(await importOriginal()),
  sleepingArm: () => undefined,
}));

vi.mock("./useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: (id: TerminalId) =>
      census.subIds().length === 0
        ? undefined
        : id === SUB
          ? { id, parentId: MAIN }
          : { id, parentId: null },
    getSplitPaneIds: () => census.subIds(),
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
vi.mock("./SubPanelTabBar", () => ({
  default: () => <div data-testid="sub-panel-tab-bar" />,
}));

const { default: TerminalContent } = await import("./TerminalContent");
const { useSplitPanelState } = await import("./splitPanelState");

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

beforeEach(() => {
  server.subPanel = { collapsed: false, panelSize: 0.3 };
  census.setSubIds([SUB]);
  census.setRecord({ ...server });
  // Corvu measures the root with `offsetHeight` through a ResizeObserver;
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
  useSplitPanelState().forget(MAIN);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  takeSolidDiagnostics();
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
  flush();
}

/** The fraction each panel's `flex-basis` holds — the divider as the user
 *  sees it, which is `isExpanded()` made visible: a shut split is `[1, 0]`. */
function paneFractions(): [number, number] {
  const panels = [
    ...(host?.querySelectorAll("[data-corvu-resizable-panel]") ?? []),
  ] as HTMLElement[];
  expect(panels).toHaveLength(2);
  return panels.map((p) => Number.parseFloat(p.style.flexBasis) / 100) as [
    number,
    number,
  ];
}

/** The wrapper the e2e step's target sits in. `hidden` on it is `display:
 *  none`, so a tab bar inside it is present in the DOM and invisible —
 *  exactly the shape `locator.waitFor({ state: "visible" })` times out on. */
const tabBarWrapper = (): HTMLElement => {
  const bar = host?.querySelector(
    '[data-testid="sub-panel-tab-bar"]',
  ) as HTMLElement | null;
  expect(bar).not.toBeNull();
  return bar?.parentElement as HTMLElement;
};

const tabBarShown = (): boolean => {
  const wrapper = tabBarWrapper();
  return (
    !wrapper.classList.contains("hidden") && !wrapper.hasAttribute("inert")
  );
};

it("keeps the split open through a drain the client did not order", () => {
  mountContent();
  expect(paneFractions()).toEqual([0.7, 0.3]);
  expect(tabBarShown()).toBe(true);

  // The drain: this host's records go, so the split's ids go with them. The
  // tile stays mounted — nothing closed it.
  census.setSubIds([]);
  census.setRecord(undefined);
  flush();
  // The frame Corvu reports the collapse of the controlled `[1, 0]` in, and
  // the one that applies anything that report wrote.
  flush();
  expect(paneFractions()).toEqual([1, 0]);

  // The records come back, the recycle over — carrying whatever the server
  // holds now, which is the whole point: a collapse persisted above returns
  // with them.
  census.setSubIds([SUB]);
  census.setRecord({ ...server });
  flush();
  flush();

  // The split is open again: the divider is back where it was saved, and the
  // tab strip the e2e step waits for is out of the `hidden` wrapper.
  expect(paneFractions()).toEqual([0.7, 0.3]);
  expect(tabBarShown()).toBe(true);
  // Nothing was persisted: no gesture happened, so the collapse Corvu reported
  // for a programmatic transition must have written nothing at all.
  expect(h.setSubPanel).not.toHaveBeenCalled();
  expect(takeSolidDiagnostics()).toEqual([]);
});
