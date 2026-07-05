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

import { After, Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import {
  type AgentKind,
  launchMockAgent,
  type MockStateOpts,
  quitActiveMockAgent,
  setMockState,
} from "../support/mockAgent.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const workerId = process.env.CUCUMBER_WORKER_ID ?? "0";
let cwdCounter = 0;
let mockCwd: string | null = null;

/** The dir the active mock `cd`'d the terminal into — exposed so the
 *  sleeping-terminals journey can assert a WOKEN terminal re-spawned in this
 *  SAVED cwd (matched by its unique leaf). Throws if no mock is active. */
export function codexMockCwd(): string {
  if (!mockCwd)
    throw new Error("No Codex mock active — call the mock step first");
  return mockCwd;
}

/** `cd` the active terminal into a fresh, scenario-unique, RECOGNIZABLE dir
 *  created on the box the terminal lives on, and record it. The chosen leaf is
 *  deterministic (worker + counter), so no fragile buffer-path parse is needed
 *  and the woken-cwd assertions match on the leaf. */
async function cdIntoScenarioDir(world: KoluWorld): Promise<string> {
  cwdCounter += 1;
  const dir = `/tmp/kolu-codex-w${workerId}-${cwdCounter}`;
  const marker = `CODEX_CWD_READY_${workerId}_${cwdCounter}`;
  await world.page.keyboard.type(`mkdir -p ${dir} && cd ${dir} && echo ${marker}`);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, marker);
  mockCwd = dir;
  return dir;
}

async function mockCodexSession(
  world: KoluWorld,
  state: string,
  opts: MockStateOpts,
  { shim = false }: { shim?: boolean } = {},
): Promise<void> {
  await cdIntoScenarioDir(world);
  await launchMockAgent(world, "codex" satisfies AgentKind, { shim });
  await setMockState(world, state, opts);
}

After({ tags: "@codex-mock" }, async function (this: KoluWorld) {
  await quitActiveMockAgent(this);
  mockCwd = null;
});

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
  "the Codex rollout reports input tokens {int} with cached input tokens {int}",
  async function (
    this: KoluWorld,
    inputTokens: number,
    cachedInputTokens: number,
  ) {
    // Matches the old fixture update: reporting token usage settles the turn to
    // `waiting`, carrying the input + cached counts.
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
