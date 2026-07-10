/**
 * Real-agent step defs — a genuine agent CLI (codex, claude) pointed at a
 * locally-served ollama model, driven inside a kolu terminal. This is the
 * UNCONDITIONAL live-state path (srid's ruling): the whole e2e suite runs ollama
 * on both platforms, and each agent's working→done detection is asserted against
 * the real CLI + real model with no fixture writes. hooks.ts seeds each agent's
 * config in the throwaway home and exposes KOLU_E2E_<AGENT>_BIN + the home; the
 * crafted-fixture regression guards live as unit tests, not e2e mocks.
 *
 * Steps are parameterized by the agent's display word (`Codex` / `Claude`) so
 * codex-real.feature and claude-real.feature share one definition set.
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import type { KoluWorld } from "../support/world.ts";

/** Per-agent knobs. `kind` is the AgentInfo discriminant kolu paints on the
 *  indicator; `binEnv` holds the absolute CLI path hooks.ts resolved; `marker`
 *  is the stable string the ready TUI paints; `sessionGlobs` are the real
 *  default paths (under the throwaway home) the CLI writes its session to. */
const AGENTS: Record<
  string,
  {
    kind: string;
    binEnv: string;
    marker: string;
    sessionDir: string;
    sessionGlobs: [RegExp, string][];
  }
> = {
  Codex: {
    kind: "codex",
    binEnv: "KOLU_E2E_CODEX_BIN",
    marker: "OpenAI Codex",
    sessionDir: ".codex",
    // state_<N>.sqlite under ~/.codex, plus a rollout under sessions/.
    sessionGlobs: [
      [/^state_\d+\.sqlite$/, "."],
      [/rollout-.*\.jsonl$/, "sessions"],
    ],
  },
  Claude: {
    kind: "claude-code",
    binEnv: "KOLU_E2E_CLAUDE_BIN",
    marker: "Claude Code",
    sessionDir: ".claude",
    // sessions/<pid>.json + a projects/<cwd>/<uuid>.jsonl transcript.
    sessionGlobs: [
      [/^\d+\.json$/, "sessions"],
      [/\.jsonl$/, "projects"],
    ],
  },
};

function agent(word: string) {
  const a = AGENTS[word];
  assert.ok(a, `unknown real agent "${word}" (expected Codex or Claude)`);
  return a;
}

/** The throwaway home hooks.ts seeded with the agent → ollama config. Steps run
 *  in the cucumber process (its own HOME is the developer's), so the real
 *  default agent paths live under THIS dir, not `os.homedir()`. */
function fixtureHome(): string {
  const home = process.env.KOLU_E2E_FIXTURE_HOME;
  assert.ok(
    home,
    "KOLU_E2E_FIXTURE_HOME unset — the e2e suite runs via `just test` / `just test-quick`, which start ollama and seed the throwaway home.",
  );
  return home;
}

