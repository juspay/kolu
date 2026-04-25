import * as assert from "node:assert";
import * as os from "node:os";
import { Given, Then, When } from "@cucumber/cucumber";
import type { SavedTerminal } from "kolu-common";
import {
  type KoluWorld,
  PILL_TREE_ENTRY_SELECTOR,
  POLL_TIMEOUT,
} from "../support/world.ts";

/** Post the saved-session payload to the server. Used both at scenario
 *  setup (Given) and as a self-heal in the assertion. Idempotent. */
async function postSavedSession(
  page: KoluWorld["page"],
  count: number,
): Promise<void> {
  const dirs = [os.homedir(), os.tmpdir(), "/"].slice(0, count);
  await postSavedSessionPayload(
    page,
    dirs.map((cwd, i) => ({ id: String(i), cwd, git: null })),
  );
}

/** Post an arbitrary saved-session terminal list. */
async function postSavedSessionPayload(
  page: KoluWorld["page"],
  terminals: SavedTerminal[],
): Promise<void> {
  const resp = await page.request.fetch("/rpc/session/test__set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({
      json: { terminals, savedAt: Date.now() },
    }),
  });
  assert.ok(resp.ok(), `session/test__set failed: ${resp.status()}`);
}

Given(
  "a saved session with {int} terminals",
  async function (this: KoluWorld, count: number) {
    // Stash count for the assertion-side self-heal.
    this.savedSessionTerminalCount = count;
    await postSavedSession(this.page, count);
  },
);

Then(
  "the session restore card should be visible",
  async function (this: KoluWorld) {
    // The flake we're working around: useSessionRestore.ts has a once-only
    // `hydrated` flag that gates `setSavedSession(state.session)` on the
    // first non-undefined value of the state subscription. Under
    // parallel-worker contention, the subscription occasionally hydrates
    // BEFORE the server's snapshot reflects our test__set POST — savedSession
    // gets set to null and the card never appears.
    //
    // The companion createEffect (gated on terminals.length===0 + hydrated)
    // re-runs whenever `serverState.savedSession()` changes, so re-POSTing
    // the session AFTER hydration drives the card into view via that path.
    //
    // Strategy:
    //   1. Wait for empty-state to mount (proves WS is up + hydrated has run).
    //   2. Re-POST the session — guaranteed to be processed AFTER hydration.
    //   3. Wait for the card with the remaining budget.
    await this.page
      .locator('[data-testid="empty-state"]')
      .waitFor({ state: "visible", timeout: 15000 });
    const card = this.page.locator('[data-testid="session-restore"]');
    // Fast path: card already visible (happy-hydration run). `.catch(() => false)`
    // because Playwright's isVisible() can throw on transient DOM states during
    // mount — treating those as "not visible" just routes to the self-heal below.
    if (await card.isVisible().catch(() => false)) return;
    if (this.savedSessionTerminals) {
      await postSavedSessionPayload(this.page, this.savedSessionTerminals);
    } else if (this.savedSessionTerminalCount !== undefined) {
      await postSavedSession(this.page, this.savedSessionTerminalCount);
    }
    await card.waitFor({ state: "visible", timeout: 10000 });
  },
);

Then(
  "the restore button should mention {string}",
  async function (this: KoluWorld, text: string) {
    const btn = this.page.locator('[data-testid="restore-session"]');
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const content = await btn.textContent();
    assert.ok(
      content?.includes(text),
      `Expected restore button to contain "${text}", got "${content}"`,
    );
  },
);

When("I click the restore button", async function (this: KoluWorld) {
  const btn = this.page.locator('[data-testid="restore-session"]');
  await btn.click();
  // Wait for at least one terminal to appear — under load from 8 parallel
  // workers, server can be slow to spawn terminals. Use waitForFunction
  // for a reactive DOM check instead of locator.waitFor.
  await this.page.waitForFunction(
    (sel) => document.querySelectorAll(sel).length > 0,
    PILL_TREE_ENTRY_SELECTOR,
    { timeout: 20000 },
  );
});

Then(
  "there should be {int} pill tree entries",
  async function (this: KoluWorld, expected: number) {
    const entries = this.page.locator(PILL_TREE_ENTRY_SELECTOR);
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: PILL_TREE_ENTRY_SELECTOR, count: expected },
      { timeout: 15000 },
    );
    const actual = await entries.count();
    assert.strictEqual(
      actual,
      expected,
      `Expected ${expected} pill tree entries, got ${actual}`,
    );
  },
);

// --- Ordering scenario ---

/** Directories for the array-order scenario. Posted in this non-alphabetical
 *  order to prove the client honors the saved session's array order rather
 *  than silently re-sorting by cwd or anything else derived. */
const ORDERED_DIRS = ["/var", "/tmp", "/etc"];

Given("a saved session in a specific order", async function (this: KoluWorld) {
  this.savedSessionTerminalCount = ORDERED_DIRS.length;
  const terminals = ORDERED_DIRS.map((cwd, i) => ({
    id: String(i),
    cwd,
    git: null,
  }));
  this.savedSessionTerminals = terminals;
  await postSavedSessionPayload(this.page, terminals);
});

