import { randomUUID } from "node:crypto";
import { Given, Then, When } from "@cucumber/cucumber";
import type { Locator } from "playwright";
import { pollFor } from "../support/poll.ts";
import { surfaceCall, surfaceFirstFrame } from "../support/rpcWire.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const TRANSCRIPT = '[data-testid="conductor-transcript"]';
const PROPOSAL = '[data-testid="memory-proposal"]';
const CHIP = '[data-testid="conductor-memory-chip"]';
const SHEET = '[data-testid="memory-sheet"]';
const ENTRY = '[data-testid="memory-entry"]';
const EDITOR = '[data-testid="memory-editor"]';
const IMPORT = '[data-testid="memory-import"]';

const BUTTON: Record<string, string> = {
  Remember: '[data-testid="memory-proposal-remember"]',
  "Edit…": '[data-testid="memory-proposal-edit"]',
  "Don't": '[data-testid="memory-proposal-decline"]',
};

const until = async (
  what: string,
  observe: () => Promise<string | null>,
  holds: (seen: string | null) => boolean,
): Promise<void> => {
  await pollFor({
    observe,
    isDone: holds,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, elapsedMs) =>
      new Error(
        `${what}: last saw ${JSON.stringify(last)} after ${elapsedMs}ms`,
      ),
  });
};

/** EVERY TITLE A SCENARIO NAMES CARRIES THAT SCENARIO'S OWN MARK. A decline
 *  is kept to refuse the same proposal again, and nothing on the wire forgets
 *  one — so a title one scenario (or one attempt of it) declined must never
 *  be one another proposes. */
const marks = new WeakMap<KoluWorld, string>();
const marked = (world: KoluWorld, title: string): string => {
  let mark = marks.get(world);
  if (mark === undefined) {
    mark = randomUUID().slice(0, 6);
    marks.set(world, mark);
  }
  return `${title} · ${mark}`;
};

const proposalIn = (world: KoluWorld, title: string): Locator =>
  world.page
    .locator(`${TRANSCRIPT} ${PROPOSAL}`)
    .filter({ hasText: marked(world, title) })
    .last();

const entry = (world: KoluWorld, title: string): Locator =>
  world.page.locator(`${SHEET} ${ENTRY}`).filter({
    has: world.page.locator('[data-testid="memory-entry-title"]', {
      hasText: marked(world, title),
    }),
  });

interface MemoryCell {
  readonly entries: ReadonlyArray<{ readonly id: string }>;
  readonly proposals: ReadonlyArray<{ readonly id: string }>;
}

/** THE MEMORY A PREVIOUS SCENARIO LEFT, emptied over the real wire. Memory
 *  outlives every conversation, so a fresh conversation still holds it. A
 *  waiting proposal is approved and then deleted rather than declined, so it
 *  leaves nothing behind; each pass re-reads until the record is empty. */
Given("the Conductor's memory is empty", async function () {
  await pollFor({
    observe: async () => {
      const memory = (await surfaceFirstFrame(
        "surface/kolu/conductorMemory/get",
      )) as MemoryCell;
      for (const one of memory.proposals)
        await surfaceCall("surface/kolu/conductor/approveMemory", {
          proposal: one.id,
          edited: null,
        }).catch(() =>
          surfaceCall("surface/kolu/conductor/declineMemory", {
            proposal: one.id,
          }),
        );
      for (const one of memory.entries)
        await surfaceCall("surface/kolu/conductor/deleteMemory", {
          entry: one.id,
        });
      return memory.entries.length + memory.proposals.length;
    },
    isDone: (left) => left === 0,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (left, ms) =>
      new Error(
        `${left ?? "?"} memories and proposals were left after ${ms}ms`,
      ),
  });
});

When(
  "the Conductor proposes to remember {string}",
  async function (this: KoluWorld, title: string) {
    await surfaceCall("surface/kolu/conductor/prompt", {
      text: `remember ${marked(this, title)}`,
      mentions: [],
      attachments: [],
      steer: false,
    });
  },
);

const count = async (locator: Locator): Promise<string> =>
  String(await locator.count());

/** A dialog is gone when nothing of it is visible — a closed one may stay
 *  mounted. */
const shown = async (locator: Locator): Promise<string> =>
  String(await locator.isVisible());

Then(
  "the conductor transcript should show a waiting memory proposal {string}",
  async function (this: KoluWorld, title: string) {
    await until(
      `a waiting proposal "${title}" in the chat`,
      () =>
        count(proposalIn(this, title).and(this.page.locator("[data-waiting]"))),
      (seen) => seen !== "0",
    );
  },
);

Then(
  "the conductor transcript should show {int} one-line memory proposals",
  async function (this: KoluWorld, rows: number) {
    await until(
      "the one-line proposals in the chat",
      () =>
        count(
          this.page.locator(
            `${TRANSCRIPT} ${PROPOSAL}[data-waiting] [data-testid="memory-proposal-unfold"]`,
          ),
        ),
      (seen) => seen === String(rows),
    );
  },
);

When(
  "I press {string} on the memory proposal {string}",
  async function (this: KoluWorld, label: string, title: string) {
    const button = BUTTON[label];
    if (button === undefined) throw new Error(`no proposal button "${label}"`);
    await proposalIn(this, title)
      .locator(button)
      .click({ timeout: POLL_TIMEOUT });
  },
);

Then(
  "the memory proposal {string} should say {string}",
  async function (this: KoluWorld, title: string, ended: string) {
    await until(
      `how the proposal "${title}" ended`,
      () =>
        proposalIn(this, title)
          .locator('[data-testid="memory-proposal-ended"]')
          .textContent({ timeout: 1_000 })
          .catch(() => null),
      (seen) => seen === ended,
    );
  },
);

