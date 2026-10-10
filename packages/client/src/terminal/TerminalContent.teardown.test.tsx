// @vitest-environment happy-dom

import type { ITheme } from "@xterm/xterm";
import type { TerminalId } from "kolu-common/surface";
import { createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { expect, it, vi } from "vitest";

const MAIN = "teardown-main" as TerminalId;
const SUB = "teardown-sub" as TerminalId;

// Counts every read of the host's split state. The real Corvu Resizable stays
// in: its Panel cleanup is the teardown path under test.
const reads = vi.hoisted(() => ({ splitState: 0 }));

vi.mock(import("@kolu/padi-client/surface"), async (importOriginal) => ({
  ...(await importOriginal()),
  sleepingArm: () => undefined,
}));

vi.mock("./useTerminalStore", () => ({
  useTerminalStore: () => ({
    getMetadata: (id: TerminalId) =>
      id === SUB ? { id, parentId: MAIN } : { id, parentId: null },
    getSplitPaneIds: () => {
      reads.splitState++;
      return [SUB];
    },
    focusedTerminalId: () => MAIN,
    activeMeta: () => null,
  }),
}));

vi.mock("./useSubPanel", () => ({
  useSubPanel: () => ({
    peekSubPanel: () => {
      reads.splitState++;
      return {
        collapsed: false,
        panelSize: 0.3,
        activeSubTab: SUB,
        refocusNonce: 0,
      };
    },
    setPanelSize: vi.fn(),
    expandPanel: vi.fn(),
    expandAndFocusPanel: vi.fn(),
    collapsePanel: vi.fn(),
    collapsePanelChrome: vi.fn(),
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

it("tears down without reading the host's split state", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const [mounted, setMounted] = createSignal(true);
  const dispose = render(
    () => (
      <Show when={mounted()}>
        <TerminalContent
          terminalId={MAIN}
          visible
          focused
          theme={{} as ITheme}
          onCloseTerminal={vi.fn()}
        />
      </Show>
    ),
    host,
  );
  reads.splitState = 0;
  // The failure this stands in for: clicking a host tab threw
  // `TypeError: Cannot read properties of null` inside Solid's `cleanNode` and
  // aborted the update, so the incoming host's tiles never rendered. Corvu's
  // Resizable.Panel unregisters in onCleanup and re-reads the controlled
  // `sizes` there; on a host switch the split state behind it is a memo still
  // pending in the flush doing the teardown, and resolving that pending read
  // re-runs owners that are mid-disposal, so one is cleaned twice.
  //
  // The contract is deliberately STRONGER than "nothing throws": teardown
  // reads the split state ZERO times. Zero reads ⇒ no pending memo is touched
  // ⇒ no upstream flush ⇒ no re-entrant dispose, whatever the flush happens to
  // hold. A mock store can't reproduce which memos are pending on a real host
  // switch, so "reads are fine as long as nothing throws" would pass here and
  // still crash in the app. Do not weaken this to a no-throw check.
  //
  // Unmount inside a reactive update, as every app teardown is.
  setMounted(false);
  expect(reads.splitState).toBe(0);
  dispose();
  host.remove();
});
