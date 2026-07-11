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
import {
  After,
  type ITestCaseHookParameter,
  Status,
  Then,
  When,
} from "@cucumber/cucumber";
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
    /** Extra settle (ms) after the ready marker before typing — the TUI accepts
     *  keys only once its input is live. Slow-booting agents (opencode resolves
     *  its provider/model) need more, else the prompt is typed into a not-ready
     *  TUI and lost (no model turn, no session state). Defaults to 3000. */
    settleMs?: number;
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
  Opencode: {
    kind: "opencode",
    binEnv: "KOLU_E2E_OPENCODE_BIN",
    marker: "opencode",
    // opencode writes a channel-suffixed SQLite DB (opencode-stable.db) here.
    sessionDir: path.join(".local", "share", "opencode"),
    sessionGlobs: [[/^opencode.*\.db$/, "."]],
    // opencode's TUI paints "opencode" early but isn't input-ready until it has
    // resolved its provider/model — CI evidence showed the prompt typed at 3s
    // was lost (no chat-completion request, no session state). Give it 12s.
    settleMs: 12_000,
  },
  // The NODE-distributed codex (npm runtime) — same agent (kind "codex"), but
  // launched from KOLU_E2E_CODEX_NODE_BIN so its foreground basename is `node`,
  // NOT `codex`. Detection then MUST come from the OSC 633;E command-hint
  // (readForegroundBasename can't match), which is the whole point of the
  // npm-shim scenario. Reads the same seeded ~/.codex config as native codex.
  CodexNpm: {
    kind: "codex",
    binEnv: "KOLU_E2E_CODEX_NODE_BIN",
    marker: "OpenAI Codex",
    sessionDir: ".codex",
    sessionGlobs: [
      [/^state_\d+\.sqlite$/, "."],
      [/rollout-.*\.jsonl$/, "sessions"],
    ],
  },
  Grok: {
    kind: "grok",
    binEnv: "KOLU_E2E_GROK_BIN",
    // Status-bar string the ready Grok Build TUI always paints.
    marker: "Grok Build",
    sessionDir: ".grok",
    // active_sessions.json (the live session map) directly under ~/.grok, plus
    // an events.jsonl phase stream under sessions/<encodeCwd>/<uuid>/.
    sessionGlobs: [
      [/^active_sessions\.json$/, "."],
      [/^events\.jsonl$/, "sessions"],
    ],
  },
};

