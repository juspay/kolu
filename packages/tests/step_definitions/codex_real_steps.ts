/**
 * Real-codex step defs — a genuine `codex` CLI, pointed at a locally-served
 * ollama model, driven inside a kolu terminal (codex-real.feature). This is the
 * UNCONDITIONAL live-state path (srid's ruling): the whole e2e suite runs ollama
 * on both platforms, and codex's working→done detection is asserted against the
 * real CLI + real model with no fixture writes. hooks.ts seeds the throwaway
 * home's codex config and exposes KOLU_E2E_FIXTURE_HOME / KOLU_E2E_CODEX_BIN;
 * the crafted-fixture regression guards stay mock in codex.feature.
 */

import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import { waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import type { KoluWorld } from "../support/world.ts";

/** The throwaway home hooks.ts seeded with the codex → ollama config. Steps
 *  run in the cucumber process (its own HOME is the developer's), so the real
 *  default codex path lives under THIS dir, not `os.homedir()`. */
function fixtureHome(): string {
  const home = process.env.KOLU_E2E_FIXTURE_HOME;
  assert.ok(
    home,
    "KOLU_E2E_FIXTURE_HOME unset — the e2e suite runs via `just test` / `just test-quick`, which start ollama and seed the throwaway home.",
  );
  return home;
}

// Wipe the real codex session state between scenarios so a later scenario —
// real OR the @codex-mock regression guards, which share `<fixtureHome>/.codex`
// — starts clean. Keep `config.toml` (seeded once at BeforeAll); remove
// everything else codex wrote (state_5.sqlite, sessions/, logs, caches). The
// live codex TUI is torn down by hooks.ts's between-scenario killAll.
After({ tags: "@codex-real" }, () => {
  const home = process.env.KOLU_E2E_FIXTURE_HOME;
  if (!home) return;
  const codexDir = path.join(home, ".codex");
  let entries: string[];
  try {
    entries = fs.readdirSync(codexDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === "config.toml") continue;
    fs.rmSync(path.join(codexDir, entry), { recursive: true, force: true });
  }
});

/** Read the codex tile indicator (same selector the mock codex step uses). */
function readCodexIndicator(world: KoluWorld) {
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

When(
  "I launch the real Codex agent with prompt {string}",
  async function (this: KoluWorld, prompt: string) {
    // Launch the interactive TUI (NOT `codex exec` — that writes threads with
    // source='exec', which kolu's provider filters out; the TUI writes
    // source='cli', the row `findSessionByDirectory` matches). The throwaway
    // home is pre-trusted in config (hooks.ts), so no folder-trust gate.
    // Launch by ABSOLUTE path — the PTY's rc resets PATH and drops the
    // nix-store codex, so a bare `codex` is not found (hooks.ts resolves the
    // real path into KOLU_E2E_CODEX_BIN, mirroring the mock's fake-bin trick).
    const codexBin = process.env.KOLU_E2E_CODEX_BIN;
    assert.ok(
      codexBin,
      "KOLU_E2E_CODEX_BIN unset — hooks.ts REAL_AGENT should resolve codex's path.",
    );
    await this.terminalRun(codexBin);
    // The ready screen renders "OpenAI Codex (vX.Y.Z)" once the (pre-trusted,
    // see hooks.ts) session is up — the stable readiness marker. On failure,
    // fold the rendered terminal buffer into the error so a headless CI log
    // shows what codex actually painted (a crash, a gate, nothing).
    try {
      await waitForBufferContains(this.page, "OpenAI Codex", {
        timeout: 30_000,
      });
    } catch (err) {
      const { readBufferText } = await import("../support/buffer.ts");
      const buffer = await readBufferText(this.page);
      throw new Error(
        `codex readiness marker "OpenAI Codex" not found in 30s. Rendered terminal buffer:\n---\n${buffer}\n---\n(underlying: ${String(err)})`,
      );
    }
    // Codex's Rust TUI only starts accepting keystrokes a beat AFTER its header
    // paints; an 800ms settle dropped the prompt entirely (input box not yet
    // live). 3s is the validated margin. Type with a small per-key delay (the
    // TUI drops a too-fast burst), then submit with a discrete Enter.
    await new Promise((r) => setTimeout(r, 3000));
    await this.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await this.page.keyboard.type(prompt, { delay: 25 });
    await new Promise((r) => setTimeout(r, 500));
    await this.page.keyboard.press("Enter");
  },
);

Then(
  "the tile chrome should show a Codex indicator with state {string} within {int} seconds",
  async function (this: KoluWorld, expectedState: string, seconds: number) {
    await pollFor({
      observe: () => readCodexIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "codex",
      onTimeout: (last, ms) =>
        new Error(
          `Expected Codex indicator state "${expectedState}" (kind=codex), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: seconds * 1000,
    });
  },
);

/** Read the codex terminal's dock-row bucket, or null if no row yet. */
function readCodexDockBucket(world: KoluWorld) {
  return world.page.evaluate(() => {
    const row = document.querySelector('[data-testid="dock-row"]');
    return row?.getAttribute("data-bucket") ?? null;
  });
}

Then(
  "the dock should reflect the Codex agent in the {string} bucket within {int} seconds",
  async function (this: KoluWorld, bucket: string, seconds: number) {
    await this.page.waitForSelector(
      `[data-testid="dock-row"][data-bucket="${bucket}"]`,
      { state: "attached", timeout: seconds * 1000 },
    );
  },
);

// The DONE dock state. codex finishing → state "waiting", which the shared
// projection RANKS idle but PAINTS awaiting (.claude/rules/dock-fleet-mirror.md:
// the load-bearing order≠colour split). The dock row's data-bucket is the paint
// fold, so a JUST-finished turn reads "awaiting" — but the dock's idleClassifier
// ages a quiet row into "idle" after its activity window, and the turn may have
// aged by the time this step runs. Both mean "the agent finished," so accept
// either; asserting one exact literal would be racing the activity clock.
Then(
  "the dock should reflect the Codex agent as done within {int} seconds",
  async function (this: KoluWorld, seconds: number) {
    const done = new Set(["awaiting", "idle"]);
    await pollFor({
      observe: () => readCodexDockBucket(this),
      isDone: (b) => b !== null && done.has(b),
      onTimeout: (last, ms) =>
        new Error(
          `Expected Codex dock row in a done bucket (awaiting|idle), got "${last}" after ${ms}ms`,
        ),
      timeoutMs: seconds * 1000,
    });
  },
);

Then(
  "a real Codex session file should exist at the default path",
  async function (this: KoluWorld) {
    const codexDir = path.join(fixtureHome(), ".codex");
    // The threads DB kolu reads: `state_<N>.sqlite` under `~/.codex`. Its mere
    // existence at the real default path (rooted in the throwaway home) is the
    // assertion — a real CLI wrote where kolu reads by default.
    const dbs = fs
      .readdirSync(codexDir)
      .filter((f) => /^state_\d+\.sqlite$/.test(f));
    assert.ok(
      dbs.length > 0,
      `no state_<N>.sqlite under ${codexDir} — codex did not write its session DB at the default path (found: ${fs.readdirSync(codexDir).join(", ") || "nothing"})`,
    );
    // And the rollout JSONL kolu tails for state, under the default sessions
    // tree. `recursive` readdir is fine on the Node the suite already targets.
    const sessionsDir = path.join(codexDir, "sessions");
    const rollouts = fs.existsSync(sessionsDir)
      ? fs
          .readdirSync(sessionsDir, { recursive: true })
          .map(String)
          .filter((f) => /rollout-.*\.jsonl$/.test(f))
      : [];
    assert.ok(
      rollouts.length > 0,
      `no rollout-*.jsonl under ${sessionsDir} — codex recorded no session transcript at the default path`,
    );
  },
);
