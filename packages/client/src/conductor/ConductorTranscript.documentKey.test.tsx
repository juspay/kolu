// @vitest-environment happy-dom
/**
 * ONE FLUSH, ONE DOCUMENT.
 *
 * The scroller shows two documents — the whole conversation, and the turns
 * about one work — and where the reader is in each belongs to that document.
 * The question every frame asks is "is the view following?", and it must be
 * asked of the document the chat is pointed at NOW: a copy of that key kept
 * beside the scope, written from an effect, answers for the PREVIOUS document
 * for one frame, so the pill and the placement disagree on the frame a scope
 * changes — the pill offering a way back to the end of a chat that is already
 * at its end.
 *
 * So both halves are stated here: the pill and the place agree in the SAME
 * flush as the scope moves, and — because a mirror is also a write of a
 * compute's own output — nothing relays the scope into a second signal, which
 * `@kolu/solid-test-setup` grades for us as the scope is flipped four times.
 */

import type { ConductorRow } from "kolu-common/conductor";
import { openWork, type Work, type WorkId, workIdOf } from "kolu-work";
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const KEY = {
  kind: "branch",
  host: "local",
  repo: "/r",
  branch: "scoped",
  repoBy: { kind: "git" },
} as const;
const ID: WorkId = workIdOf(KEY);

const WORK: Work = openWork({
  key: KEY,
  title: "The work the chat is about",
  at: "2026-11-16T01:00:00.000Z",
  request: { kind: "none" },
});

// A tool card's diffs block drags in the whole code viewer and its Nix-backed
// grammar aliases; no row here is a tool call.
vi.mock("./ConductorDiffs", () => ({ default: () => null }));
vi.mock("./useWorks", () => ({
  useWorkMap: () => () => new Map<WorkId, Work>([[ID, WORK]]),
  useWorkMembers: () => () => new Map(),
  useSeen: () => () => new Map(),
  useAgentNotes: () => () => [],
  useFileHolders: () => () => new Map(),
}));
vi.mock("./useConductor", () => ({
  useConductor: () => ({ answer: vi.fn(), send: vi.fn() }),
}));

import ConductorTranscript from "./ConductorTranscript";
import { Shown } from "../ui/shown";
import { pointChatAt, showAllChat } from "./chatScope";
import { pinTranscript, WHOLE_TRANSCRIPT } from "./transcriptScroll";
import type { Turn } from "./turnWorks";

const VIEWPORT = 200;
/** The whole conversation's column, and the shorter one a work's chat draws. */
const WHOLE_COLUMN = 1000;
const SCOPED_COLUMN = 400;

let column = WHOLE_COLUMN;

const endOf = (height: number): number => height - VIEWPORT;

/** The three numbers the follow rule reads, with a `scrollTop` that CLAMPS the
 *  way a browser's does — happy-dom lays nothing out. */
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

/** Ten turns of the whole conversation; the last three are about the work, so
 *  the scope has rows of its own to show. */
const ROWS: readonly ConductorRow[] = Array.from({ length: 10 }, (_, i) => ({
  id: `n${i}`,
  seq: i,
  since: "2026-01-01T00:00:00.000Z",
  kind: "notice",
  text: `line ${i}`,
}));

const TURNS: ReadonlyMap<string, Turn> = new Map(
  ROWS.map((row, i) => [
    row.id,
    { head: row.id, works: i >= 7 ? [ID] : [] } satisfies Turn,
  ]),
);

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

function mount(): HTMLDivElement {
  root = document.createElement("div");
  document.body.append(root);
  let scroller!: HTMLDivElement;
  dispose = render(
    () => (
      <Shown value={() => true}>
        <ConductorTranscript
          rows={ROWS}
          turns={TURNS}
          pending={false}
          error={undefined}
          containerRef={(el) => {
            measure(el);
            scroller = el;
          }}
        />
      </Shown>
    ),
    root,
  );
  return scroller;
}

/** The way back, as the reader meets it. */
const pill = (): HTMLButtonElement | null =>
  root?.querySelector<HTMLButtonElement>('[data-testid="scroll-to-bottom"]') ??
  null;

/** What a reader's wheel does: move the view, and let the container say so. */
function scrollTo(el: HTMLDivElement, top: number): void {
  el.scrollTop = top;
  el.dispatchEvent(new Event("scroll"));
  flush();
}

beforeEach(() => {
  column = WHOLE_COLUMN;
  showAllChat();
  pinTranscript(WHOLE_TRANSCRIPT);
  pinTranscript(ID);
  flush();
});

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  showAllChat();
  column = WHOLE_COLUMN;
});

describe("the document the scroller's place belongs to", () => {
  it("answers for the document the chat is pointed at in the same flush", () => {
    const scroller = mount();
    // The reader scrolls up in the whole conversation: that document is no
    // longer following, and the way back is offered.
    scrollTo(scroller, 300);
    expect(pill()).not.toBeNull();

    // Point the chat at the work. Its chat has never been scrolled, so it
    // opens at its newest line — and the pill is about THAT document.
    column = SCOPED_COLUMN;
    pointChatAt(ID);
    flush();
    expect(scroller.scrollTop).toBe(endOf(SCOPED_COLUMN));
    expect(pill()).toBeNull();

    // And back: the whole conversation is still where the reader left it.
    column = WHOLE_COLUMN;
    showAllChat();
    flush();
    expect(scroller.scrollTop).toBe(300);
    expect(pill()).not.toBeNull();
  });

  it("relays the scope into no second fact, over four scope changes", () => {
    const scroller = mount();
    scrollTo(scroller, 300);

    for (const _ of [0, 1, 2, 3]) {
      column = SCOPED_COLUMN;
      pointChatAt(ID);
      flush();
      expect(pill()).toBeNull();

      column = WHOLE_COLUMN;
      showAllChat();
      flush();
      expect(pill()).not.toBeNull();
    }
    // `@kolu/solid-test-setup`'s `afterEach` is the other assertion: a mirror
    // written from an effect is a relay tear by the third sighting.
  });
});