function agent(word: string) {
  const a = AGENTS[word];
  assert.ok(
    a,
    `unknown real agent "${word}" (expected Codex, Claude, Opencode, or Grok)`,
  );
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
async function cleanupAgentSessions(word: string) {
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
    const p = path.join(dir, entry);
    // Retry on ENOTEMPTY/EBUSY: a lingering agent subprocess (e.g. codex's
    // `.tmp/` writer) can re-populate a directory mid-removal — after killAll but
    // before its own teardown flushes — so the recursive rmSync races the write.
    // A short backoff lets the write settle; `force` already swallows ENOENT.
    for (let attempt = 0; ; attempt++) {
      try {
        fs.rmSync(p, { recursive: true, force: true });
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }
}

After({ tags: "@codex-real" }, () => cleanupAgentSessions("Codex"));
After({ tags: "@codex-npm-real" }, () => cleanupAgentSessions("CodexNpm"));
After({ tags: "@claude-real" }, () => cleanupAgentSessions("Claude"));
After({ tags: "@opencode-real" }, () => cleanupAgentSessions("Opencode"));
After({ tags: "@grok-real" }, () => cleanupAgentSessions("Grok"));
After({ tags: "@claude-cli-real" }, () => cleanupAgentSessions("Claude"));

// Evidence via the LANE (no local runs): on a real-agent failure, dump the padi
// provider log tail + a listing of the throwaway home's agent data dirs into
// the CI log, so a flake is diagnosable from CI alone. Registered LAST so it
// runs FIRST (cucumber runs After hooks in reverse) — before the cleanup hooks
// above wipe the dirs.
After(
  { tags: "@real-agent" },
  async function (this: KoluWorld, scenario: ITestCaseHookParameter) {
    if (scenario.result?.status !== Status.FAILED) return;
    const out: string[] = ["\n===REAL-AGENT-FAILURE-EVIDENCE==="];
    const padiDir = process.env.KOLU_E2E_PADI_STATE_DIR;
    if (padiDir) {
      for (const f of ["padi.stderr.log", "padi.log"]) {
        try {
          const tail = fs
            .readFileSync(path.join(padiDir, f), "utf8")
            .split("\n")
            .slice(-80)
            .join("\n");
          out.push(`--- ${f} (tail) ---\n${tail}`);
        } catch {
          // absent — the daemon may not have written this file
        }
      }
    }
    const home = process.env.KOLU_E2E_FIXTURE_HOME;
    if (home) {
      for (const d of [
        path.join(".local", "share", "opencode"),
        ".codex",
        ".claude",
        ".grok",
      ]) {
        const dir = path.join(home, d);
        try {
          const entries = fs.readdirSync(dir, { recursive: true }).map(String);
          out.push(`--- ls ~/${d} ---\n${entries.join("\n") || "(empty)"}`);
        } catch {
          out.push(`--- ls ~/${d} --- (missing)`);
        }
      }
      // Dump opencode's stored message/part JSON: the definitive record of
      // whether the model actually emitted a tool call (a `tool` part with a
      // `bash` name) or replied text directly — the difference between "model
      // never called the tool" and "kolu missed a transient tool_use window".
      const storage = path.join(home, ".local", "share", "opencode", "storage");
      try {
        for (const rel of fs.readdirSync(storage, { recursive: true })) {
          const p = path.join(storage, String(rel));
          if (!p.endsWith(".json")) continue;
          try {
            const body = fs.readFileSync(p, "utf8");
            out.push(`--- storage/${rel} ---\n${body.slice(0, 4000)}`);
          } catch {
            // directory entry or unreadable — skip
          }
        }
      } catch {
        out.push("--- opencode storage --- (missing)");
      }
    }
    // The FINAL rendered TUI at failure time (the page is still live in the After
    // hook) — shows the whole conversation, including any tool-execution block.
    try {
      const { readBufferText } = await import("../support/buffer.ts");
      out.push(
        `--- terminal buffer (final, at failure) ---\n${await readBufferText(this.page)}`,
      );
    } catch {
      // page gone / unreadable
    }
    out.push("===END-EVIDENCE===");
    // eslint-disable-next-line no-console
    console.log(out.join("\n"));
  },
);

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
    // The TUIs accept keystrokes only a beat AFTER the header paints; a short
    // settle dropped the prompt. Type with a small per-key delay (a too-fast
    // burst is dropped), then a discrete Enter.
    await new Promise((r) => setTimeout(r, a.settleMs ?? 3000));
    await this.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await this.page.keyboard.type(prompt, { delay: 25 });
    await new Promise((r) => setTimeout(r, 500));
    await this.page.keyboard.press("Enter");
    // Return IMMEDIATELY — the working-state assertion must start polling now,
    // while the turn is in flight. A fast box (Apple Silicon) runs the tiny
    // model in well under a second, so any post-submit delay here would let the
    // whole thinking→waiting arc elapse before the assertion even begins (it
    // did: a 6s capture wait raced all three agents to "waiting" on darwin).
    // Failure evidence comes from the After hook's live-page buffer read, not a
    // mid-flight snapshot.
  },
);

// --- CLI-feature / user-action interactions (stage-5 "(b)" real attempts) ---
// These drive a CLI feature or a user action whose resulting state is STABLE
// (persists until the next action) — unlike a transient mid-turn state — so a
// real turn on a dumb model can still exercise kolu's detection of it.

When(
  "I interrupt the running {word} turn with Escape",
  async function (this: KoluWorld, _word: string) {
    // The user pressing Esc during a turn — claude writes an interrupt marker to
    // the transcript, which deriveState reads as waiting.
    await this.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await this.page.keyboard.press("Escape");
  },
);

When(
  "I run the {word} slash command {string}",
  async function (this: KoluWorld, _word: string, command: string) {
    // Type a slash command (e.g. /compact, /fork <prompt>) and submit it.
    await this.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await this.page.keyboard.type(command, { delay: 25 });
    await new Promise((r) => setTimeout(r, 500));
    await this.page.keyboard.press("Enter");
  },
);

