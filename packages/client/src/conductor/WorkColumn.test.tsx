// @vitest-environment happy-dom
/**
 * THE WELCOME IN THE WORKS COLUMN — what it does, not what it says.
 *
 * A new conversation left the wide side of the Conductor saying one bare
 * line. The panel now welcomes whoever has nothing in progress, offers three
 * requests, and they go into the composer's own draft where a person can
 * edit them. These tests hold the behaviour: when it is there, that a press
 * writes that button's own words and sends nothing, and that the `?` opens
 * the manual.
 */

import type { Accessor } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  endWork,
  type NeedsYou,
  openWork,
  type Work,
  type WorkId,
  type WorkRow,
} from "kolu-work";
import { composerText, setComposerText, welcomeAsk } from "./drafts";
import { helpSheet } from "./helpContent";
import { Shown } from "../ui/shown";
import WorkColumn from "./WorkColumn";

const mirror = vi.hoisted(() => ({
  works: (() => []) as Accessor<ReadonlyArray<WorkRow>>,
  needs: (() => []) as Accessor<ReadonlyArray<NeedsYou>>,
}));
vi.mock("./useWorks", () => ({
  useWorks: () => mirror.works,
  useNeedsYou: () => mirror.needs,
}));
vi.mock("./WorkCard", () => ({
  default: (props: { id: WorkId }) => (
    <div data-testid="work-card-stub" data-work={props.id} />
  ),
}));
// The sidebar reads each work's terminals; what these cases hold is the
// board beside it.
vi.mock("./WorkRail", () => ({
  default: () => <nav data-testid="works-rail-stub" />,
}));

const WORK: WorkId = "branch:local/%2Fr/welcome" as WorkId;
const opened = (): Work =>
  openWork({
    key: {
      kind: "branch",
      host: "local",
      repo: "/r",
      branch: "welcome",
      repoBy: { kind: "git" },
    },
    title: "Something in flight",
    at: "2026-11-16T01:00:00.000Z",
    request: { kind: "none" },
  });
const LIVE: ReadonlyArray<WorkRow> = [[WORK, opened()]];
const FINISHED: ReadonlyArray<WorkRow> = [
  [
    WORK,
    endWork(opened(), {
      outcome: { kind: "merged", pr: 7 },
      at: "2026-11-16T02:00:00.000Z",
    }),
  ],
];

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

const examples = (el: HTMLElement): ReadonlyArray<HTMLButtonElement> => [
  ...el.querySelectorAll<HTMLButtonElement>(
    '[data-testid="work-welcome-example"]',
  ),
];

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
  it("welcome is there, with three asks", () => {
    const el = mount([]);

    expect(
      el.querySelector('[data-testid="work-column-empty"]'),
    ).not.toBeNull();
    expect(examples(el)).toHaveLength(3);
  });

  it("stays for a person whose only works have finished", () => {
    // Deliberate: the panel says what the Conductor is for whenever nothing
    // is in progress, not only on the first ever visit.
    const el = mount(FINISHED);
    expect(
      el.querySelector('[data-testid="work-column-empty"]'),
    ).not.toBeNull();
  });

  it("puts an example's own words in the request the composer answers", () => {
    const el = mount([]);
    const second = examples(el)[1];
    expect(second).toBeDefined();
    const words = (second?.textContent ?? "").trim().replace(/^“|”$/g, "");

    second?.click();

    // The works panel cannot write the box (the composer owns it); it
    // publishes this request, and the composer's own test proves it writes
    // the words and puts the caret after them.
    expect(welcomeAsk()?.text).toBe(words);
    expect(composerText()).toBe("");
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
    const el = mount(LIVE);

    expect(el.querySelector('[data-testid="work-column-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="work-card-stub"]')).not.toBeNull();
  });
});
