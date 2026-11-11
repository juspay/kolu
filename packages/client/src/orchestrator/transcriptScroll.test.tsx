// @vitest-environment happy-dom
/** Where the conversation opens, and where it opens the SECOND time.
 *
 *  The entry mounts the pane and unmounts it again, so the transcript's scroll
 *  container is new on every activation. These tests state the two things that
 *  must survive that: a reader who was at the end comes back to the end (not to
 *  the top of a long conversation), and a reader who had scrolled up to read
 *  something comes back to what they were reading. */

import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// A tool card's diffs block drags in the whole code viewer and its Nix-backed
// grammar aliases; no row here is a tool call. Stub it so this file tests the
// scroll container.
vi.mock("./OrchestratorDiffs", () => ({ default: () => null }));

import OrchestratorTranscript from "./OrchestratorTranscript";
import type { OrchestratorRow } from "kolu-common/orchestrator";
import {
  atEnd,
  forgetTranscriptScroll,
  transcriptScrollOffset,
} from "./transcriptScroll";

/** happy-dom lays nothing out: `scrollHeight` and `clientHeight` are 0 for
 *  every element, which would make every container trivially "at the end". The
 *  measurements are the contract, so state them — on the element itself, at ref
 *  time, before any effect has measured it. */
function measure(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { value: clientHeight });
}

const COLUMN = 1000;
const VIEWPORT = 200;

/** Plain `notice` rows: this file is about the container, not about what is
 *  drawn in it, and a notice renders without the orchestrator's context. */
const rows: readonly OrchestratorRow[] = Array.from({ length: 20 }, (_, i) => ({
  id: `n${i}`,
  seq: i,
  since: "2026-01-01T00:00:00.000Z",
  kind: "notice",
  text: `line ${i}`,
}));

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

function mount(): HTMLDivElement {
  root = document.createElement("div");
  document.body.append(root);
  let scroller!: HTMLDivElement;
  dispose = render(
    () => (
      <OrchestratorTranscript
        rows={rows}
        pending={false}
        error={undefined}
        containerRef={(el) => {
          measure(el, COLUMN, VIEWPORT);
          scroller = el;
        }}
      />
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
}

/** What a reader's wheel does: move the view, and let the container say so. */
function scrollTo(el: HTMLDivElement, top: number): void {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
}

beforeEach(() => forgetTranscriptScroll());
afterEach(() => {
  unmount();
  forgetTranscriptScroll();
});

describe("the transcript's scroll position", () => {
  it("opens at the END, not at the top", () => {
    expect(mount().scrollTop).toBe(COLUMN);
  });

  it("restores the offset a reader left it at, across a remount", () => {
    const first = mount();
    scrollTo(first, 300);
    expect(transcriptScrollOffset()).toBe(300);
    unmount();

    expect(mount().scrollTop).toBe(300);
  });

  it("lands at the end again when the reader was at the end", () => {
    const first = mount();
    // Scrolled up to read, then back down to the bottom: what is remembered is
    // "at the end", never the pixel — the column is taller next time.
    scrollTo(first, 300);
    scrollTo(first, COLUMN - VIEWPORT);
    expect(transcriptScrollOffset()).toBeNull();
    unmount();

    expect(mount().scrollTop).toBe(COLUMN);
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