When(
  "I exit the real {word} agent",
  async function (this: KoluWorld, _word: string) {
    // Bring the CLI to an idle prompt, THEN exit. Claude Code needs Ctrl-C twice
    // FROM IDLE (the first paints "Press Ctrl-C again to exit", the second
    // quits); a Ctrl-C during a live turn only interrupts it. So: Escape to end
    // any in-flight turn, settle to idle, then a burst of Ctrl-C. Once the
    // process leaves the foreground its session watcher retires and the
    // indicator clears.
    await this.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await this.page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 2000));
    for (let i = 0; i < 3; i++) {
      await this.page.keyboard.press("Control+c");
      await new Promise((r) => setTimeout(r, 400));
    }
  },
);

Then(
  "the tile chrome should show no {word} indicator within {int} seconds",
  async function (this: KoluWorld, word: string, seconds: number) {
    const { kind } = agent(word);
    await pollFor({
      observe: () => readIndicator(this),
      // Detection cleared: the indicator no longer carries this agent's kind.
      isDone: (o) => o.kind !== kind,
      onTimeout: (last, ms) =>
        new Error(
          `Expected the ${word} indicator (kind=${kind}) to clear within ${ms}ms, still kind="${last?.kind ?? null}" state="${last?.state ?? null}"`,
        ),
      timeoutMs: seconds * 1000,
    });
  },
);

When(
  "I exit and resume the real {word} agent",
  async function (this: KoluWorld, word: string) {
    // Exit the CLI (double Ctrl-C) and relaunch it with --continue, which resumes
    // the most recent session for the cwd — the previous-session-JSONL path.
    const a = agent(word);
    const bin = process.env[a.binEnv];
    assert.ok(bin, `${a.binEnv} unset — hooks.ts should resolve the CLI path.`);
    await this.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await this.page.keyboard.press("Control+c");
    await new Promise((r) => setTimeout(r, 300));
    await this.page.keyboard.press("Control+c");
    await new Promise((r) => setTimeout(r, 1500));
    await this.terminalRun(`${bin} --continue`);
    await waitForBufferContains(this.page, a.marker, { timeout: 30_000 });
    await new Promise((r) => setTimeout(r, a.settleMs ?? 3000));
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

// Detection-only assert (state-agnostic): the indicator carries the agent's
// kind, i.e. kolu recognized the real CLI as that agent — regardless of which
// live state it's in. Used by claude-real (srid's ruling B-prime), whose
// transient state is unobservable-by-construction / provider-flaky on a fast
// ollama turn (see claude-real.feature + juspay/kolu#1754); the state machine
// itself is unit-tested.
Then(
  "the tile chrome should show a {word} indicator within {int} seconds",
  async function (this: KoluWorld, word: string, seconds: number) {
    const { kind } = agent(word);
    await pollFor({
      observe: () => readIndicator(this),
      isDone: (o) => o.kind === kind,
      onTimeout: (last, ms) =>
        new Error(
          `Expected ${word} indicator (kind=${kind}) to appear within ${ms}ms, got kind="${last?.kind ?? null}" state="${last?.state ?? null}"`,
        ),
      timeoutMs: seconds * 1000,
    });
  },
);

// Behavioral token assertion (srid's ratified send-observe-delta shape): after a
// real turn, kolu's context-token badge shows a NON-ZERO count — the turn
// consumed tokens and the sensor reported them. No magic number: a fresh session
// starts with no usage, so "non-zero" IS "increased". The exact arithmetic
// (input_tokens is per-turn not cumulative; cached tokens aren't double-counted)
// stays a unit test — a real turn can't pin an exact figure deterministically.
Then(
  "the tile chrome should show a non-zero {word} context-token count within {int} seconds",
  async function (this: KoluWorld, word: string, seconds: number) {
    agent(word); // validate the agent word
    await pollFor({
      observe: () =>
        this.page.evaluate(() => {
          const el = document.querySelector(
            '[data-testid="canvas-tile"] [data-testid="agent-context-tokens"], [data-testid="mobile-tile-titlebar"] [data-testid="agent-context-tokens"]',
          );
          return el?.textContent?.trim() ?? null;
        }),
      // A non-zero digit anywhere → tokens were counted (e.g. "1.2K", "512").
      // "0" / "0K" / absent → no usage reported yet.
      isDone: (t) => t != null && /[1-9]/.test(t),
      onTimeout: (last, ms) =>
        new Error(
          `Expected a non-zero ${word} context-token count within ${ms}ms, got "${last}"`,
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
