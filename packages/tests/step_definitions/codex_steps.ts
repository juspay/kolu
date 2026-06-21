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
import { nudgeWal } from "../support/nudge.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const getCodexDir = () => process.env.KOLU_CODEX_DIR;

let mockCwd: string | null = null;
let mockFixture: CodexFixture | null = null;

/** The directory the active Codex mock `cd`'d the terminal into — the cwd the
 *  threads-DB fixture is keyed on. Exposed so the sleeping-terminals journey can
 *  assert a WOKEN terminal re-spawned in this SAVED cwd (its fake `codex` binary
 *  is reached by absolute path and the bare `codex resume --last` resume form
 *  carries no title-printf, so the mock can't re-light its indicator from the
 *  resume — the woken shell's own `pwd` is the cwd proof instead). Throws if no
 *  mock is active, so a misordered step fails loudly rather than matching null. */
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
  // Emit one OSC 2 from inside the subshell body (after the kernel has
  // moved the foreground process group to the subshell) so the title
  // event reconcile in `agent.ts` reads a settled foregroundPid and
  // `readForegroundBasename() === "codex"`. The trailing `:` keeps bash
  // resident as the foreground after the body's last command — without
  // it, bash's `-c` optimisation execve-replaces itself with the final
  // simple command and the kernel basename flips to `sleep`, breaking
  // the foreground-basename check.
  //
  // The complementary server-side bootstrap is `agent.ts`'s
  // `commandRun` retry chain at [0, 75, 300, 1000] ms — that's the
  // load-bearing piece for the npm-shimmed-CLI race where the kernel
  // basename is `node` and detection rides entirely on
  // `lastAgentCommandName`. The body OSC 2 here is the simpler
  // foreground-basename path, which production agents would emit too.
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

/** Mock-side WAL nudge for the codex `threads` DB. The INSERT/DELETE
 *  is wrapped in BEGIN/COMMIT so it produces exactly one WAL commit
 *  frame — without the explicit transaction, individual statements
 *  could be coalesced or split into different frames depending on
 *  SQLite's autocommit/journal state. The transient `__kolu_nudge__`
 *  row is namespaced so production code (which never inserts ids
 *  starting with `__kolu_`) can't mistake it for a real session row
 *  if a concurrent reader sees it inside the WAL window. */
const CODEX_NUDGE_SQL = `BEGIN; INSERT INTO threads (id, rollout_path, cwd, source, archived, updated_at_ms) VALUES ('__kolu_nudge__', '', '', 'cli', 0, 0); DELETE FROM threads WHERE id = '__kolu_nudge__'; COMMIT;`;

const nudgeCodex = () => nudgeWal(mockFixture?.dbPath, CODEX_NUDGE_SQL);

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
