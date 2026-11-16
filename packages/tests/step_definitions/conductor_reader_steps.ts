/** THE READER — step definitions.
 *
 *  The same chain every other Conductor step drives: the browser writes
 *  through the KOLU surface, kolu-server's one conversation writes down a pipe
 *  to the scripted adapter (`support/acp-fixture-agent.ts`), and what these
 *  steps read is the DOM the person would be looking at. Nothing here stubs a
 *  store or a file read.
 *
 *  The measuring steps are the reason this file exists at all. "The plan is
 *  readable" is not a thing a text match can say: it is a column wide enough
 *  to read and a table whose cells are not narrower than their longest word,
 *  and both of those are measurements of the laid-out page. */

import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import type { Page } from "playwright";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import {
  enterConductor,
  openWorkCard,
  sendPrompt,
  showWorkColumn,
} from "./conductor_steps.ts";

const READER = '[data-testid="conductor-reader"]';
const READER_DOC = '[data-testid="reader-doc"]';
const READER_QUESTION = '[data-testid="reader-question"]';
const CHAT = '[data-testid="conductor-chat"]';
const SIDE = '[data-testid="conductor-side"]';
const WORK_COLUMN = '[data-testid="work-column"]';
const OPTION = '[data-testid="conductor-ask-option"]';
const SUBMIT = '[data-testid="conductor-ask-submit"]';
const READ_FILE_BUTTON = '[data-testid="work-question-read"]';

/** THE READING WIDTH — 40rem of text at the reader's 16px body, which is
 *  about 80 characters a line. It is the FLOOR this suite holds the document
 *  column to, not the measure the design states (50rem,
 *  `--container-conductor-reader`): the point of the assertion is that the
 *  plan is read in a column a person can read, on whatever window the suite
 *  runs at, and a floor says that without pinning a number the design is free
 *  to move. */
const READING_WIDTH_PX = 640;

/** The pop-out window this scenario opened, if it opened one. A module
 *  variable rather than a field on the World: the window is this file's own
 *  business, and nothing outside these steps has anything to say to it. */
let popped: Page | null = null;

After(async () => {
  if (popped !== null && !popped.isClosed()) await popped.close();
  popped = null;
});

function repoOf(world: KoluWorld): string {
  const dir = world.workRepoDir;
  assert.ok(dir, "this scenario never made a repo for the work");
  return dir;
}

/** A PLAN WITH A TABLE IN IT — the document the whole feature is about. The
 *  table's own words are long on purpose: four columns of them do not fit the
 *  work card's old preview box, which is how the plan came to be drawn one
 *  word a line, and they fit the reader's pane. */
const PLAN = `# The plan

odu's user docs are two pages, \`docs.md\` and \`cache.md\`, each three to four
times over the page limit kolu holds its own docs to. They show every problem
kolu's own docs had before the rewrite, which is what this plan is for.

## What is wrong today

| Measure | docs.md | cache.md | Limit |
| --- | --- | --- | --- |
| Paragraphs over eighty words | 27 | 22 | 0 |
| Sentences of incomprehensibility | 27 | 31 | 0 |
| Bold run-in paragraphs, counted | 25 | 23 | 0 |

## What I propose

Port the writing standard, port the lint that enforces it, and split the two
pages into one page a reader and one job each.
`;

When(
  "the implementor writes a plan with a table into the work's repo",
  async function (this: KoluWorld) {
    const full = path.join(repoOf(this), ".waterfall", "plan.md");
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, PLAN);
  },
);

/** THE QUESTION THAT NAMES A FILE. A real `work_ask` carrying
 *  `file: ".waterfall/plan.md"` — which is what makes every face of the
 *  question offer to open it. */
When(
  "I ask the conductor to put the plan up for approval",
  async function (this: KoluWorld) {
    await enterConductor(this);
    await sendPrompt(this, "ask about the plan");
  },
);

/** THE CONDUCTOR NAMES THE FILE in a reply that is ABOUT ONE WORK: it looks
 *  at that work's implementor first (a kolu tool card naming the terminal),
 *  then writes the path in backticks. The sentence says no work; the turn
 *  does. */
