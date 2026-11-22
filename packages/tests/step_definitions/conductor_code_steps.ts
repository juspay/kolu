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
import { showPickedView } from "./conductor_steps.ts";

const COLUMN = '[data-testid="work-column"]';
const WORK_CODE = `${COLUMN} [data-testid="work-code"]`;
const RIGHT_PANEL = '[data-testid="right-panel"]';

/** The shown tree under `scope` — the inert one is the other mode's, kept. */
const tree = (scope: string): string =>
  `${scope} [data-code-tree-mode]:not([inert]) [data-testid="pierre-file-tree"]`;

/** A file's real row in the shown tree under `scope` (not its sticky copy). */
const fileRow = (scope: string, path: string): string =>
  `${tree(scope)} [data-item-path="${path}"][data-item-type="file"]:not([data-file-tree-sticky-row])`;

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

/** THE TREE SCROLLS — on a phone, a long tree is reached by scrolling it:
 *  wheel over the tree until the row far down it is on screen. */
Then(
  "the work's Code view tree should scroll down to {string}",
  async function (this: KoluWorld, path: string) {
    const area = this.page.locator(tree(WORK_CODE)).first();
    await area.waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
    const box = await area.boundingBox();
    if (box === null) throw new Error("the work's Code view tree has no box");
    const row = this.page.locator(fileRow(WORK_CODE, path)).first();
    await pollFor({
      observe: async () => {
        if (await row.isVisible().catch(() => false)) {
          const at = await row.boundingBox();
          if (at !== null && at.y + at.height <= box.y + box.height + 1)
            return true;
        }
        await this.page.mouse.move(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
        await this.page.mouse.wheel(0, 400);
        return false;
      },
      isDone: (inView) => inView,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (_last, ms) =>
        new Error(
          `"${path}" never came into the work's Code view tree after ${ms}ms of scrolling`,
        ),
    });
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
