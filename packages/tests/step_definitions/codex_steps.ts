import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import type { AgentLifecycleState } from "../support/agent-lifecycle.ts";
import {
  type CodexFixture,
  updateCodexRollout,
  writeCodexFixture,
} from "../support/agent-mock-codex.ts";
import { waitForBufferContains } from "../support/buffer.ts";
import { clearMockDatabase } from "../support/mock-fs.ts";
import { nudgeWal } from "../support/nudge.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const getCodexDir = () => process.env.KOLU_CODEX_DIR;

let mockCwd: string | null = null;
let mockFixture: CodexFixture | null = null;

export function codexMockCwd(): string {
  if (!mockCwd)
    throw new Error("No Codex mock active — call the mock step first");
  return mockCwd;
}

function cleanup() {
  if (mockCwd && fs.existsSync(mockCwd)) {
    fs.rmSync(mockCwd, { recursive: true, force: true });
  }
  mockCwd = null;
  if (mockFixture && fs.existsSync(mockFixture.rolloutPath)) {
    fs.unlinkSync(mockFixture.rolloutPath);
  }
  mockFixture = null;
  const codexDir = getCodexDir();
  if (codexDir) clearMockDatabase(path.join(codexDir, "state_5.sqlite"));
}

After({ tags: "@codex-mock" }, () => {
  cleanup();
});

async function cdTerminalInto(world: KoluWorld, cwd: string): Promise<void> {
  const marker = `CODEX_CWD_READY_${Date.now()}`;
  await world.page.keyboard.type(`cd ${cwd} && echo ${marker}`);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, marker);
}

function staysResidentAsForegroundCommand(bin: string): string {
  return `${bin} -c "printf '\\033]0;codex\\007'; sleep 99999 ; :"`;
}

async function startFakeAgent(world: KoluWorld, prefix = ""): Promise<void> {
  const bin = process.env.KOLU_FAKE_CODEX_BIN;
  if (!bin) throw new Error("KOLU_FAKE_CODEX_BIN must be set");
  await world.page.keyboard.type(
    `${prefix === "" ? "" : `${prefix} `}${staysResidentAsForegroundCommand(bin)}`,
  );
  await world.page.keyboard.press("Enter");
}

async function startShimmedAgent(world: KoluWorld): Promise<void> {
  const node = process.env.KOLU_FAKE_NODE_BIN;
  if (!node) throw new Error("KOLU_FAKE_NODE_BIN must be set");
  await world.page.keyboard.type(
    `codex() { ${staysResidentAsForegroundCommand(node)}; }`,
  );
  await world.page.keyboard.press("Enter");
  await world.page.keyboard.type("codex");
  await world.page.keyboard.press("Enter");
}

interface CodexMockOpts {
  state: AgentLifecycleState;
  inputTokens?: number;
  cachedInputTokens?: number;
}

async function mockCodexSession(
  world: KoluWorld,
  opts: CodexMockOpts,
  { shimmed, prefix }: { shimmed?: boolean; prefix?: string } = {},
): Promise<void> {
  const codexDir = getCodexDir();
  if (!codexDir) throw new Error("KOLU_CODEX_DIR must be set");

  cleanup();

  mockCwd = fs.mkdtempSync(
    path.join(os.tmpdir(), `kolu-codex-${process.pid}-`),
  );
  mockFixture = writeCodexFixture({ codexDir, cwd: mockCwd, ...opts });

  await cdTerminalInto(world, mockCwd);
  if (shimmed) {
    await startShimmedAgent(world);
  } else {
    await startFakeAgent(world, prefix);
  }
}

When(
  "a Codex session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await mockCodexSession(this, { state: state as AgentLifecycleState });
  },
);

When(
  "a Codex session is mocked with state {string} launched with the prefix {string}",
  async function (this: KoluWorld, state: string, prefix: string) {
    await mockCodexSession(
      this,
      { state: state as AgentLifecycleState },
      { prefix },
    );
  },
);

When(
  "a Codex session is mocked with state {string} via an npm-shimmed CLI",
  async function (this: KoluWorld, state: string) {
    await mockCodexSession(
      this,
      { state: state as AgentLifecycleState },
      { shimmed: true },
    );
  },
);

When(
  "a Codex session is mocked with state {string} and input tokens {int}",
  async function (this: KoluWorld, state: string, inputTokens: number) {
    await mockCodexSession(this, {
      state: state as AgentLifecycleState,
      inputTokens,
    });
  },
);

When(
  "the Codex rollout reports input tokens {int} with cached input tokens {int}",
  async function (
    this: KoluWorld,
    inputTokens: number,
    cachedInputTokens: number,
  ) {
    if (!mockFixture) {
      throw new Error("No Codex fixture to update — call mock step first");
    }
    updateCodexRollout(mockFixture, {
      state: "waiting",
      inputTokens,
      cachedInputTokens,
    });
  },
);

When(
  "the Codex session state changes to {string}",
  async function (this: KoluWorld, state: string) {
    if (!mockFixture) {
      throw new Error("No Codex fixture to update — call mock step first");
    }
    updateCodexRollout(mockFixture, { state: state as AgentLifecycleState });
  },
);

const KOLU_NAMESPACED_NUDGE_THREAD_ID = "__kolu_nudge__";

const CODEX_ONE_WAL_COMMIT_NUDGE_SQL = `BEGIN; INSERT INTO threads (id, rollout_path, cwd, source, archived, updated_at_ms) VALUES ('${KOLU_NAMESPACED_NUDGE_THREAD_ID}', '', '', 'cli', 0, 0); DELETE FROM threads WHERE id = '${KOLU_NAMESPACED_NUDGE_THREAD_ID}'; COMMIT;`;

const nudgeCodex = () =>
  nudgeWal(mockFixture?.dbPath, CODEX_ONE_WAL_COMMIT_NUDGE_SQL);

Then(
  "the tile chrome should show a Codex indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-sub-terminal] [data-testid="agent-indicator"], [data-testid="canvas-tile"] [data-testid="agent-indicator"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-indicator"]',
          );
          return {
            state: el?.getAttribute("data-agent-state") ?? null,
            kind: el?.getAttribute("data-agent-kind") ?? null,
          };
        }),
      isDone: (o) => o.state === expectedState && o.kind === "codex",
      onTick: nudgeCodex,
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
      onTick: nudgeCodex,
      onTimeout: (last, ms) =>
        new Error(
          `Expected context tokens to contain "${expected}", got "${last}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
