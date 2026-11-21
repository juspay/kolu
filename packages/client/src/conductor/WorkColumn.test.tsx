// @vitest-environment happy-dom
/**
 * THE WELCOME IN THE WORKS COLUMN.
 *
 * A new conversation used to leave the wide side of the Conductor saying one
 * bare line, "Nothing in progress." — true, and useless to somebody who had
 * never seen a piece of work appear there. The panel now says what the
 * Conductor is for and offers three requests to start from, and all of it is
 * shown ONLY while nothing is in progress: the moment one work exists the
 * welcome is gone and the list speaks.
 *
 * The example asks write into the composer's OWN draft (`drafts.ts`) — the
 * same signal the box is bound to, so pressing one is not a message and
 * cannot become one. These tests hold that: the draft carries the words, and
 * no send exists on this path at all.
 */

import { type Accessor } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openWork,
  type NeedsYou,
  type Work,
  type WorkId,
  type WorkRow,
} from "kolu-work";
import {
  askFromWelcome,
  composerText,
  holdComposerBox,
  releaseComposerBox,
  setComposerText,
} from "./drafts";
import { helpSheet } from "./helpContent";
import { Shown } from "../ui/shown";
import WorkColumn from "./WorkColumn";

/** The works mirror is the one thing the test controls; everything below it —
 *  the groups, the empty reading, the welcome — is the real code. */
const mirror = vi.hoisted(() => ({
  works: (() => []) as Accessor<ReadonlyArray<WorkRow>>,
  needs: (() => []) as Accessor<ReadonlyArray<NeedsYou>>,
}));
vi.mock("./useWorks", () => ({
  useWorks: () => mirror.works,
  useNeedsYou: () => mirror.needs,
}));

/** The card drags in the code viewer and every reading a work has; none of
 *  that is what this file is about. The column draws it, the test names it. */
vi.mock("./WorkCard", () => ({
  default: (props: { id: WorkId }) => (
    <div data-testid="work-card-stub" data-work={props.id} />
  ),
}));

const WORK: WorkId = "branch:local/%2Fr/welcome" as WorkId;
const open = (): Work =>
  openWork({
    key: { kind: "branch", host: "local", repo: "/r", branch: "welcome" },
    title: "Something in flight",
    at: "2026-11-16T01:00:00.000Z",
    request: { kind: "none" },
  });
const ROWS: ReadonlyArray<WorkRow> = [[WORK, open()]];

let dispose: (() => void) | undefined;
let root: HTMLElement | undefined;

function mount(works: ReadonlyArray<WorkRow>): HTMLElement {
  mirror.works = () => works;
  mirror.needs = () => [];
  root = document.createElement("div");
  document.body.append(root);
  dispose = render(
    () => (
      <Shown.Provider value={() => true}>
        <WorkColumn />
      </Shown.Provider>
    ),
    root,
  );
  return root;
}

const example = (el: HTMLElement, index: number): HTMLButtonElement => {
  const found = el.querySelectorAll<HTMLButtonElement>(
    '[data-testid="work-welcome-example"]',
  );
  const one = found[index];
  if (one === undefined) throw new Error(`no example at ${index}`);
  return one;
};

afterEach(() => {
  dispose?.();
  root?.remove();
  dispose = undefined;
  root = undefined;
  mirror.works = () => [];
  mirror.needs = () => [];
  setComposerText("");
  helpSheet.close();
});

describe("the works column with nothing in progress", () => {
  it("says what the panel is for, and offers asks to start from", () => {
    const el = mount([]);

    const welcome = el.querySelector('[data-testid="work-column-empty"]');
    expect(welcome).not.toBeNull();
    expect(welcome?.textContent).toContain("Nothing in progress");
    expect(welcome?.textContent).toContain(
      "The Conductor runs coding agents for you.",
    );
    expect(welcome?.textContent).toContain("Try asking");

    const asks = el.querySelectorAll('[data-testid="work-welcome-example"]');
    expect(asks).toHaveLength(3);
    expect(asks[0]?.textContent).toContain(
      "Fix the failing test in ~/code/myrepo on this machine and open a PR",
    );
    expect(asks[1]?.textContent).toContain(
      "Plan and build a dark mode toggle for ~/code/myapp",
    );
    expect(asks[2]?.textContent).toContain(
      "Watch the terminal I have open and tell me when it finishes",
    );
    // The way into the manual the header's `?` opens.
    expect(welcome?.textContent).toContain("Press");
    expect(welcome?.textContent).toContain("for how the Conductor works.");
  });

  it("puts an example in the composer's draft, and sends nothing", () => {
    const el = mount([]);

    example(el, 1).click();

    expect(composerText()).toBe(
      "Plan and build a dark mode toggle for ~/code/myapp",
    );
    // The draft still holds the words: nothing on this path submits, so the
    // message a person was offered is still theirs to edit or to discard.
    expect(composerText().length).toBeGreaterThan(0);
  });

  it("opens the help from the ? beside the line", () => {
    const el = mount([]);
    expect(helpSheet.open()).toBe(false);

    el.querySelector<HTMLButtonElement>(
      '[data-testid="work-welcome-help"]',
    )?.click();

    expect(helpSheet.open()).toBe(true);
  });
});

describe("the works column with a work in progress", () => {
  it("draws the work, and not the welcome", () => {
    const el = mount(ROWS);

    expect(el.querySelector('[data-testid="work-column-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="work-card-stub"]')).not.toBeNull();
    expect(el.textContent).toContain("In progress · 1");
  });
});

describe("an example ask and the box it lands in", () => {
  it("takes the box's caret to the end of the words it set", () => {
    // The composer registers its own box this way (`ConductorComposer`); the
    // one thing the welcome needs from it is focus and a caret after the text.
    const box = document.createElement("textarea");
    document.body.append(box);
    holdComposerBox(box);

    askFromWelcome("watch the terminal");

    expect(composerText()).toBe("watch the terminal");
    expect(document.activeElement).toBe(box);
    box.remove();
    releaseComposerBox(box);
  });
});
