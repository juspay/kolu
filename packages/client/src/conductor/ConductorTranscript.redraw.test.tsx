// @vitest-environment happy-dom
/**
 * OPENING A FILE FROM THE PROSE MOVES THE TRANSCRIPT ONCE.
 *
 * Opening the reader writes ONE fact (`reader/useReader.ts`'s target) and two
 * things read it in the same flush: the pane's `chatShown` (a phone puts the
 * conversation aside behind a file — `conductorFrame.ts`), which is a
 * dependency of the transcript's follow effect; and every file link in the
 * prose, which reads it to say whether it is the open one. The second of
 * those rewrites the prose's HTML, and `@kolu/solid-markdown` reports that
 * rewrite from a USER effect — so the redraw note lands on the transcript's
 * follow effect after it has already run for this flush. Written inline, that
 * is a relay tear against a victim that is mid-frame; settled, it is a write
 * of its own in a later pass of the same flush, which is what a gesture's
 * write is.
 *
 * So the package runs FOR REAL here: the write under judgement is the one the
 * package's effect makes, and a scripted `Markdown` is a different write. The
 * prose is one paragraph with one code span — no list and no raw HTML — which
 * is what DOMPurify renders faithfully under happy-dom (`ConductorProse.test`
 * explains why a list does not).
 */

import type { ConductorRow } from "kolu-common/conductor";
import { openWork, type Work, type WorkId, workIdOf } from "kolu-work";
import { render } from "@solidjs/web";
import { flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { takeSolidDiagnostics } from "@kolu/solid-test-setup/setup";

const KEY = {
  kind: "branch",
  host: "local",
  repo: "/r",
  branch: "planned",
  repoBy: { kind: "git" },
} as const;
const ID: WorkId = workIdOf(KEY);
const PATH = ".waterfall/plan.md";

const WORK: Work = openWork({
  key: KEY,
  title: "The work that wrote the plan",
  at: "2026-11-16T01:00:00.000Z",
  request: { kind: "none" },
});

// A tool card's diffs block drags in the whole code viewer and its Nix-backed
// grammar aliases; the one row here is prose.
vi.mock("./ConductorDiffs", () => ({ default: () => null }));
vi.mock("./useWorks", () => ({
  useWorkMap: () => () => new Map<WorkId, Work>([[ID, WORK]]),
  useWorkMembers: () => () => new Map(),
  useSeen: () => () => new Map(),
  useAgentNotes: () => () => [],
  useFileHolders: () => () => new Map([[PATH, [ID]]]),
}));
vi.mock("./useConductor", () => ({
  useConductor: () => ({ answer: vi.fn(), send: vi.fn() }),
}));

import ConductorTranscript from "./ConductorTranscript";
import { Shown } from "../ui/shown";
import { showAllChat } from "./chatScope";
import { chatPutAside } from "./conductorFrame";
import { closeReader, openReader, readerTarget } from "./reader/useReader";
import { pinTranscript, WHOLE_TRANSCRIPT } from "./transcriptScroll";
import type { Turn } from "./turnWorks";

const VIEWPORT = 200;
const COLUMN = 1000;
/** How much taller the prose stands once the package has marked a link as the
 *  open file. */
const GROWTH = 120;

/** The column's height, as a browser laying this prose out would report it:
 *  the rewrite the note is about puts a marker in the paragraph, and the
 *  paragraph grows. Read off the DOM the package wrote rather than off the
 *  gesture, so nothing here grows a column the package did not redraw — the
 *  same stand-in for happy-dom's missing layout as the clamping `scrollTop`
 *  below. */
const columnHeight = (): number =>
  COLUMN + (root?.querySelector("[aria-current]") == null ? 0 : GROWTH);

/** The three numbers the follow rule reads, with a `scrollTop` that CLAMPS
 *  the way a browser's does — happy-dom lays nothing out. */
function measure(el: HTMLElement): void {
  let top = 0;
  Object.defineProperty(el, "scrollHeight", { get: columnHeight });
  Object.defineProperty(el, "clientHeight", { get: () => VIEWPORT });
  Object.defineProperty(el, "scrollTop", {
    get: () => top,
    set: (want: number) => {
      top = Math.max(0, Math.min(want, columnHeight() - VIEWPORT));
    },
  });
}

const ROWS: readonly ConductorRow[] = [
  {
    id: "a1",
    seq: 1,
    since: "2026-01-01T00:00:00.000Z",
    kind: "agent",
    text: `the plan is at \`${PATH}\` now`,
  },
];

const TURNS: ReadonlyMap<string, Turn> = new Map([
  ["a1", { head: "a1", works: [ID] } satisfies Turn],
]);

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

/** The pane's own reading of whether the conversation is being looked at
 *  (`ConductorPane.tsx`'s `chatShown`), on a phone — where a file open in the
 *  reader is what takes the chat's place. A DESKTOP's reader opens in its own
 *  pane and the chat keeps its own, so that shape is a plain `() => true`:
 *  nothing about the gesture reaches the transcript except the prose it
 *  rewrites, which is the frame the note has to move the view in. */
const chatShownOnPhone = (): boolean =>
  !chatPutAside({
    phone: true,
    view: "chat",
    reading: readerTarget() !== null,
    filled: false,
  });

function mount(shown: () => boolean): HTMLElement {
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <Shown value={shown}>
        <ConductorTranscript
          rows={ROWS}
          turns={TURNS}
          pending={false}
          error={undefined}
          containerRef={measure}
        />
      </Shown>
    ),
    root,
  );
  return root;
}

