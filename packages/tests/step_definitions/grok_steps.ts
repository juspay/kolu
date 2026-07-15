/**
 * Grok status detection — step definitions.
 *
 * Grok state is driven by `kolu-mock-agent` running INSIDE the terminal (see
 * packages/mock-agent + support/mockAgent.ts): a real foreground `grok` that
 * writes its own `~/.grok/active_sessions.json` + session tree at the box's
 * real `$HOME` — so these run identically local and over an ssh padi bind. The
 * mock self-nudges its files, so the assertions no longer re-fire them (except
 * the live-transition scenario, which deliberately omits harness nudges).
 */

import { Then, When } from "@cucumber/cucumber";
import {
  type AgentKind,
  launchMockAgent,
  setMockState,
} from "../support/mockAgent.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

async function mockGrokSession(
  world: KoluWorld,
  state: string,
  opts: { noActive?: boolean } = {},
): Promise<void> {
  await launchMockAgent(world, "grok" satisfies AgentKind);
  await setMockState(world, state, opts);
}

When(
  "a Grok session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await mockGrokSession(this, state);
  },
);

/** Start mock-agent with session files on disk but NO pid in
 *  active_sessions.json — the production race: TUI is foreground, map
 *  row lands later. A later step sends a state without `no-active`. */
When(
  "a Grok process is running without an active_sessions entry",
  async function (this: KoluWorld) {
    await mockGrokSession(this, "thinking", { noActive: true });
  },
);

/** padi's command-run reconcile ladder is [0, 75, 300, 1000] ms. Waiting
 *  past that forces any later match to come from externalChanges (the
 *  active_sessions watcher), not from a delayed command-run tick. */
When(
  "{int} ms elapse past the command-run reconcile window",
  async function (this: KoluWorld, ms: number) {
    await new Promise((r) => setTimeout(r, ms));
  },
);

When(
  "the active_sessions entry is written for the running Grok process with state {string}",
  async function (this: KoluWorld, state: string) {
    // Drop `noActive` so the mock rewrites active_sessions with process.pid.
    await setMockState(this, state);
  },
);

When(
  "the Grok session state changes to {string}",
  async function (this: KoluWorld, state: string) {
    await setMockState(this, state);
  },
);

async function observeGrokIndicator(world: KoluWorld): Promise<{
  state: string | null;
  kind: string | null;
}> {
  return world.page.evaluate(() => {
    const el = document.querySelector(
      '[data-testid="canvas-tile"] [data-testid="agent-indicator"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-indicator"]',
    );
    return {
      state: el?.getAttribute("data-agent-state") ?? null,
      kind: el?.getAttribute("data-agent-kind") ?? null,
    };
  });
}

Then(
  "the tile chrome should show a Grok indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observeGrokIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "grok",
      // No harness onTick nudge — mock-agent self-nudges its artifacts.
      onTimeout: (last, ms) =>
        new Error(
          `Expected Grok indicator state "${expectedState}" (kind=grok), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

/** Assert a live state change without harness-side utimes on events.jsonl.
 *  The rewrite from `the Grok session state changes` (mock setState) must be
 *  enough for the session watcher — if only a manual mtime touch lights the
 *  tile, production (append-only events) is broken the same way. */
Then(
  "the tile chrome should follow the Grok state change to {string} without nudging",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observeGrokIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "grok",
      // No onTick nudge — content write alone must rewake.
      onTimeout: (last, ms) =>
        new Error(
          `Expected live Grok state "${expectedState}" without nudge (kind=grok), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
