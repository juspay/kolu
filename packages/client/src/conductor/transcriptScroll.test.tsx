// @vitest-environment happy-dom
/** WHETHER THE TRANSCRIPT IS FOLLOWING, and where it opens the second time.
 *
 *  Two claims, one fact. The entry mounts the pane and unmounts it again, so
 *  the scroll container is new on every activation: a reader who was at the end
 *  must come back to the end (not to the top of a long conversation), and a
 *  reader who had scrolled up must come back to what they were reading. And
 *  while the pane IS mounted, the same fact decides whether a new row drags the
 *  view down — because "is the view following" is not a second thing to measure
 *  off the element after the row is drawn, which is what made this stop
 *  following at all.
 *
 *  THE STATE MACHINE, not the pixels: happy-dom lays nothing out, so a width or
 *  a height asserted here would pass against any markup. What IS stated is the
 *  container's three numbers — including a `scrollTop` that CLAMPS the way a
 *  browser's does, since an unclamped one sits past the end of a grown column
 *  and makes a broken follow rule look right. */

import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// A tool card's diffs block drags in the whole code viewer and its Nix-backed
// grammar aliases; no row here is a tool call. Stub it so this file tests the
// scroll container.
vi.mock("./ConductorDiffs", () => ({ default: () => null }));

import ConductorTranscript from "./ConductorTranscript";
import type { ConductorRow } from "kolu-common/conductor";
import { ConductorShown } from "./conductorShown";
import { atEnd, pinTranscript, revealTranscriptRow } from "./transcriptScroll";

/** Is the pane the view being read? The pane is RETAINED across a tab switch,
 *  so the follow rule has to ask — a scroll written into a subtree with no
 *  layout lands on a column of height 0 and clamps to the top, which is the
 *  reader's position thrown away. */
const [shown, setShown] = createSignal(true);

const VIEWPORT = 200;
const COLUMN = 1000;
/** How much taller one appended row makes the column — comfortably more than
 *  `FOLLOW_SLACK_PX`, which is the whole point: a rule that measured the
 *  container after the row was drawn would read this growth as "the reader
 *  scrolled up by 100px". */
const ROW_HEIGHT = 100;

/** The column's current height, which appends GROW. */
let column = COLUMN;

/** Where a container that is at the end has its `scrollTop` — a browser clamps
 *  `scrollTop` to the scrollable range, so "the end" is never `scrollHeight`. */
const endOf = (height: number): number => height - VIEWPORT;

/** The three numbers the follow rule reads, stated on the element itself at ref
 *  time — before any effect has measured it. */
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

/** Plain `notice` rows: this file is about the container, not about what is
 *  drawn in it, and a notice renders without the conductor's context. */
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
      <ConductorShown.Provider value={shown}>
        <ConductorTranscript
          rows={rows()}
          pending={false}
          error={undefined}
          containerRef={(el) => {
            measure(el);
            scroller = el;
          }}
        />
      </ConductorShown.Provider>
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

/** One more row, and the column is one row taller — the arrival this whole
 *  file is about. */
function append(): void {
  column += ROW_HEIGHT;
  setRows?.(makeRows(20 + (column - COLUMN) / ROW_HEIGHT));
}

/** What a reader's wheel does: move the view, and let the container say so. */
function scrollTo(el: HTMLDivElement, top: number): void {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}

/** The way back, as the reader meets it — the terminal's own pill. */
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
    // Scrolled up to read, then back down to the bottom: what is remembered is
    // "at the end", never the pixel — the column is taller next time.
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
    // THE REGRESSION THIS FILE EXISTS FOR: the second append is where a rule
    // that measures the container after drawing gives up — the first row it
    // adds is already more than the slack away from the view it was drawn
    // into, so the reader is declared "scrolled up" about content that landed
    // a frame ago and the conversation runs off the bottom from there.
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

    // A remount is a brand new container: the reader is not following, so it
    // lands where they were AND the pill is up — the state is the memory's,
    // never the fresh element's.
    const second = mount();
    expect(second.scrollTop).toBe(300);
    expect(pill()).not.toBeNull();

    append();
    expect(second.scrollTop).toBe(300);
  });

  it("does not move a pane nobody is looking at, and follows again on the way back", () => {
    // THE RETAINED PANE. Leaving for a host tab keeps this container alive
    // with no layout at all, so rows that arrive while away must not write a
    // scroll into it — and the reader, who was at the end, must find the end
    // again when the conversation is back on screen.
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
        <ConductorShown.Provider value={() => true}>
          <ConductorTranscript
            rows={rows}
            pending={false}
            error={undefined}
            containerRef={(el) => {
              scroller = el;
            }}
          />
        </ConductorShown.Provider>
      ),
      root,
    );
    const fold = scroller.querySelector<HTMLDetailsElement>(
      '[data-testid="conductor-fold"]',
    );
    // Closed, and saying how many it holds.
    expect(fold?.open).toBe(false);
    expect(fold?.getAttribute("data-count")).toBe("2");

    revealTranscriptRow(scroller, "t2");
    expect(fold?.open).toBe(true);
  });
});