const scrollerOf = (host: HTMLElement): HTMLElement => {
  const el = host.querySelector<HTMLElement>(
    '[data-testid="conductor-transcript"]',
  );
  if (el === null) throw new Error("the transcript rendered no scroller");
  return el;
};

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  closeReader();
  showAllChat();
  pinTranscript(WHOLE_TRANSCRIPT);
  flush();
});

describe("a file opened from the prose", () => {
  it("notes the redraw without tearing the follow effect", () => {
    const host = mount(chatShownOnPhone);
    flush();
    const link = host.querySelector(
      '[data-testid="conductor-transcript"] code',
    );
    expect(link?.textContent).toBe(PATH);
    // The mount's own frame is not the subject.
    takeSolidDiagnostics();

    // The gesture: the reader opens on the file this reply named.
    openReader({ work: ID, path: PATH });
    flush();

    // The link now reads as the open one — so the package DID rewrite the
    // prose in this flush, which is the rewrite the note is about.
    expect(
      host.querySelector('[data-testid="conductor-transcript"] [aria-current]'),
    ).not.toBeNull();
    // EMPTY, advisories included: a relay tear fails here at its first
    // sighting rather than at the judge's third.
    expect(takeSolidDiagnostics()).toEqual([]);
  });

  it("moves a follower's view in the frame the prose landed in", () => {
    // WHAT THE NOTE IS FOR, beside the tear it must not cause: the rewrite
    // grows the column under a view nobody moved, and no row arrived to say
    // so — the note is the follow effect's ONLY word that the document it
    // holds a follower in is taller than it was. The reader opens in its own
    // pane here, so nothing else about the gesture reaches this effect: the
    // rows, the works, the pin and the shown fact all stand still.
    const host = mount(() => true);
    flush();
    const scroller = scrollerOf(host);
    // The mount put the reader at the end: this conversation has no
    // remembered place, and no place IS following.
    expect(scroller.scrollTop).toBe(COLUMN - VIEWPORT);
    takeSolidDiagnostics();

    openReader({ work: ID, path: PATH });
    flush();

    expect(
      host.querySelector('[data-testid="conductor-transcript"] [aria-current]'),
    ).not.toBeNull();
    // The follower is at the NEW end, in the flush the prose landed in.
    expect(scroller.scrollTop).toBe(COLUMN + GROWTH - VIEWPORT);
    expect(takeSolidDiagnostics()).toEqual([]);
  });
});
