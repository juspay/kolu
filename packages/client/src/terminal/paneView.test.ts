// @vitest-environment happy-dom

import type { IBufferCell, IBufferLine, Terminal as XTerm } from "@xterm/xterm";
import { createRoot, createSignal } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../canvas/viewport/useCanvasViewport", () => ({
  useCanvasViewport: () => ({ zoom: () => 1 }),
}));

import { type ScanBuffer, scanGrid, trackPaneView } from "./paneView";

const COLS = 20;

/** One screen row from a string: `W` is a wide character (two cells, the
 *  second of width 0), anything else one cell. */
function row(text: string): IBufferLine {
  const cells: { chars: string; width: number }[] = [];
  for (const ch of text) {
    if (ch === "W")
      cells.push({ chars: "漢", width: 2 }, { chars: "", width: 0 });
    else cells.push({ chars: ch, width: 1 });
  }
  return {
    getCell: (col: number) => {
      const c = cells[col] ?? { chars: "", width: 1 };
      return {
        getChars: () => c.chars,
        getWidth: () => c.width,
      } as IBufferCell;
    },
  } as IBufferLine;
}

/** A screen of `lines`, the cursor at (col, row), scrolled back by `back`. */
function screen(
  lines: string[],
  cursor: { col: number; row: number },
  back = 0,
): ScanBuffer {
  const base = 5;
  return {
    baseY: base,
    viewportY: base - back,
    cursorX: cursor.col,
    cursorY: cursor.row,
    getLine: (y: number) => {
      const r = y - (base - back);
      return r >= 0 && r < lines.length ? row(lines[r] ?? "") : undefined;
    },
    getNullCell: () => ({}) as IBufferCell,
  };
}

describe("scanGrid", () => {
  it("counts the empty cells right of the cursor to the edge", () => {
    const g = scanGrid(screen(["", "$ "], { col: 2, row: 1 }), COLS);
    expect(g.cursor).toEqual({ col: 2, row: 1 });
    // cols 3..19
    expect(g.promptRun).toBe(17);
  });

  it("stops one cell short of a right-side prompt", () => {
    //            0123456789012345678
    const line = "$           [main]";
    const g = scanGrid(screen(["", line], { col: 2, row: 1 }), COLS);
    // cols 3..11 are empty, `[` at 12; one short leaves 8
    expect(g.promptRun).toBe(8);
  });

  it("gives no room with the cursor on typed text", () => {
    const g = scanGrid(screen(["", "$ echo hi"], { col: 4, row: 1 }), COLS);
    expect(g.promptRun).toBe(0);
  });

  it("treats a wide character as text, both its halves", () => {
    // `$ ` then a wide char at cols 6–7.
    const g = scanGrid(screen(["", "$     W"], { col: 1, row: 1 }), COLS);
    // cols 2..5 empty, col 6 text; one short leaves 3
    expect(g.promptRun).toBe(3);
    // The cursor on the wide char's second half sits on text.
    const h = scanGrid(screen(["", "$     W"], { col: 7, row: 1 }), COLS);
    expect(h.promptRun).toBe(0);
  });

  it("reads no cursor, and no prompt run, while scrolled back", () => {
    const g = scanGrid(screen(["", "$ "], { col: 2, row: 1 }, 3), COLS);
    expect(g.cursor).toBeNull();
    expect(g.promptRun).toBeNull();
  });

  it("runs the corner leftward from one cell in, short of the row's text", () => {
    // Second row: an 8-char header, then blanks.
    const g = scanGrid(screen(["", "header12"], { col: 0, row: 5 }), COLS);
    // from col 18 leftward to col 8, the header ends at 7: 11 blanks, one short
    expect(g.cornerRun).toBe(10);
  });

  it("gives the whole corner run on an empty second row", () => {
    const g = scanGrid(screen(["", ""], { col: 0, row: 0 }), COLS);
    // cols 18..0
    expect(g.cornerRun).toBe(19);
  });
});

describe("trackPaneView's gate", () => {
  let observers: number;
  let resized: number;
  beforeEach(() => {
    observers = 0;
    resized = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {
          resized++;
        }
        unobserve() {
          resized--;
        }
        disconnect() {
          resized = 0;
        }
      },
    );
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe() {
          observers++;
        }
        disconnect() {
          observers--;
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  function fakeTerm() {
    // Live subscriptions across the four terminal events.
    const live = { size: 0 };
    const event = () => () => {
      live.size++;
      return { dispose: () => live.size-- };
    };
    const element = document.createElement("div");
    element.appendChild(document.createElement("div")).className =
      "xterm-screen";
    const term = {
      element,
      cols: COLS,
      rows: 4,
      buffer: { active: screen(["", ""], { col: 0, row: 0 }) },
      onWriteParsed: event(),
      onCursorMove: event(),
      onResize: event(),
      onScroll: event(),
    } as unknown as XTerm;
    return { term, live };
  }

  it("listens only while enabled, and lets go when it turns false", () => {
    const { term, live } = fakeTerm();
    const [enabled, setEnabled] = createSignal(false);
    // Effects flush only once the root's body returns, so drive the gate
    // from out here.
    const { view, dispose } = createRoot((dispose) => ({
      view: trackPaneView(document.createElement("div"), term, enabled),
      dispose,
    }));
    expect(live.size).toBe(0);
    expect(observers).toBe(0);
    expect(view.grid()).toBeNull();

    setEnabled(true);
    expect(live.size).toBe(4);
    expect(observers).toBe(1);
    // The pane and the screen, whose box follows the font.
    expect(resized).toBe(2);

    setEnabled(false);
    expect(live.size).toBe(0);
    expect(observers).toBe(0);
    expect(resized).toBe(0);
    expect(view.grid()).toBeNull();
    expect(view.onScreen()).toBe(false);

    setEnabled(true);
    expect(live.size).toBe(4);
    dispose();
    expect(live.size).toBe(0);
    expect(observers).toBe(0);
  });

  it("throws on a terminal with no screen element", () => {
    const { term } = fakeTerm();
    (term as { element: HTMLElement }).element = document.createElement("div");
    createRoot((dispose) => {
      expect(() =>
        trackPaneView(document.createElement("div"), term, () => true),
      ).toThrow(/no screen/);
      dispose();
    });
  });
});