Then(
  "the memory chip should say {int} waiting",
  async function (this: KoluWorld, waiting: number) {
    await until(
      "the header's memory chip",
      () =>
        this.page
          .locator(CHIP)
          .getAttribute("data-waiting", { timeout: 1_000 })
          .catch(() => null),
      (seen) => seen === String(waiting),
    );
  },
);

Then("the memory chip should be gone", async function (this: KoluWorld) {
  await until(
    "the header's memory chip",
    () => count(this.page.locator(CHIP)),
    (seen) => seen === "0",
  );
});

When(
  "I open the Memory sheet from the conductor menu",
  async function (this: KoluWorld) {
    await this.page.locator('[data-testid="conductor-menu"]').click();
    await this.page.locator('[data-testid="conductor-menu-memory"]').click();
    await this.page.locator(SHEET).waitFor({ timeout: POLL_TIMEOUT });
  },
);

Then(
  "the Memory sheet should list the memory {string}",
  async function (this: KoluWorld, title: string) {
    await until(
      `the memory "${title}" on the sheet`,
      () => count(entry(this, title)),
      (seen) => seen !== "0",
    );
  },
);

Then(
  "the Memory sheet should not list the memory {string}",
  async function (this: KoluWorld, title: string) {
    await until(
      `the memory "${title}" on the sheet`,
      () => count(entry(this, title)),
      (seen) => seen === "0",
    );
  },
);

Then(
  "the Memory sheet should list no memory",
  async function (this: KoluWorld) {
    await until(
      "the memories on the sheet",
      () => count(this.page.locator(`${SHEET} ${ENTRY}`)),
      (seen) => seen === "0",
    );
  },
);

Then(
  "the Memory sheet should show {int} waiting proposals",
  async function (this: KoluWorld, waiting: number) {
    await until(
      "the proposals waiting on the sheet",
      () =>
        count(
          this.page.locator(
            `${SHEET} [data-testid="memory-sheet-waiting"] ${PROPOSAL}[data-waiting]`,
          ),
        ),
      (seen) => seen === String(waiting),
    );
  },
);

Then(
  "the Memory sheet should show {string} for the memory {string}",
  async function (this: KoluWorld, body: string, title: string) {
    await until(
      `the text of the memory "${title}"`,
      () =>
        entry(this, title)
          .textContent({ timeout: 1_000 })
          .catch(() => null),
      (seen) => (seen ?? "").includes(body),
    );
  },
);

When(
  "I set the memory editor's title to {string}",
  async function (this: KoluWorld, title: string) {
    await this.page
      .locator('[data-testid="memory-editor-title"]')
      .fill(marked(this, title));
  },
);

When("I save the memory editor", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="memory-editor-save"]').click();
  await until(
    "the memory editor",
    () => shown(this.page.locator(EDITOR)),
    (seen) => seen === "false",
  );
});

When(
  "I add a memory titled {string} saying {string}",
  async function (this: KoluWorld, title: string, body: string) {
    await this.page.locator('[data-testid="memory-add"]').click();
    await this.page
      .locator('[data-testid="memory-editor-title"]')
      .fill(marked(this, title));
    await this.page.locator('[data-testid="memory-editor-body"]').fill(body);
    await this.page.locator('[data-testid="memory-editor-save"]').click();
    await until(
      "the memory editor",
      () => shown(this.page.locator(EDITOR)),
      (seen) => seen === "false",
    );
  },
);

When(
  "I edit the memory {string} to say {string}",
  async function (this: KoluWorld, title: string, body: string) {
    await entry(this, title)
      .locator('[data-testid="memory-entry-edit"]')
      .click();
    await this.page.locator('[data-testid="memory-editor-body"]').fill(body);
    await this.page.locator('[data-testid="memory-editor-save"]').click();
    await until(
      "the memory editor",
      () => shown(this.page.locator(EDITOR)),
      (seen) => seen === "false",
    );
  },
);

When(
  "I delete the memory {string}",
  async function (this: KoluWorld, title: string) {
    const card = entry(this, title);
    await card.locator('[data-testid="memory-entry-delete"]').click();
    await card.locator('[data-testid="memory-entry-delete-confirm"]').click();
  },
);

When("I export the memory as Markdown", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="memory-export"]').click();
  await this.page.locator('[data-testid="memory-export-copy"]').click();
});

Then(
  "the clipboard should hold the memory {string}",
  async function (this: KoluWorld, title: string) {
    await until(
      "the clipboard",
      () => this.page.evaluate(() => navigator.clipboard.readText()),
      (seen) => (seen ?? "").includes(`## ${marked(this, title)}`),
    );
  },
);

When("I import the clipboard's memory file", async function (this: KoluWorld) {
  const file = await this.page.evaluate(() => navigator.clipboard.readText());
  await this.page.locator('[data-testid="memory-import-open"]').click();
  await this.page.locator('[data-testid="memory-import-paste"]').fill(file);
  await this.page.locator('[data-testid="memory-import-read"]').click();
});

Then(
  "the import should show {int} new and {int} already remembered",
  async function (this: KoluWorld, fresh: number, known: number) {
    const rows = this.page.locator(
      `${IMPORT} [data-testid="memory-import-entry"]`,
    );
    await until(
      "what the import found",
      async () =>
        `${await rows.count()}/${await rows.and(this.page.locator("[data-known]")).count()}`,
      (seen) => seen === `${fresh + known}/${known}`,
    );
  },
);

When("I add what the import found", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="memory-import-add"]').click();
  await until(
    "the import dialog",
    () => shown(this.page.locator(IMPORT)),
    (seen) => seen === "false",
  );
});

When("I press Bring over from Claude Code", async function (this: KoluWorld) {
  await this.page.locator('[data-testid="memory-bring-over"]').click();
});
