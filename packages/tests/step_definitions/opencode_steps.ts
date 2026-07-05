/**
 * OpenCode status detection — step definitions.
 *
 * OpenCode state is driven by `kolu-mock-agent` running INSIDE the terminal (see
 * packages/mock-agent + support/mockAgent.ts): a real foreground `opencode` that
 * writes its own `~/.local/share/opencode/opencode.db` session (keyed on the
 * terminal's OWN cwd) at the box's real `$HOME` — so these run identically local
 * and over an ssh padi bind. The mock self-nudges its WAL, so the assertions no
 * longer re-fire it. Like Codex, the provider matches on `state.cwd`, so the
 * step `cd`s the terminal into a scenario-unique on-box dir first.
 */

import { Then, When } from "@cucumber/cucumber";
import {
  type AgentKind,
  launchMockAgent,
  type MockStateOpts,
  setMockState,
} from "../support/mockAgent.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

async function mockOpenCodeSession(
  world: KoluWorld,
  state: string,
  opts: MockStateOpts,
  { shim = false }: { shim?: boolean } = {},
): Promise<void> {
  await launchMockAgent(world, "opencode" satisfies AgentKind, { shim });
  await setMockState(world, state, opts);
}

When(
  "an OpenCode session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await mockOpenCodeSession(this, state, {});
  },
);

When(
  "an OpenCode session is mocked with state {string} via an npm-shimmed CLI",
  async function (this: KoluWorld, state: string) {
    await mockOpenCodeSession(this, state, {}, { shim: true });
  },
);

When(
  "an OpenCode session is mocked with state {string} and context tokens {int}",
  async function (this: KoluWorld, state: string, contextTokens: number) {
    await mockOpenCodeSession(this, state, { contextTokens });
  },
);

When(
  "an OpenCode session is mocked with state {string} and {int} todos with {int} completed",
  async function (
    this: KoluWorld,
    state: string,
    total: number,
    completed: number,
  ) {
    await mockOpenCodeSession(this, state, { todos: { total, completed } });
  },
);

When(
  "the OpenCode session state changes to {string}",
  async function (this: KoluWorld, state: string) {
    await setMockState(this, state);
  },
);

Then(
  "the tile chrome should show an OpenCode indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="canvas-tile"] [data-testid="agent-indicator"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-indicator"]',
          );
          return {
            state: el?.getAttribute("data-agent-state") ?? null,
            kind: el?.getAttribute("data-agent-kind") ?? null,
          };
        }),
      isDone: (o) => o.state === expectedState && o.kind === "opencode",
      onTimeout: (last, ms) =>
        new Error(
          `Expected OpenCode indicator state "${expectedState}" (kind=opencode), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

// Note: `the tile chrome should show context tokens {string}` is defined once in
// codex_steps.ts and shared by the opencode context-token scenario.