Then(
  "the pill tree entries should be in the saved order",
  async function (this: KoluWorld) {
    const entries = this.page.locator(PILL_TREE_ENTRY_SELECTOR);
    const count = await entries.count();
    const titles: string[] = [];
    for (let i = 0; i < count; i++) {
      const title = await entries.nth(i).getAttribute("title");
      titles.push(title ?? "");
    }
    assert.deepStrictEqual(
      titles,
      ORDERED_DIRS,
      `Pill tree order ${JSON.stringify(titles)} doesn't match expected ${JSON.stringify(ORDERED_DIRS)}`,
    );
  },
);

// --- Theme restore scenario ---

Given(
  "a saved session with theme {string}",
  async function (this: KoluWorld, themeName: string) {
    this.savedSessionTerminalCount = 1;
    const terminals = [{ id: "0", cwd: os.homedir(), git: null, themeName }];
    this.savedSessionTerminals = terminals;
    await postSavedSessionPayload(this.page, terminals);
  },
);

// --- Canvas layout restore scenario ---

Given(
  "a saved session with canvas layout at x={int} y={int} w={int} h={int}",
  async function (this: KoluWorld, x: number, y: number, w: number, h: number) {
    this.savedSessionTerminalCount = 1;
    const terminals = [
      {
        id: "0",
        cwd: os.homedir(),
        git: null,
        canvasLayout: { x, y, w, h },
      },
    ];
    this.savedSessionTerminals = terminals;
    await postSavedSessionPayload(this.page, terminals);
  },
);

Then(
  "the canvas tile should be at x={int} y={int} w={int} h={int}",
  async function (this: KoluWorld, x: number, y: number, w: number, h: number) {
    // Poll — the tile's inline style may briefly reflect a pending layout
    // while the server's metadata echo is in flight on first paint.
    await this.page.waitForFunction(
      (expected) => {
        const tile = document.querySelector<HTMLElement>(
          '[data-testid="canvas-tile"]',
        );
        if (!tile) return false;
        const s = tile.style;
        return (
          s.left === `${expected.x}px` &&
          s.top === `${expected.y}px` &&
          s.width === `${expected.w}px` &&
          s.height === `${expected.h}px`
        );
      },
      { x, y, w, h },
      { timeout: POLL_TIMEOUT },
    );
  },
);

// --- Refresh preserves the active terminal ---

/** The server debounces session auto-save by 500ms after the last change
 *  (see `initSessionAutoSave`). Tests that refresh after selecting a
 *  terminal must wait for the save to land; otherwise the server's
 *  `state.session.activeTerminalId` is stale and hydrate picks wrong. */
When("I wait for the session auto-save", async function (this: KoluWorld) {
  await new Promise((r) => setTimeout(r, 800));
});

Then(
  "pill tree entry {int} should be active",
  async function (this: KoluWorld, index: number) {
    const id = this.createdTerminalIds[index - 1];
    assert.ok(id, `No terminal created at index ${index} in this scenario`);
    await this.page.waitForFunction(
      (tid: string) => {
        const entry = document.querySelector(
          `[data-testid="canvas-tile"][data-terminal-id="${tid}"]`,
        );
        return entry?.hasAttribute("data-active") ?? false;
      },
      id,
      { timeout: POLL_TIMEOUT },
    );
  },
);

// --- Agent-resume scenarios ---

Given(
  "terminal {int} has captured agent command {string}",
  async function (this: KoluWorld, index: number, command: string) {
    // Idempotent edit to the saved session's `lastAgentCommand` field for
    // the matching terminal. Relies on an earlier
    // "a saved session with N terminals" step seeding ids "0", "1", … and
    // stashing the payload on `this.savedSessionTerminals`.
    const id = String(index);
    const terminals =
      this.savedSessionTerminals ??
      [...Array(this.savedSessionTerminalCount ?? 0)].map((_, i) => ({
        id: String(i),
        cwd: [os.homedir(), os.tmpdir(), "/"][i] ?? "/",
        git: null,
      }));
    const updated: SavedTerminal[] = terminals.map((t) =>
      t.id === id ? { ...t, lastAgentCommand: command } : t,
    );
    this.savedSessionTerminals = updated;
    await postSavedSessionPayload(this.page, updated);
  },
);

Then(
  "the restore card should show agent command {string}",
  async function (this: KoluWorld, command: string) {
    await this.page.waitForFunction(
      (cmd) => {
        const nodes = document.querySelectorAll(
          '[data-testid="resume-command"]',
        );
        return Array.from(nodes).some((n) => n.textContent?.trim() === cmd);
      },
      command,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the restore button should not mention {string}",
  async function (this: KoluWorld, text: string) {
    const btn = this.page.locator('[data-testid="restore-session"]');
    await btn.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
    const content = await btn.textContent();
    assert.ok(
      !content?.includes(text),
      `Expected restore button NOT to contain "${text}", got "${content}"`,
    );
  },
);

When("I turn off the resume-agents toggle", async function (this: KoluWorld) {
  const toggle = this.page.locator('[data-testid="resume-agents-toggle"]');
  await toggle.waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  await toggle.click();
});

Then(
  "the restore card should not show agent command {string}",
  async function (this: KoluWorld, command: string) {
    // Wait for the command row to disappear. Uses waitForFunction so we poll
    // the reactive DOM rather than race the toggle's state flush.
    await this.page.waitForFunction(
      (cmd) => {
        const nodes = document.querySelectorAll(
          '[data-testid="resume-command"]',
        );
        return !Array.from(nodes).some((n) => n.textContent?.trim() === cmd);
      },
      command,
      { timeout: POLL_TIMEOUT },
    );
  },
);
