/**
 * Claude Code status detection — step definitions.
 *
 * Agent state is driven by `kolu-mock-agent` running INSIDE the terminal (see
 * packages/mock-agent + support/mockAgent.ts): a real foreground process that
 * writes its own `~/.claude` session/transcript artifacts at the box's real
 * `$HOME` — so these scenarios run identically local and over an ssh padi bind,
 * with no fixture files planted from the test process. The mock-agent
 * self-nudges its own fs.watch, so the assertions below no longer re-fire it.
 */

import * as assert from "node:assert";
import { Then, When } from "@cucumber/cucumber";
import {
  augmentMockState,
  launchMockAgent,
  paintPrompt,
  quitMockAgent,
  setMockState,
} from "../support/mockAgent.ts";
import { pollFor } from "../support/poll.ts";
import {
  HYDRATION_TIMEOUT,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

// No per-scenario mock-agent teardown hook: the next scenario's
// `terminal/killAll` (hooks.ts Before) SIGKILLs the whole terminal tree
// (including a still-resident mock-agent), and lingering artifacts don't leak
// across scenarios — claude keys on the LIVE foreground pid, codex/opencode on a
// per-scenario UNIQUE cwd. Box B's hygiene is the recipe's pre-run wipe. (A
// separate After can't drive the mock anyway: hooks.ts's page-close After runs
// first in cucumber's reverse order, so the page is already gone.)

When(
  "a Claude Code session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await launchMockAgent(this, "claude");
    await setMockState(this, state);
  },
);

When(
  "a newer stale previous-session JSONL exists in the same project dir",
  async function (this: KoluWorld) {
    // Regression guard (#467): a previous session's JSONL with a FUTURE mtime
    // must not capture the watcher over the current session's transcript. The
    // mock-agent writes it alongside the current transcript, keeping the state.
    await augmentMockState(this, { staleJsonl: true });
  },
);

When(
  "the Claude Code session state changes to {string}",
  async function (this: KoluWorld, state: string) {
    await setMockState(this, state);
  },
);

When(
  "the terminal renders a Claude AskUserQuestion prompt",
  async function (this: KoluWorld) {
    // #905: a pending AskUserQuestion never reaches the JSONL (the SDK buffers
    // it), so kolu recovers `awaiting_user` by scraping the rendered screen. The
    // foreground mock-agent PRINTS the prompt's real footer, exactly as Claude
    // paints it.
    await paintPrompt(this, "ask-user-question");
  },
);

When(
  "the terminal renders a Claude AskUserQuestion prompt with a notes hint",
  async function (this: KoluWorld) {
    // claude-code v2.1.173 inserted a `· n to add notes` segment into the
    // footer; the awaiting promotion must still fire.
    await paintPrompt(this, "ask-user-question-notes");
  },
);

When(
  "the terminal renders a Claude permission prompt",
  async function (this: KoluWorld) {
    // A tool-permission gate on screen while the tool call sits on disk — the
    // session reads `tool_use`; the `Tab to amend` footer promotes to awaiting.
    await paintPrompt(this, "permission");
  },
);

When("the Claude Code session ends", async function (this: KoluWorld) {
  await quitMockAgent(this);
});

When(
  "the Claude Code session has {int} tasks with {int} completed",
  async function (this: KoluWorld, total: number, completed: number) {
    await augmentMockState(this, { tasks: { total, completed } });
  },
);

Then(
  "the tile chrome should show an agent indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="canvas-tile"] [data-testid="agent-indicator"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-indicator"]',
          );
          return el?.getAttribute("data-agent-state") ?? null;
        }),
      isDone: (v) => v === expectedState,
      onTimeout: (last, elapsed) =>
        new Error(
          `Expected agent indicator state "${expectedState}", got "${last}" after ${elapsed}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the tile title state pip should be {string}",
  async function (this: KoluWorld, expectedVariant: string) {
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="canvas-tile-titlebar"] [data-testid="state-pip"]',
          );
          return el?.getAttribute("data-pip") ?? null;
        }),
      isDone: (v) => v === expectedVariant,
      onTimeout: (last, elapsed) =>
        new Error(
          `Expected title state pip "${expectedVariant}", got "${last}" after ${elapsed}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the tile chrome should show workflow badge {string}",
  async function (this: KoluWorld, expected: string) {
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="canvas-tile"] [data-testid="agent-workflow-badge"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-workflow-badge"]',
          );
          return el?.textContent ?? null;
        }),
      isDone: (v) => v?.includes(expected) ?? false,
      onTimeout: (last, elapsed) =>
        new Error(
          `Expected workflow badge containing "${expected}", got "${last}" after ${elapsed}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the tile chrome should not show an agent indicator",
  async function (this: KoluWorld) {
    // Clearing is a server re-derivation through the same fs.watch → SSE chain
    // as an appearance, so it gets the HYDRATION budget. The mock-agent keeps
    // re-firing the deletion signal (its removal window) so a dropped delete
    // event can't wedge the indicator on stale state.
    await pollFor({
      observe: () =>
        this.page.evaluate(
          () =>
            document.querySelector(
              '[data-testid="canvas-tile"] [data-testid="agent-indicator"]',
            ) === null,
        ),
      isDone: (gone) => gone === true,
      onTimeout: (_last, elapsed) =>
        new Error(
          `Expected the tile-chrome agent indicator to disappear, but it was still present after ${elapsed}ms`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
    });
  },
);

Then(
  "the tile chrome should show task progress {string}",
  async function (this: KoluWorld, expected: string) {
    await pollFor({
      observe: () =>
        this.page.evaluate(
          (txt) =>
            document
              .querySelector('[data-testid="agent-task-progress"]')
              ?.textContent?.includes(txt) ?? false,
          expected,
        ),
      isDone: (visible) => visible === true,
      onTimeout: (_last, elapsed) =>
        new Error(
          `tile chrome never showed task progress "${expected}" within ${elapsed}ms`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
      intervalMs: 500,
    });
  },
);

Then(
  "the header should not show an agent indicator",
  async function (this: KoluWorld) {
    await pollFor({
      observe: () =>
        this.page.evaluate(
          () =>
            document.querySelector('[data-testid="agent-indicator"]') === null,
        ),
      isDone: (gone) => gone === true,
      onTimeout: (_last, elapsed) =>
        new Error(
          `Expected the header agent indicator to disappear, but it was still present after ${elapsed}ms`,
        ),
      timeoutMs: HYDRATION_TIMEOUT,
    });
  },
);

// Shared with command-palette / worktree-agent / recent-agents / recent-repos
// features — a generic palette assertion that happens to live here.
Then(
  "palette item {string} should not be visible",
  async function (this: KoluWorld, text: string) {
    const palette = this.page.locator('[data-testid="command-palette"]');
    const item = palette
      .locator("li")
      .filter({ hasText: new RegExp(`^${text}`) });
    const count = await item.count();
    assert.strictEqual(
      count,
      0,
      `Expected palette item "${text}" to be hidden, but found ${count}`,
    );
  },
);