When(
  "the conductor looks at the implementor and says where its plan is",
  async function (this: KoluWorld) {
    await enterConductor(this);
    await sendPrompt(this, "look at the implementor and say where its plan is");
  },
);

/** THE NAMED FILE, pressed where it was said — a real button in the chat,
 *  found by the name a screen reader reads ("Open <path>"). */
When(
  "I press the file the conductor named, {string}",
  async function (this: KoluWorld, file: string) {
    const link = this.page
      .locator(`${CHAT} button[aria-label="Open ${file}"]`)
      .last();
    await link.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await link.click();
  },
);

/** ... and, once the reader is on it, the mention says so, as the card's row
 *  does. */
Then(
  "the file the conductor named, {string}, should read as open",
  async function (this: KoluWorld, file: string) {
    await this.page
      .locator(`${CHAT} button[aria-label="Open ${file}"][aria-current="true"]`)
      .last()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** A `Wrote …` ROW on the card's timeline, pressed — found by the name a
 *  screen reader reads, on the card the scenario opened. */
When(
  "I press the work's timeline row for {string}",
  async function (this: KoluWorld, file: string) {
    await showWorkColumn(this);
    await openWorkCard(this);
    const row = this.page
      .locator(
        `${WORK_COLUMN} [data-testid="work-timeline"] button[aria-label="Open ${file}"]`,
      )
      .first();
    await row.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await row.click();
  },
);

/** THE READ BUTTON, on the card's copy of the question. It is the route the
 *  design insists on: the plan does NOT open by itself when the Conductor
 *  asks — the question carries the way in. */
Then(
  "the work's question should offer to read the plan",
  async function (this: KoluWorld) {
    await openWorkCard(this);
    await this.page
      .locator(`${WORK_COLUMN} ${READ_FILE_BUTTON}`)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

When("I press the question's Read button", async function (this: KoluWorld) {
  await openWorkCard(this);
  await this.page.locator(`${WORK_COLUMN} ${READ_FILE_BUTTON}`).first().click();
});

Then(
  "the reader should be open on {string}",
  async function (this: KoluWorld, file: string) {
    await this.page
      // THE FACE, which is the fact the record keeps about an answer given
      // here — the pane's reader is `reader`, the pop-out is `popout`.
      .locator(`${READER}[data-path="${file}"][data-from="reader"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** ... and on THIS scenario's work — the one the reply was about — rather
 *  than whichever other work happens to hold a file of the same name. */
Then(
  "the reader should be open on the work's {string}",
  async function (this: KoluWorld, file: string) {
    const work = this.workId;
    assert.ok(work, "this scenario never opened a work");
    await this.page
      .locator(
        `${READER}[data-path="${file}"][data-from="reader"][data-work="${work}"]`,
      )
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** NO CHOICE WAS PUT: the press opened a file outright. */
Then("no menu of works should have opened", async function (this: KoluWorld) {
  assert.equal(
    await this.page.locator('[data-testid="named-file-menu"]').count(),
    0,
    "pressing the file put a menu of works up",
  );
});

/** THE TURN'S WORK HAS NO SUCH FILE: a status note where the link is, naming
 *  this scenario's work by its chip face and the path it lacks. */
Then(
  "the conductor should say the work has no {string} yet",
  async function (this: KoluWorld, file: string) {
    const title = this.workTitle;
    assert.ok(title, "this scenario never named the work it opened");
    const note = this.page
      .locator(`${CHAT} [data-testid="named-file-missing"][role="status"]`)
      .last();
    await note.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    await note
      .locator('[data-testid="work-chip-face"]')
      .filter({ hasText: title })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const says = (await note.textContent()) ?? "";
    assert.ok(says.includes(file), `the note says ${JSON.stringify(says)}`);
  },
);

Then("the reader should be closed", async function (this: KoluWorld) {
  await pollFor({
    observe: () => this.page.locator(READER).count(),
    isDone: (count) => count === 0,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(`${last} readers were still on screen after ${ms}ms`),
  });
});

/** HOW WIDE A THING ON SCREEN IS, or 0 when it is not drawn at all — the one
 *  measurement every "gives way" assertion below is made of. */
async function widthOf(page: Page, selector: string): Promise<number> {
  return page
    .locator(selector)
    .evaluateAll((all) =>
      all.length === 0 ? 0 : all[0].getBoundingClientRect().width,
    );
}

async function waitForWidth(
  page: Page,
  selector: string,
  isDone: (width: number) => boolean,
  what: string,
): Promise<void> {
  await pollFor({
    observe: () => widthOf(page, selector),
    isDone,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(`${what}: ${selector} was ${last}px wide after ${ms}ms`),
  });
}

/** THE WORK COLUMN GIVES WAY. It is still MOUNTED — that is the whole point,
 *  so the way back is the cards exactly as they were — but it takes no width
 *  and no press. */
Then(
  "the work column should have given way to the reader",
  async function (this: KoluWorld) {
    await waitForWidth(
      this.page,
      SIDE,
      (width) => width === 0,
      "the work column still takes room beside the reader",
    );
  },
);

Then(
  "the conversation should be beside the reader",
  async function (this: KoluWorld) {
    await waitForWidth(
      this.page,
      CHAT,
      (width) => width > 0,
      "the conversation is not on screen beside the reader",
    );
    const reader = await widthOf(this.page, READER);
    const chat = await widthOf(this.page, CHAT);
    assert.ok(
      reader > chat,
      `the reader (${reader}px) does not have the large side of the screen beside the conversation (${chat}px)`,
    );
  },
);

Then(
  "the conversation should be out of the way",
  async function (this: KoluWorld) {
    await waitForWidth(
      this.page,
      CHAT,
      (width) => width === 0,
      "the conversation still takes room",
    );
  },
);

When("I fill the screen with the reader", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="reader-fill"]').click();
});

When("I take the conversation back", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="reader-fill"]').click();
});

When("I leave the reader", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="reader-back"]').click();
});

/** THE DOCUMENT, MEASURED. Two facts, both about the laid-out page:
 *
 *   - the column a paragraph is set in is at least the reading width, and no
 *     wider than the measure the stylesheet declares (it is a COLUMN, not the
 *     pane with text in it);
 *   - no word inside a table cell is broken across lines. A table's columns
 *     can never be narrower than their longest word, so a cell that broke one
 *     is a cell that was squeezed past what table layout can give — the
 *     defect that sent the plan out of the card in the first place. */
Then(
  "the document should be set for reading",
  async function (this: KoluWorld) {
    const doc = this.page.locator(READER_DOC);
    await doc.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const column = await pollFor({
      observe: () =>
        doc.evaluate((el) => {
          const paragraph = el.querySelector(".kolu-md > p");
          return paragraph === null
            ? 0
            : paragraph.getBoundingClientRect().width;
        }),
      isDone: (width) => width > 0,
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (_last, ms) =>
        new Error(`the document rendered no paragraph after ${ms}ms`),
    });
    assert.ok(
      column >= READING_WIDTH_PX,
      `the document column is ${Math.round(column)}px, under the ${READING_WIDTH_PX}px a plan is read in`,
    );
    const declared = await doc.evaluate((el) =>
      Number.parseFloat(
        getComputedStyle(el).getPropertyValue("--container-conductor-reader"),
      ),
    );
    const root = await this.page.evaluate(() =>
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize),
    );
    assert.ok(
      Number.isFinite(declared) && declared > 0,
      "--container-conductor-reader is not declared",
    );
    assert.ok(
      column <= declared * root + 1,
      `the document column is ${Math.round(column)}px, wider than the ${declared}rem measure it is set in — it is the pane, not a column`,
    );

    const squeezed = await doc.evaluate((el) => {
      const cells = [
        ...el.querySelectorAll(".kolu-md table th, .kolu-md table td"),
      ];
      const range = document.createRange();
      const broken: string[] = [];
      const oneWordALine: string[] = [];
      for (const cell of cells) {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node.nodeValue ?? "";
          for (const match of text.matchAll(/\S+/g)) {
            const start = match.index ?? 0;
            range.setStart(node, start);
            range.setEnd(node, start + match[0].length);
            // A word laid out on ONE line has one client rect. Two means the
            // browser broke the word itself, which it only does when the
            // column is narrower than the word.
            if (range.getClientRects().length > 1) broken.push(match[0]);
          }
        }
        // AND THE DEFECT AS THE PERSON MET IT: a cell squeezed to its
        // columns' minimum is a cell with one word on every line. Table
        // layout stops at that minimum rather than going under it, so a cell
        // can read one word a line without a single word being broken —
        // which is exactly what the card's box did to the plan.
        const words = (cell.textContent ?? "")
          .trim()
          .split(/\s+/)
          .filter(Boolean);
        const lines = (() => {
          range.selectNodeContents(cell);
          return range.getClientRects().length;
        })();
        if (words.length > 1 && lines >= words.length)
          oneWordALine.push(words.join(" "));
      }
      return { broken, oneWordALine };
    });
    assert.deepStrictEqual(
      squeezed,
      { broken: [], oneWordALine: [] },
      `the table was squeezed: ${JSON.stringify(squeezed)}`,
    );
  },
);

/** ANSWERING WHERE THE PLAN IS. The pinned question is the same ask the card
 *  and the chat draw, so this is the one record being settled — from here. */
When("I approve the plan in the reader", async function (this: KoluWorld) {
  const question = this.page.locator(READER_QUESTION);
  await question.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await question.locator(`${OPTION}[data-value="approve"]`).click();
  await question.locator(SUBMIT).click();
});

Then(
  "the reader should say how many comments go with the answer",
  async function (this: KoluWorld) {
    await this.page
      .locator(`${READER_QUESTION} [data-testid="work-question-attach"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

/** POP OUT — a real second browser window, which is what the design promises
 *  a person can move to a second monitor. The page it opens is the app on its
 *  own route, so everything below is read from a different document. */
When("I pop the reader out", async function (this: KoluWorld) {
  const opened = this.context.waitForEvent("page", { timeout: POLL_TIMEOUT });
  await this.page.locator('[data-testid="reader-popout"]').click();
  popped = await opened;
  await popped.waitForLoadState("domcontentloaded");
});

function poppedOut(): Page {
  assert.ok(popped, "this scenario never popped the reader out");
  return popped;
}

Then(
  "the popped-out window should be reading {string}",
  async (_file: string) => {
    // The window is the reader and nothing else: no workspace behind it.
    const page = poppedOut();
    await page
      .locator(`${READER}[data-path="${_file}"][data-from="popout"]`)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    assert.strictEqual(
      await page.locator('[data-testid="conductor-pane"]').count(),
      0,
      "the popped-out window drew the whole workspace, not the reader alone",
    );
  },
);

Then(
  "the popped-out window should render {string} as a heading",
  async (heading: string) => {
    const page = poppedOut();
    await pollFor({
      observe: () =>
        page
          .locator(`${READER_DOC} .kolu-md h1, ${READER_DOC} .kolu-md h2`)
          .evaluateAll((all) =>
            all.map((one) => (one.textContent ?? "").trim()),
          ),
      isDone: (headings) => headings.includes(heading),
      timeoutMs: POLL_TIMEOUT,
      onTimeout: (last, ms) =>
        new Error(
          `the popped-out window never rendered ${JSON.stringify(heading)} after ${ms}ms; it holds ${JSON.stringify(last)}`,
        ),
    });
  },
);

When("I approve the plan in the popped-out window", async () => {
  const page = poppedOut();
  const question = page.locator(READER_QUESTION);
  await question.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await question.locator(`${OPTION}[data-value="approve"]`).click();
  await question.locator(SUBMIT).click();
});

When("I close the popped-out window", async () => {
  const page = poppedOut();
  await page.close();
  popped = null;
});

/** THE READER ON A PHONE: the whole screen, and a way back. Width, not a
 *  class — what a person meets is how much of the window the document gets. */
Then(
  "the reader should have the whole screen",
  async function (this: KoluWorld) {
    await this.page
      .locator(READER)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const reader = await widthOf(this.page, READER);
    const pane = await widthOf(this.page, '[data-testid="conductor-pane"]');
    assert.ok(
      pane > 0 && reader >= pane - 1,
      `the reader is ${Math.round(reader)}px of the pane's ${Math.round(pane)}px`,
    );
  },
);

Then(
  "the work column should be back as it was",
  async function (this: KoluWorld) {
    await showWorkColumn(this);
    await this.page
      .locator(`${WORK_COLUMN} [data-testid="work-card"][data-open]`)
      .first()
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);
