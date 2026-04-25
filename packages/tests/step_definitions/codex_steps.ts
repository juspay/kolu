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
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const getCodexDir = () => process.env.KOLU_CODEX_DIR;

let mockCwd: string | null = null;
let mockFixture: CodexFixture | null = null;

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

async function startFakeAgent(world: KoluWorld): Promise<void> {
  // Long-lived foreground process — the bash copy at
  // $KOLU_FAKE_CODEX_BIN runs as the pty's foreground while its `sleep`
  // child holds. Invoked by absolute path, not via PATH: ~/.bashrc on
  // some setups prepends directories that shadow our whitelisted PATH
  // and resolve `codex` to a real install on the host.
  //
  // The trailing `:` is load-bearing: with a single simple command,
  // bash's `-c` optimization execve-replaces itself with the target
  // (comm→"sleep"), breaking the foreground-basename check. A compound
  // command forces bash to stay resident so comm stays "codex".
  //
  // Emitting OSC 2 from inside the body is a stability belt — the
  // reconcile triggered by bash's preexec OSC 2 fires before the new
  // process is actually in the foreground (Linux inotify coalescing +
  // OSC 7 vs title event ordering under parallel-worker load), so we
  // emit a second title event once the fake agent is definitively the
  // foreground process. Without this the detection misses in ~5% of
  // CI runs.
  //
  // `terminal/killAll` in hooks.ts:Before tears the pty down between
  // scenarios, which SIGKILLs the whole tree.
  const bin = process.env.KOLU_FAKE_CODEX_BIN;
  if (!bin) throw new Error("KOLU_FAKE_CODEX_BIN must be set");
  await world.page.keyboard.type(
    `${bin} -c "printf '\\033]0;codex\\007'; sleep 99999 ; :"`,
  );
  await world.page.keyboard.press("Enter");
}

async function startShimmedAgent(world: KoluWorld): Promise<void> {
  // Exercise the preexec-hint-only branch of `matchesAgent`: the
  // command line says `codex` (captured via OSC 633;E so
  // `lastAgentCommandName` resolves to "codex"), but the foreground
  // process's kernel basename is something else ("bash"). Simulates an
  // npm-shimmed `codex` install where the real binary is `node`.
  //
  // Define a shell function named `codex`, then invoke it. The preexec
  // hook fires on the second line with exactly "codex", so
  // `parseAgentCommand` normalizes to "codex".
  //
  // The function body emits a second OSC 2 from inside the subshell —
  // the reconcile triggered by the preexec OSC 2 fires BEFORE the
  // subshell is in the foreground (shellIdle=true at that instant
  // clears lastAgentCommandName), so a second title event with the
  // subshell already running is what lets matchesAgent succeed via
  // the preexec-hint branch.
  await world.page.keyboard.type(
    `codex() { ( printf '\\033]0;codex\\007'; sleep 99999 ; :); }`,
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
  { shimmed }: { shimmed?: boolean } = {},
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
    await startFakeAgent(world);
  }
}

When(
  "a Codex session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await mockCodexSession(this, { state: state as AgentLifecycleState });
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
