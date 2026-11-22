/** A PICKED WORK'S CODE VIEW — step definitions.
 *
 *  The view is the Right panel's Code tab, so its parts carry the same
 *  testids; every selector here is scoped to the work's view
 *  (`[data-testid="work-code"]`) so a step never reads the Right panel's own
 *  Code tab, which stays mounted behind the Conductor — and the steps that
 *  read the Right panel are scoped to it, for the same reason. */

import { Then, When } from "@cucumber/cucumber";
import { pollFor } from "../support/poll.ts";
import {
  HYDRATION_TIMEOUT,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";
import { showPickedView, workRepo } from "./conductor_steps.ts";

const COLUMN = '[data-testid="work-column"]';
const WORK_CODE = `${COLUMN} [data-testid="work-code"]`;
const RIGHT_PANEL = '[data-testid="right-panel"]';

/** The shown tree under `scope` — the inert one is the other mode's, kept. */
const tree = (scope: string): string =>
  `${scope} [data-code-tree-mode]:not([inert]) [data-testid="pierre-file-tree"]`;

/** A file's real row in the shown tree under `scope` (not its sticky copy). */
const fileRow = (scope: string, path: string): string =>
  `${tree(scope)} [data-item-path="${path}"][data-item-type="file"]:not([data-file-tree-sticky-row])`;

/** THE RIGHT PANEL FOLLOWS THE FOCUSED PANE. The implementor's terminal is
 *  made from the conversation and never shown, so the pane the host tab
 *  focuses is the scenario's first terminal: it stands in the work's repo
 *  for the Right panel's Code tab to be about the same repository. */
When(
  "I go into the work's repo in the terminal",
  async function (this: KoluWorld) {
    await this.terminalRunAndWait(`cd ${workRepo(this)}`);
    await this.waitForFrame();
  },
);

When("I show the work's code", async function (this: KoluWorld) {
  // The switch is there for a work in progress: wait for it, then press.
  await this.page
    .locator(`${COLUMN} [data-testid="work-view"][data-view="code"]`)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await showPickedView(this, "code");
  await this.page
    .locator(WORK_CODE)
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
});

Then(
  "the picked work should be showing its code",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () =>
        this.page
          .locator(`${COLUMN} [data-testid="work-card"][data-shape="picked"]`)
          .getAttribute("data-view", { timeout: 500 })
          .catch(() => null),
      isDone: (view) => view === "code",
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the picked work showed ${JSON.stringify(last)} after ${ms}ms, not its code`,
        ),
    });
  },
);

Then(
  "the work's Code view should list {string} in its tree",
  async function (this: KoluWorld, path: string) {
    // First population of the tree is the hydration axis (a repo walk or a
    // git status round trip), as in the Right panel's Code tab.
    await this.page
      .locator(fileRow(WORK_CODE, path))
      .first()
      .waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
  },
);

When(
  "I press the work's Code view mode {string}",
  async function (this: KoluWorld, mode: string) {
    const segment = this.page.locator(
      `${WORK_CODE} [data-testid="diff-mode-${mode}"]`,
    );
    await segment.waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
    await segment.click();
    await this.waitForFrame();
  },
);

Then(
  "the work's Code view mode should be {string}",
  async function (this: KoluWorld, mode: string) {
    await this.page
      .locator(
        `${WORK_CODE} [data-testid="diff-mode-toggle"][data-mode="${mode}"]`,
      )
      .waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
  },
);

When(
  "I open {string} in the work's Code view",
  async function (this: KoluWorld, path: string) {
    const row = this.page.locator(fileRow(WORK_CODE, path)).first();
    await row.waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
    await row.click();
    await this.waitForFrame();
  },
);

Then(
  "the work's Code view should show the markdown {string}",
  async function (this: KoluWorld, expected: string) {
    const md = this.page.locator(
      `${WORK_CODE} [data-testid="browse-preview-markdown"]`,
    );
    await pollFor({
      observe: () => md.textContent({ timeout: 1_000 }).catch(() => null),
      isDone: (text) => text?.includes(expected) ?? false,
      onTimeout: (last) =>
        new Error(
          `the work's Code view never showed "${expected}"; last text: ${JSON.stringify(last)}`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
    });
  },
);

/** THE TREE SCROLLS UNDER A FINGER — on a phone, a long tree is reached by
 *  dragging it. A drag is synthetic touch events on the tree, as the
 *  terminal's phone scroll does (`mobile_terminal_scroll_steps.ts`): a
 *  hasTouch context does not turn mouse drags into touches. A synthetic touch
 *  never scrolls anything natively, so the row comes into view only through
 *  the Code view's own touch driver (`pierreTouchScroll.ts`) — the thing this
 *  step is about. Each drag runs a finger from near the tree's bottom to near
 *  its top, which moves the content down. */