/** Read the agent tile indicator (same selector the mock steps use). */
function readIndicator(world: KoluWorld) {
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

/** Read the single agent dock-row's bucket, or null if no row yet. */
function readDockBucket(world: KoluWorld) {
  return world.page.evaluate(() => {
    const row = document.querySelector('[data-testid="dock-row"]');
    return row?.getAttribute("data-bucket") ?? null;
  });
}

// Wipe the real agent session state between scenarios so a later scenario starts
// clean; keep the seeded config (codex config.toml / claude settings.json). The
// live TUI is torn down by hooks.ts's between-scenario killAll.
function cleanupAgentSessions(word: string) {
  const home = process.env.KOLU_E2E_FIXTURE_HOME;
  if (!home) return;
  const dir = path.join(home, agent(word).sessionDir);
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return;
  }
  const keep = new Set(["config.toml", "settings.json"]);
  for (const entry of entries) {
    if (keep.has(entry)) continue;
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

After({ tags: "@codex-real" }, () => cleanupAgentSessions("Codex"));
After({ tags: "@claude-real" }, () => cleanupAgentSessions("Claude"));

When(
  "I launch the real {word} agent with prompt {string}",
  async function (this: KoluWorld, word: string, prompt: string) {
    const a = agent(word);
    // Launch the interactive TUI by ABSOLUTE path — the PTY's rc resets PATH and
    // drops the nix-store binary, so a bare name is "command not found"
    // (hooks.ts resolves the real path into KOLU_E2E_<AGENT>_BIN, mirroring the
    // mock fake-bin trick). The throwaway home is pre-configured (trust /
    // onboarding cleared), so the CLI boots straight to its prompt.
    const bin = process.env[a.binEnv];
    assert.ok(bin, `${a.binEnv} unset — hooks.ts should resolve the CLI path.`);
    await this.terminalRun(bin);
    // Wait for the ready TUI to paint its header before typing. On failure fold
    // the rendered buffer into the error so a headless CI log shows what the CLI
    // actually painted (a crash, a gate, nothing).
    try {
      await waitForBufferContains(this.page, a.marker, { timeout: 30_000 });
    } catch (err) {
      const { readBufferText } = await import("../support/buffer.ts");
      const buffer = await readBufferText(this.page);
      throw new Error(
        `${word} readiness marker "${a.marker}" not found in 30s. Rendered terminal buffer:\n---\n${buffer}\n---\n(underlying: ${String(err)})`,
      );
    }
    // The Rust/Ink TUIs only accept keystrokes a beat AFTER the header paints; a
    // short settle dropped the prompt. 3s is the validated margin. Type with a
    // small per-key delay (a too-fast burst is dropped), then a discrete Enter.
    await new Promise((r) => setTimeout(r, 3000));
    await this.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await this.page.keyboard.type(prompt, { delay: 25 });
    await new Promise((r) => setTimeout(r, 500));
    await this.page.keyboard.press("Enter");
  },
);

Then(
  "the tile chrome should show a {word} indicator with state {string} within {int} seconds",
  async function (
    this: KoluWorld,
    word: string,
    expectedState: string,
    seconds: number,
  ) {
    const { kind } = agent(word);
    await pollFor({
      observe: () => readIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === kind,
      onTimeout: (last, ms) =>
        new Error(
          `Expected ${word} indicator state "${expectedState}" (kind=${kind}), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: seconds * 1000,
    });
  },
);

Then(
  "the dock should reflect the {word} agent in the {string} bucket within {int} seconds",
  async function (
    this: KoluWorld,
    _word: string,
    bucket: string,
    seconds: number,
  ) {
    await this.page.waitForSelector(
      `[data-testid="dock-row"][data-bucket="${bucket}"]`,
      { state: "attached", timeout: seconds * 1000 },
    );
  },
);

// The DONE dock state. A finished turn → state "waiting", which the shared
// projection RANKS idle but PAINTS awaiting (.claude/rules/dock-fleet-mirror.md:
// the load-bearing order≠colour split). The dock row's data-bucket is the paint
// fold, so a just-finished turn reads "awaiting" — but the dock's idleClassifier
// ages a quiet row into "idle" after its activity window, and the turn may have
// aged by the time this step runs. Both mean "the agent finished," so accept
// either; asserting one exact literal would be racing the activity clock.
Then(
  "the dock should reflect the {word} agent as done within {int} seconds",
  async function (this: KoluWorld, _word: string, seconds: number) {
    const done = new Set(["awaiting", "idle"]);
    await pollFor({
      observe: () => readDockBucket(this),
      isDone: (b) => b !== null && done.has(b),
      onTimeout: (last, ms) =>
        new Error(
          `Expected dock row in a done bucket (awaiting|idle), got "${last}" after ${ms}ms`,
        ),
      timeoutMs: seconds * 1000,
    });
  },
);

Then(
  "a real {word} session file should exist at the default path",
  async function (this: KoluWorld, word: string) {
    const a = agent(word);
    const dir = path.join(fixtureHome(), a.sessionDir);
    for (const [pattern, sub] of a.sessionGlobs) {
      const searchDir = sub === "." ? dir : path.join(dir, sub);
      const found = fs.existsSync(searchDir)
        ? fs
            .readdirSync(searchDir, { recursive: true })
            .map(String)
            .some((f) => pattern.test(path.basename(f)))
        : false;
      assert.ok(
        found,
        `no file matching ${pattern} under ${searchDir} — ${word} did not write its session at the real default path (dir contents: ${fs.existsSync(searchDir) ? fs.readdirSync(searchDir).join(", ") : "missing"})`,
      );
    }
  },
);
