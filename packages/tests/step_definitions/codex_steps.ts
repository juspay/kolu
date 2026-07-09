/**
 * Codex status detection — step definitions.
 *
 * Codex state is driven by `kolu-mock-agent` running INSIDE the terminal (see
 * packages/mock-agent + support/mockAgent.ts): a real foreground `codex` that
 * writes its own `~/.codex/state_5.sqlite` thread row (keyed on the terminal's
 * OWN cwd) + rollout at the box's real `$HOME` — so these run identically local
 * and over an ssh padi bind. The mock self-nudges its WAL, so the assertions no
 * longer re-fire it.
 *
 * The Codex provider matches on `state.cwd`, so the step `cd`s the terminal into
 * a scenario-unique dir FIRST (created on-box, so it exists on whichever box the
 * terminal lives) and the mock-agent picks that cwd up via `process.cwd()`.
 */

import { Then, When } from "@cucumber/cucumber";
import {
  activeMockCwd,
  type AgentKind,
  launchMockAgent,
  type MockStateOpts,
  setMockState,
} from "../support/mockAgent.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

/** Re-exported for the sleeping-terminals journey (it asserts a WOKEN terminal
 *  re-spawned in the codex mock's SAVED cwd). `launchMockAgent` `cd`s into a
 *  scenario-unique dir, so this is just the active mock's cwd. */
export const codexMockCwd = activeMockCwd;

async function mockCodexSession(
  world: KoluWorld,
  state: string,
  opts: MockStateOpts,
  { shim = false }: { shim?: boolean } = {},
): Promise<void> {
  await launchMockAgent(world, "codex" satisfies AgentKind, { shim });
  await setMockState(world, state, opts);
}

When(
  "a Codex session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await mockCodexSession(this, state, {});
  },
);

When(
  "a Codex session is mocked with state {string} via an npm-shimmed CLI",
  async function (this: KoluWorld, state: string) {
    await mockCodexSession(this, state, {}, { shim: true });
  },
);

When(
  "a Codex session is mocked with state {string} and input tokens {int}",
  async function (this: KoluWorld, state: string, inputTokens: number) {
    await mockCodexSession(this, state, { inputTokens });
  },
);

When(
  "a Codex session is mocked with state {string} and input tokens {int} with cached input tokens {int}",
  async function (
    this: KoluWorld,
    state: string,
    inputTokens: number,
    cachedInputTokens: number,
  ) {
    await mockCodexSession(this, state, { inputTokens, cachedInputTokens });
  },
);

When(
  "the Codex rollout reports input tokens {int} with cached input tokens {int}",
  async function (
    this: KoluWorld,
    inputTokens: number,
    cachedInputTokens: number,
  ) {
    // Live update of an already-mocked session (kept for any scenario that
    // still drives a second write). Prefer the single-write When above when
    // the scenario doesn't need a mid-flight change.
    await setMockState(this, "waiting", { inputTokens, cachedInputTokens });
  },
);

When(
  "the Codex session state changes to {string}",
  async function (this: KoluWorld, state: string) {
    await setMockState(this, state);
  },
);

Then(
  "the tile chrome should show a Codex indicator with state {string}",
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
      isDone: (o) => o.state === expectedState && o.kind === "codex",
      onTimeout: (last, ms) =>
        new Error(
          `Expected Codex indicator state "${expectedState}" (kind=codex), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the tile chrome should show context tokens {string}",
  async function (this: KoluWorld, expected: string) {
    await pollFor({
      observe: () =>
        this.page.evaluate(
          () =>
            document.querySelector('[data-testid="agent-context-tokens"]')
              ?.textContent ?? null,
        ),
      isDone: (text) => text?.includes(expected) ?? false,
      onTimeout: (last, ms) =>
        new Error(
          `Expected context tokens to contain "${expected}", got "${last}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
