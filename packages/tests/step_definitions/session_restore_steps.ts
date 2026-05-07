import * as assert from "node:assert";
import * as os from "node:os";
import { Given, Then, When } from "@cucumber/cucumber";
import type { SavedTerminal } from "kolu-common/surface";
import { pollFor } from "../support/poll.ts";
import {
  type KoluWorld,
  WORKSPACE_SWITCHER_ENTRY_SELECTOR,
  POLL_TIMEOUT,
} from "../support/world.ts";

/** Post the saved-session payload to the server. Used both at scenario
 *  setup (Given) and as a self-heal in the assertion. Idempotent. */
async function postSavedSession(
  world: KoluWorld,
  count: number,
): Promise<void> {
  const dirs = [os.homedir(), os.tmpdir(), "/"].slice(0, count);
  await postSavedSessionPayload(
    world,
    dirs.map((cwd, i) => ({ id: String(i), cwd, git: null })),
  );
}

/** Post an arbitrary saved-session terminal list. The `savedAt`
 *  timestamp is captured on the first POST per scenario and replayed
 *  verbatim on subsequent self-heal re-POSTs — so the test always
 *  asserts that the *originally persisted* session restores, never a
 *  fresh-savedAt one a regression might require. */
async function postSavedSessionPayload(
  world: KoluWorld,
  terminals: SavedTerminal[],
): Promise<void> {
  if (world.savedSessionSavedAt === undefined) {
    world.savedSessionSavedAt = Date.now();
  }
  const resp = await world.page.request.fetch(
    "/rpc/surface/session/test__set",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        json: { terminals, savedAt: world.savedSessionSavedAt },
      }),
    },
  );
  assert.ok(resp.ok(), `surface/session/test__set failed: ${resp.status()}`);
}

Given(
  "a saved session with {int} terminals",
  async function (this: KoluWorld, count: number) {
    // Stash count for the assertion-side self-heal.
    this.savedSessionTerminalCount = count;
    await postSavedSession(this, count);
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
      await postSavedSessionPayload(this, this.savedSessionTerminals);
    } else if (this.savedSessionTerminalCount !== undefined) {
      await postSavedSession(this, this.savedSessionTerminalCount);
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

When(
  "I click the restore button",
  { timeout: 60_000 },
  async function (this: KoluWorld) {
    const btn = this.page.locator('[data-testid="restore-session"]');
    await btn.click();
    // Wait for at least one terminal to appear — under parallel macOS CI load,
    // server can be slow to spawn restored PTYs. Use waitForFunction for a
    // reactive DOM check instead of locator.waitFor.
    await this.page.waitForFunction(
      (sel) => document.querySelectorAll(sel).length > 0,
      WORKSPACE_SWITCHER_ENTRY_SELECTOR,
      { timeout: 45_000 },
    );
  },
);

Then(
  "there should be {int} workspace switcher entries",
  async function (this: KoluWorld, expected: number) {
    const entries = this.page.locator(WORKSPACE_SWITCHER_ENTRY_SELECTOR);
    await this.page.waitForFunction(
      ({ selector, count }) =>
        document.querySelectorAll(selector).length === count,
      { selector: WORKSPACE_SWITCHER_ENTRY_SELECTOR, count: expected },
      { timeout: 15000 },
    );
    const actual = await entries.count();
    assert.strictEqual(
      actual,
      expected,
      `Expected ${expected} workspace switcher entries, got ${actual}`,
    );
  },
);

// --- Ordering scenario ---

/** Directories for the predictable-ordering scenario. Posted in this
 *  non-alphabetical order to prove the pill strip alphabetizes by group
 *  (#830) regardless of saved insertion order — predictable position is
 *  the property that survives across restores, not the array order. */
const ORDERED_DIRS = ["/var", "/tmp", "/etc"];
const ALPHABETICAL_DIRS = [...ORDERED_DIRS].sort();

Given("a saved session in a specific order", async function (this: KoluWorld) {
  this.savedSessionTerminalCount = ORDERED_DIRS.length;
  const terminals = ORDERED_DIRS.map((cwd, i) => ({
    id: String(i),
    cwd,
    git: null,
  }));
  this.savedSessionTerminals = terminals;
  await postSavedSessionPayload(this, terminals);
});

Then(
  "the workspace switcher entries should be alphabetized",
  async function (this: KoluWorld) {
    const entries = this.page.locator(WORKSPACE_SWITCHER_ENTRY_SELECTOR);
    const count = await entries.count();
    const titles: string[] = [];
    for (let i = 0; i < count; i++) {
      const title = await entries.nth(i).getAttribute("title");
      titles.push(title ?? "");
    }
    assert.deepStrictEqual(
      titles,
      ALPHABETICAL_DIRS,
      `Workspace switcher order ${JSON.stringify(titles)} doesn't match expected alphabetical ${JSON.stringify(ALPHABETICAL_DIRS)}`,
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
    await postSavedSessionPayload(this, terminals);
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
    await postSavedSessionPayload(this, terminals);
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
  "workspace switcher entry {int} should be active",
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
    await postSavedSessionPayload(this, updated);
  },
);

Then(
  "the restore card should show agent command {string}",
  async function (this: KoluWorld, command: string) {
    // Same race as the visibility step: under parallel-worker load the
    // client can hydrate `savedSession` before the server snapshot
    // includes the most recent `lastAgentCommand` POST. Re-POSTing on
    // each poll iteration drives a `serverState.savedSession()` change
    // that re-fires `useSessionRestore`'s recovery effect — so the
    // commands eventually land in the rendered card. The replayed POST
    // reuses the original `savedAt` (see `postSavedSessionPayload`) so
    // the assertion still exercises the originally-persisted session.
    await pollFor({
      observe: () =>
        this.page.evaluate(
          (cmd) =>
            Array.from(
              document.querySelectorAll('[data-testid="resume-command"]'),
            ).some((n) => n.textContent?.trim() === cmd),
          command,
        ),
      isDone: (visible) => visible,
      onTick: async () => {
        if (this.savedSessionTerminals) {
          await postSavedSessionPayload(this, this.savedSessionTerminals);
        }
      },
      onTimeout: (_, ms) =>
        new Error(
          `Restore card never showed agent command "${command}" within ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
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

// --- #714 regression: heading is basename, not full cwd ---

Given(
  "a saved session at cwd {string}",
  async function (this: KoluWorld, cwd: string) {
    this.savedSessionTerminalCount = 1;
    const terminals: SavedTerminal[] = [{ id: "0", cwd, git: null }];
    this.savedSessionTerminals = terminals;
    await postSavedSessionPayload(this, terminals);
  },
);

Then(
  "the restore card heading should be {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (exp) => {
        const heading = document.querySelector('[data-testid="repo-heading"]');
        return heading?.textContent?.trim() === exp;
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);

Then(
  "the restore card heading should not contain {string}",
  async function (this: KoluWorld, forbidden: string) {
    // Poll instead of reading once: the prior step settled the heading, but a
    // bare textContent() + assert races SolidJS reactivity flushes on slow
    // machines (e2e-poll-async-state rule).
    await this.page.waitForFunction(
      (f) => {
        const heading = document.querySelector('[data-testid="repo-heading"]');
        const text = heading?.textContent?.trim() ?? "";
        return text.length > 0 && !text.includes(f);
      },
      forbidden,
      { timeout: POLL_TIMEOUT },
    );
  },
);