Then(
  "the work's Code view tree should scroll down to {string}",
  async function (this: KoluWorld, path: string) {
    const area = this.page.locator(tree(WORK_CODE)).first();
    await area.waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
    const box = await area.boundingBox();
    if (box === null) throw new Error("the work's Code view tree has no box");
    const row = this.page.locator(fileRow(WORK_CODE, path)).first();
    const x = box.x + box.width / 2;
    const startY = box.y + box.height - 20;
    const endY = box.y + 20;
    // No functions inside page.evaluate (swc's `__name` helper does not exist
    // in the page): the finger's path is computed here, and the events are
    // written out in the page with no helper.
    const ys: number[] = [];
    for (let i = 1; i <= 8; i++) ys.push(startY + ((endY - startY) * i) / 8);
    await pollFor({
      observe: async () => {
        if (await row.isVisible().catch(() => false)) {
          const at = await row.boundingBox();
          if (at !== null && at.y + at.height <= box.y + box.height + 1)
            return true;
        }
        await this.page.evaluate(
          ({ sel, x, startY, ys }) => {
            const target = document.querySelector(sel) as HTMLElement | null;
            if (!target) throw new Error(`No element matches ${sel}`);
            const first = new Touch({
              identifier: 0,
              target,
              clientX: x,
              clientY: startY,
            });
            target.dispatchEvent(
              new TouchEvent("touchstart", {
                touches: [first],
                targetTouches: [first],
                changedTouches: [first],
                bubbles: true,
                cancelable: true,
              }),
            );
            let last = first;
            for (const y of ys) {
              last = new Touch({
                identifier: 0,
                target,
                clientX: x,
                clientY: y,
              });
              target.dispatchEvent(
                new TouchEvent("touchmove", {
                  touches: [last],
                  targetTouches: [last],
                  changedTouches: [last],
                  bubbles: true,
                  cancelable: true,
                }),
              );
            }
            target.dispatchEvent(
              new TouchEvent("touchend", {
                touches: [],
                targetTouches: [],
                changedTouches: [last],
                bubbles: true,
                cancelable: true,
              }),
            );
          },
          { sel: tree(WORK_CODE), x, startY, ys },
        );
        return false;
      },
      isDone: (inView) => inView,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (_last, ms) =>
        new Error(
          `"${path}" never came into the work's Code view tree after ${ms}ms of dragging it`,
        ),
    });
  },
);

/** ONE VIEW MOUNTED AT A TIME. Not merely "no pane connected": with Code in
 *  front the picked work draws no live pane at all, and with Terminals in
 *  front it draws no Code view. */
const LIVE_PANE = `${COLUMN} [data-testid="live-pane"]`;

async function waitForNone(world: KoluWorld, selector: string): Promise<void> {
  await pollFor({
    observe: () => world.page.locator(selector).count(),
    isDone: (count) => count === 0,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(`${selector} still drew ${last} after ${ms}ms`),
  });
}

Then(
  "the picked work should draw no live pane",
  async function (this: KoluWorld) {
    await waitForNone(this, LIVE_PANE);
  },
);

Then(
  "the picked work should draw its live pane and no Code view",
  async function (this: KoluWorld) {
    await this.page
      .locator(LIVE_PANE)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await waitForNone(this, WORK_CODE);
  },
);

/** THE RIGHT PANEL'S OWN CODE TAB, read in the Right panel only. */
Then(
  "the Right panel's Code tab mode should be {string}",
  async function (this: KoluWorld, mode: string) {
    await this.page
      .locator(
        `${RIGHT_PANEL} [data-testid="diff-mode-toggle"][data-mode="${mode}"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Right panel's Code tab should not have {string} open",
  async function (this: KoluWorld, path: string) {
    await this.waitForFrame();
    const selected = await this.page
      .locator(
        `${tree(RIGHT_PANEL)} [data-item-path="${path}"][data-item-type="file"][aria-selected="true"]:not([data-file-tree-sticky-row])`,
      )
      .count();
    if (selected !== 0)
      throw new Error(
        `the Right panel's Code tab has "${path}" open — the work's Code view reached it`,
      );
  },
);

Then(
  "the work's Code view should have {string} open",
  async function (this: KoluWorld, path: string) {
    await this.page
      .locator(
        `${tree(WORK_CODE)} [data-item-path="${path}"][data-item-type="file"][aria-selected="true"]:not([data-file-tree-sticky-row])`,
      )
      .first()
      .waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
  },
);
