/**
 * OpenCode status detection — step definitions.
 *
 * Mocks an OpenCode session by writing rows into a synthetic SQLite
 * database at `KOLU_OPENCODE_DB`. The scenario `cd`s into the fixture's
 * `cwd` and launches the fake `opencode` binary (a renamed `sleep`
 * copy, seeded by `hooks.ts`) so `matchesAgent(state, "opencode")`
 * succeeds via the foreground-basename path.
 *
 * Unlike Codex, OpenCode has no `subscribeExternalChanges` — the
 * provider relies on title events alone to re-resolve. Typing the fake
 * binary fires a title event, which triggers the resolve cycle.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import type { AgentLifecycleState } from "../support/agent-lifecycle.ts";
import { writeOpenCodeFixture } from "../support/agent-mock-opencode.ts";
import { waitForBufferContains } from "../support/buffer.ts";
import { clearMockDatabase } from "../support/mock-fs.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const getOpenCodeDb = () => process.env.KOLU_OPENCODE_DB;

let mockCwd: string | null = null;

function cleanup() {
  if (mockCwd && fs.existsSync(mockCwd)) {
    fs.rmSync(mockCwd, { recursive: true, force: true });
  }
  mockCwd = null;
  const dbPath = getOpenCodeDb();
  if (dbPath) clearMockDatabase(dbPath);
}

After({ tags: "@opencode-mock" }, () => {
  cleanup();
});

async function cdTerminalInto(world: KoluWorld, cwd: string): Promise<void> {
  const marker = `OPENCODE_CWD_READY_${Date.now()}`;
  await world.page.keyboard.type(`cd ${cwd} && echo ${marker}`);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, marker);
}

async function startFakeAgent(world: KoluWorld): Promise<void> {
  // See codex_steps.ts::startFakeAgent for rationale, including why we
  // emit a second OSC 2 title event from inside the fake agent's body.
  const bin = process.env.KOLU_FAKE_OPENCODE_BIN;
  if (!bin) throw new Error("KOLU_FAKE_OPENCODE_BIN must be set");
  await world.page.keyboard.type(
    `${bin} -c "printf '\\033]0;opencode\\007'; sleep 99999 ; :"`,
  );
  await world.page.keyboard.press("Enter");
}

async function startShimmedAgent(world: KoluWorld): Promise<void> {
  // See codex_steps.ts::startShimmedAgent for the full rationale.
  await world.page.keyboard.type(
    `opencode() { ( printf '\\033]0;opencode\\007'; sleep 99999 ; :); }`,
  );
  await world.page.keyboard.press("Enter");
  await world.page.keyboard.type("opencode");
  await world.page.keyboard.press("Enter");
}

interface MockOpts {
  state: AgentLifecycleState;
  contextTokens?: number;
  todos?: { total: number; completed: number };
}

async function mockOpenCodeSession(
  world: KoluWorld,
  opts: MockOpts,
  { shimmed }: { shimmed?: boolean } = {},
): Promise<void> {
  const dbPath = getOpenCodeDb();
  if (!dbPath) throw new Error("KOLU_OPENCODE_DB must be set");

  cleanup();

  mockCwd = fs.mkdtempSync(
    path.join(os.tmpdir(), `kolu-opencode-${process.pid}-`),
  );
  writeOpenCodeFixture({ dbPath, cwd: mockCwd, ...opts });

  await cdTerminalInto(world, mockCwd);
  if (shimmed) {
    await startShimmedAgent(world);
  } else {
    await startFakeAgent(world);
  }
}

When(
  "an OpenCode session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await mockOpenCodeSession(this, { state: state as AgentLifecycleState });
  },
);

When(
  "an OpenCode session is mocked with state {string} via an npm-shimmed CLI",
  async function (this: KoluWorld, state: string) {
    await mockOpenCodeSession(
      this,
      { state: state as AgentLifecycleState },
      { shimmed: true },
    );
  },
);

When(
  "an OpenCode session is mocked with state {string} and context tokens {int}",
  async function (this: KoluWorld, state: string, contextTokens: number) {
    await mockOpenCodeSession(this, {
      state: state as AgentLifecycleState,
      contextTokens,
    });
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
    await mockOpenCodeSession(this, {
      state: state as AgentLifecycleState,
      todos: { total, completed },
    });
  },
);

When(
  "the OpenCode session state changes to {string}",
  async function (this: KoluWorld, state: string) {
    const dbPath = getOpenCodeDb();
    if (!dbPath) throw new Error("KOLU_OPENCODE_DB must be set");
    if (!mockCwd) throw new Error("mockCwd not set — call mock step first");
    writeOpenCodeFixture({
      dbPath,
      cwd: mockCwd,
      state: state as AgentLifecycleState,
    });
  },
);

Then(
  "the tile chrome should show an OpenCode indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    const start = Date.now();
    let last: string | null = null;
    let lastKind: string | null = null;
    while (Date.now() - start < POLL_TIMEOUT) {
      const observed = await this.page.evaluate(() => {
        const el = document.querySelector(
          '[data-testid="canvas-tile"] [data-testid="agent-indicator"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-indicator"]',
        );
        return {
          state: el?.getAttribute("data-agent-state") ?? null,
          kind: el?.getAttribute("data-agent-kind") ?? null,
        };
      });
      last = observed.state;
      lastKind = observed.kind;
      if (last === expectedState && lastKind === "opencode") return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
      `Expected OpenCode indicator state "${expectedState}" (kind=opencode), got state="${last}" kind="${lastKind}" after ${POLL_TIMEOUT}ms`,
    );
  },
);
