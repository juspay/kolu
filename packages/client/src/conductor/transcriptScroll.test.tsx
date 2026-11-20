// @vitest-environment happy-dom
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./ConductorDiffs", () => ({ default: () => null }));

import ConductorTranscript from "./ConductorTranscript";
import type { ConductorRow } from "kolu-common/conductor";
import { Shown } from "../ui/shown";
import { atEnd, pinTranscript, revealTranscriptRow } from "./transcriptScroll";
import { turnWorks } from "./turnWorks";

const [shown, setShown] = createSignal(true);

const VIEWPORT = 200;
const COLUMN = 1000;
const ROW_HEIGHT = 100;

let column = COLUMN;

const endOf = (height: number): number => height - VIEWPORT;

function measure(el: HTMLElement): void {
  let top = 0;
  Object.defineProperty(el, "scrollHeight", { get: () => column });
  Object.defineProperty(el, "clientHeight", { get: () => VIEWPORT });
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (want: number) => {
      top = Math.max(0, Math.min(want, endOf(column)));
    },
  });
}

const makeRows = (count: number): readonly ConductorRow[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `n${i}`,
    seq: i,
    since: "2026-01-01T00:00:00.000Z",
    kind: "notice",
    text: `line ${i}`,
  }));

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;
let setRows: ((rows: readonly ConductorRow[]) => void) | undefined;

function mount(): HTMLDivElement {
  root = document.createElement("div");
  document.body.append(root);
  let scroller!: HTMLDivElement;
  const [rows, write] = createSignal(makeRows(20));
  setRows = write;
  dispose = render(
    () => (
      <Shown.Provider value={shown}>
        <ConductorTranscript
          rows={rows()}
          turns={turnWorks(rows(), new Map(), new Map())}
          pending={false}
          error={undefined}
          containerRef={(el) => {
            measure(el);
            scroller = el;
          }}
        />
      </Shown.Provider>
    ),
    root,
  );
  return scroller;
}

function unmount(): void {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  setRows = undefined;
}

function append(): void {
  column += ROW_HEIGHT;
  setRows?.(makeRows(20 + (column - COLUMN) / ROW_HEIGHT));
}

function scrollTo(el: HTMLDivElement, top: number): void {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}

const pill = (): HTMLButtonElement | null =>
  root?.querySelector<HTMLButtonElement>('[data-testid="scroll-to-bottom"]') ??
  null;

beforeEach(() => {
  column = COLUMN;
  setShown(true);
  pinTranscript();
});
afterEach(() => {
  unmount();
  column = COLUMN;
  pinTranscript();
});

describe("the transcript's scroll position", () => {
  it("opens at the END, not at the top", () => {
    expect(mount().scrollTop).toBe(endOf(COLUMN));
  });

  it("restores the offset a reader left it at, across a remount", () => {
    const first = mount();
    scrollTo(first, 300);
    unmount();

    expect(mount().scrollTop).toBe(300);
  });

  it("lands at the end again when the reader was at the end", () => {
    const first = mount();
    scrollTo(first, 300);
    scrollTo(first, endOf(COLUMN));
    unmount();
    column += ROW_HEIGHT;

    expect(mount().scrollTop).toBe(endOf(column));
  });

  it("counts a couple of lines of slack as the end", () => {
    expect(
      atEnd({ scrollTop: 760, scrollHeight: 1000, clientHeight: 200 }),
    ).toBe(true);
    expect(
      atEnd({ scrollTop: 700, scrollHeight: 1000, clientHeight: 200 }),
    ).toBe(false);
  });
});

describe("the transcript's follow rule", () => {
  it("follows every append while the reader is at the end", () => {
    const scroller = mount();
    expect(pill()).toBeNull();

    append();
    expect(scroller.scrollTop).toBe(endOf(column));
    append();
    append();
    expect(scroller.scrollTop).toBe(endOf(column));
    expect(pill()).toBeNull();
  });

  it("leaves a reader who scrolled up exactly where they are", () => {
    const scroller = mount();
    scrollTo(scroller, 300);

    append();
    append();
    expect(scroller.scrollTop).toBe(300);
    expect(pill()).not.toBeNull();
  });

  it("re-pins on the pill, and follows again from there", () => {
    const scroller = mount();
    scrollTo(scroller, 300);
    append();

    pill()?.click();
    expect(scroller.scrollTop).toBe(endOf(column));
    expect(pill()).toBeNull();

    append();
    expect(scroller.scrollTop).toBe(endOf(column));
  });

  it("comes back unpinned, and still offering the way back", () => {
    const first = mount();
    scrollTo(first, 300);
    unmount();

    const second = mount();
    expect(second.scrollTop).toBe(300);
    expect(pill()).not.toBeNull();

    append();
    expect(second.scrollTop).toBe(300);
  });

  it("does not move a pane nobody is looking at, and follows again on the way back", () => {
    const scroller = mount();
    const wasAt = scroller.scrollTop;

    setShown(false);
    append();
    append();
    expect(scroller.scrollTop).toBe(wasAt);

    setShown(true);
    expect(scroller.scrollTop).toBe(endOf(column));
    expect(pill()).toBeNull();
  });
});

describe("the strip's reveal", () => {
  it("opens the fold that holds the row it was asked for", () => {
    root = document.createElement("div");
    document.body.append(root);
    let scroller!: HTMLDivElement;
    const at = (id: string, seq: number) => ({
      id,
      seq,
      since: "2026-01-01T00:00:00.000Z",
    });
    const rows: readonly ConductorRow[] = [
      { ...at("a", 1), kind: "agent", text: "Looking." },
      { ...at("t1", 2), kind: "tool", text: "Bash", status: "completed" },
      { ...at("t2", 3), kind: "tool", text: "Bash", status: "completed" },
      { ...at("b", 4), kind: "agent", text: "Found it." },
    ];
    dispose = render(
      () => (
        <Shown.Provider value={() => true}>
          <ConductorTranscript
            rows={rows}
            turns={turnWorks(rows, new Map(), new Map())}
            pending={false}
            error={undefined}
            containerRef={(el) => {
              scroller = el;
            }}
          />
        </Shown.Provider>
      ),
      root,
    );
    const fold = scroller.querySelector<HTMLDetailsElement>(
      '[data-testid="conductor-fold"]',
    );
    expect(fold?.open).toBe(false);
    expect(fold?.getAttribute("data-count")).toBe("2");

    revealTranscriptRow(scroller, "t2");
    expect(fold?.open).toBe(true);
  });
});
