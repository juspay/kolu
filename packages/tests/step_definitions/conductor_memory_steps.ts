import { randomUUID } from "node:crypto";
import { After, Given, Then, When } from "@cucumber/cucumber";
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
  readonly entries: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
  }>;
  readonly proposals: ReadonlyArray<{ readonly id: string }>;
}

const readMemory = async (): Promise<MemoryCell> =>
  (await surfaceFirstFrame("surface/kolu/conductorMemory/get")) as MemoryCell;

/** Read the cell until `holds` says yes: a frame read right after a write
 *  can still show what the write settled. */
const memoryWhen = (
  what: string,
  holds: (memory: MemoryCell) => boolean,
): Promise<MemoryCell> =>
  pollFor({
    observe: readMemory,
    isDone: holds,
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(`${what}: last saw ${JSON.stringify(last)} after ${ms}ms`),
  });

/** THE MEMORY A SCENARIO LEFT, emptied over the real wire. Memory outlives
 *  every conversation, so a fresh conversation still holds it. A waiting
 *  proposal is approved and its entry then deleted, never declined: a kept
 *  decline would refuse the fixture's unmarked batch titles in a later
 *  scenario. Each id is acted on ONCE, and the cell is read until it agrees
 *  before the next step, since acting on a stale frame again is refused. */
const emptyMemory = async (): Promise<void> => {
  const waiting = await readMemory();
  for (const one of waiting.proposals)
    await surfaceCall("surface/kolu/conductor/approveMemory", {
      proposal: one.id,
      edited: null,
    });
  const settled = await memoryWhen(
    "the proposals settling",
    (memory) => memory.proposals.length === 0,
  );
  for (const one of settled.entries)
    await surfaceCall("surface/kolu/conductor/deleteMemory", {
      entry: one.id,
    });
  await memoryWhen(
    "the memory emptying",
    (memory) => memory.entries.length === 0,
  );
};

Given("the Conductor's memory is empty", async () => {
  await emptyMemory();
});

/** A memory scenario leaves no memory behind: a proposal still waiting would
 *  be a needs-you item in the next feature's badge. */
After(async ({ pickle }) => {
  if (pickle.uri.endsWith("features/conductor-memory.feature"))
    await emptyMemory();
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

Given(
  "I remember {string} saying {string}",
  async function (this: KoluWorld, title: string, body: string) {
    await surfaceCall("surface/kolu/conductor/saveMemory", {
      entry: null,
      text: { title: marked(this, title), about: null, body },
    });
  },
);

When(
  "the Conductor proposes to change the memory {string} to {string}",
  async function (this: KoluWorld, title: string, to: string) {
    const memory = (await surfaceFirstFrame(
      "surface/kolu/conductorMemory/get",
    )) as MemoryCell;
    const replaced = memory.entries.find(
      (one) => one.title === marked(this, title),
    );
    if (replaced === undefined)
      throw new Error(`no memory titled "${title}" to change`);
    await surfaceCall("surface/kolu/conductor/prompt", {
      text: `change ${replaced.id} to ${marked(this, to)}`,
      mentions: [],
      attachments: [],
      steer: false,
    });
  },
);

Then(
  "the memory proposal {string} should say it replaces {string}",
  async function (this: KoluWorld, title: string, replaced: string) {
    await until(
      `what the proposal "${title}" replaces`,
      () =>
        proposalIn(this, title)
          .locator('[data-testid="memory-proposal-replaces"]')
          .textContent({ timeout: 1_000 })
          .catch(() => null),
      (seen) => (seen ?? "").includes(marked(this, replaced)),
    );
  },
);

When(
  "I show the memory the proposal {string} replaces",
  async function (this: KoluWorld, title: string) {
    await proposalIn(this, title)
      .locator('[data-testid="memory-proposal-current"]')
      .click();
  },
);

Then(
  "the memory proposal {string} should show {string}",
  async function (this: KoluWorld, title: string, text: string) {
    await until(
      `the text of the proposal "${title}"`,
      () =>
        proposalIn(this, title)
          .textContent({ timeout: 1_000 })
          .catch(() => null),
      (seen) => (seen ?? "").includes(text),
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

/** A phone tab's needs-you badge, by the tab's own name — `none` when it
 *  carries none. */
const phoneTabBadge = (world: KoluWorld, tab: string): Promise<string> =>
  world.page
    .locator(
      `[data-testid="conductor-phone-tab"][data-tab="${tab.toLowerCase()}"] [data-testid="conductor-phone-tab-badge"]`,
    )
    .textContent({ timeout: 1_000 })
    .catch(() => "none")
    .then((seen) => seen?.trim() ?? "none");

Then(
  "the phone's {word} tab should show a badge of {int}",
  async function (this: KoluWorld, tab: string, badge: number) {
    await until(
      `the phone's ${tab} tab badge`,
      () => phoneTabBadge(this, tab),
      (seen) => seen === String(badge),
    );
  },
);

Then(
  "the phone's {word} tab should show no badge",
  async function (this: KoluWorld, tab: string) {
    await until(
      `the phone's ${tab} tab badge`,
      () => phoneTabBadge(this, tab),
      (seen) => seen === "none",
    );
  },
);

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
