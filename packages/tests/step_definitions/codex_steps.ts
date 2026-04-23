/**
 * Codex status detection — step definitions.
 *
 * Mocks a Codex session by writing a `threads` row into a synthetic
 * SQLite DB and a matching rollout JSONL, both under the per-worker
 * `KOLU_CODEX_DIR`. The scenario then `cd`s into the mock cwd and
 * launches the fake `codex` binary (a renamed copy of `sleep`, seeded
 * by `hooks.ts`) so that `matchesAgent(state, "codex")` succeeds via
 * the foreground-basename lookup.
 *
 * The Codex provider matches purely on `state.cwd`, so the scenario's
 * mock cwd doubles as the `threads.cwd` column — no PID fiddling
 * required, unlike the claude-code mock.
 */

import { When, Then, After } from "@cucumber/cucumber";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { KoluWorld, POLL_TIMEOUT } from "../support/world.ts";
import { waitForBufferContains } from "../support/buffer.ts";
import {
  writeCodexFixture,
  updateCodexRollout,
} from "../support/agent-mock-codex.ts";
import type { AgentLifecycleState } from "../support/agent-lifecycle.ts";

const getCodexDir = () => process.env.KOLU_CODEX_DIR;

let mockCwd: string | null = null;
let mockRolloutPath: string | null = null;

function cleanup() {
  if (mockCwd && fs.existsSync(mockCwd)) {
    fs.rmSync(mockCwd, { recursive: true, force: true });
  }
  mockCwd = null;
  if (mockRolloutPath && fs.existsSync(mockRolloutPath)) {
    fs.unlinkSync(mockRolloutPath);
  }
  mockRolloutPath = null;
  const codexDir = getCodexDir();
  const dbPath = codexDir && path.join(codexDir, "state_5.sqlite");
  if (dbPath && fs.existsSync(dbPath)) {
    try {
      fs.unlinkSync(dbPath);
      for (const suffix of ["-wal", "-shm"]) {
        const sidecar = dbPath + suffix;
        if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
      }
    } catch {
      // Best-effort — the file may be transiently locked by the
      // server's reader connection; the next test's fixture write will
      // overwrite in place anyway.
    }
  }
}

After({ tags: "@codex-mock" }, function () {
  cleanup();
});

async function cdTerminalInto(world: KoluWorld, cwd: string): Promise<void> {
  const marker = `CODEX_CWD_READY_${Date.now()}`;
  await world.page.keyboard.type(`cd ${cwd} && echo ${marker}`);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, marker);
}

async function startFakeAgent(world: KoluWorld): Promise<void> {
  // Long-lived foreground sleep — the copy named `codex` on PATH runs
  // for the scenario's duration so `foregroundPid != shellPid` stays
  // true and `readForegroundBasename()` keeps returning "codex".
  // `terminal/killAll` in hooks.ts:Before tears the pty down between
  // scenarios, which kills the child as a side effect.
  await world.page.keyboard.type("codex 99999");
  await world.page.keyboard.press("Enter");
}

When(
  "a Codex session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    const codexDir = getCodexDir();
    if (!codexDir) throw new Error("KOLU_CODEX_DIR must be set");

    cleanup();

    mockCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), `kolu-codex-${process.pid}-`),
    );
    const fixture = writeCodexFixture({
      codexDir,
      cwd: mockCwd,
      state: state as AgentLifecycleState,
    });
    mockRolloutPath = fixture.rolloutPath;

    await cdTerminalInto(this, mockCwd);
    await startFakeAgent(this);
  },
);

When(
  "a Codex session is mocked with state {string} and input tokens {int}",
  async function (this: KoluWorld, state: string, inputTokens: number) {
    const codexDir = getCodexDir();
    if (!codexDir) throw new Error("KOLU_CODEX_DIR must be set");

    cleanup();

    mockCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), `kolu-codex-${process.pid}-`),
    );
    const fixture = writeCodexFixture({
      codexDir,
      cwd: mockCwd,
      state: state as AgentLifecycleState,
      inputTokens,
    });
    mockRolloutPath = fixture.rolloutPath;

    await cdTerminalInto(this, mockCwd);
    await startFakeAgent(this);
  },
);

When(
  "the Codex rollout reports input tokens {int} with cached input tokens {int}",
  async function (
    this: KoluWorld,
    inputTokens: number,
    cachedInputTokens: number,
  ) {
    if (!mockRolloutPath) {
      throw new Error("No Codex rollout to update — call mock step first");
    }
    updateCodexRollout(mockRolloutPath, {
      state: "waiting",
      inputTokens,
      cachedInputTokens,
    });
  },
);

When(
  "the Codex session state changes to {string}",
  async function (this: KoluWorld, state: string) {
    if (!mockRolloutPath) {
      throw new Error("No Codex rollout to update — call mock step first");
    }
    updateCodexRollout(mockRolloutPath, {
      state: state as AgentLifecycleState,
    });
  },
);

Then(
  "the tile chrome should show a Codex indicator with state {string}",
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
      if (last === expectedState && lastKind === "codex") return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(
      `Expected Codex indicator state "${expectedState}" (kind=codex), got state="${last}" kind="${lastKind}" after ${POLL_TIMEOUT}ms`,
    );
  },
);

Then(
  "the tile chrome should show context tokens {string}",
  async function (this: KoluWorld, expected: string) {
    await this.page.waitForFunction(
      (txt) => {
        const el = document.querySelector(
          '[data-testid="agent-context-tokens"]',
        );
        return el?.textContent?.includes(txt) ?? false;
      },
      expected,
      { timeout: POLL_TIMEOUT },
    );
  },
);
