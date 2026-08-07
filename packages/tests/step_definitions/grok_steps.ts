/**
 * Grok status detection — step definitions.
 *
 * Mocks a Grok session by writing `active_sessions.json` + events/summary
 * under the per-worker `KOLU_GROK_DIR`, then launches the fake `grok`
 * binary so `matchesAgent(state, "grok")` succeeds.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import type { AgentLifecycleState } from "../support/agent-lifecycle.ts";
import {
  type GrokFixture,
  updateGrokFixture,
  writeGrokFixture,
} from "../support/agent-mock-grok.ts";
import {
  ACTIVE_TERMINAL,
  readBufferText,
  waitForBufferContains,
} from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const getGrokDir = () => process.env.KOLU_GROK_DIR;

let mockCwd: string | null = null;
let mockFixture: GrokFixture | null = null;
/** Pid of a fake grok started before its active_sessions row exists. */
let pendingGrokPid: number | null = null;

function cleanup() {
  if (mockCwd && fs.existsSync(mockCwd)) {
    fs.rmSync(mockCwd, { recursive: true, force: true });
  }
  mockCwd = null;
  mockFixture = null;
  pendingGrokPid = null;
  const grokDir = getGrokDir();
  if (grokDir && fs.existsSync(grokDir)) {
    // Wipe session tree between scenarios so leftover dirs don't poison
    // the next match.
    for (const name of ["sessions", "active_sessions.json"]) {
      const p = path.join(grokDir, name);
      if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
    }
  }
}

After({ tags: "@grok-mock" }, () => {
  cleanup();
});

async function cdTerminalInto(world: KoluWorld, cwd: string): Promise<void> {
  const marker = `GROK_CWD_READY_${Date.now()}`;
  await world.page.keyboard.type(`cd ${cwd} && echo ${marker}`);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, marker);
}

/** Launch the fake `grok` binary and return its foreground pid.
 *  The adapter matches via active_sessions.json by pid — printing $$
 *  from inside the resident bash is the load-bearing e2e seam. */
async function startFakeAgent(world: KoluWorld): Promise<number> {
  const bin = process.env.KOLU_FAKE_GROK_BIN;
  if (!bin) throw new Error("KOLU_FAKE_GROK_BIN must be set");
  // Compound command keeps bash resident as foreground with comm="grok".
  // Echo $$ so the step can write active_sessions.json with the real pid.
  // The -c payload is SINGLE-quoted so the interactive shell does not expand
  // $$; the fake-grok bash expands it to its own pid (matchesAgent basename).
  //
  // Wait for GROK_PID=<digits> — NOT the bare prefix — so the typed command
  // line (`…$$…`) cannot satisfy the poll before the process prints its pid.
  await world.page.keyboard.type(
    `${bin} -c 'echo GROK_PID=$$; printf "\\033]0;grok\\007"; sleep 99999 ; :'`,
  );
  await world.page.keyboard.press("Enter");
  const pidRe = /GROK_PID=(\d+)/;
  let pid: number | null = null;
  await pollFor({
    observe: () => readBufferText(world.page, ACTIVE_TERMINAL),
    isDone: (buf) => {
      const m = pidRe.exec(buf ?? "");
      if (!m?.[1]) return false;
      pid = Number.parseInt(m[1], 10);
      return Number.isFinite(pid);
    },
    onTimeout: (last, ms) =>
      new Error(
        `Failed to parse grok pid from buffer after ${ms}ms: ${last ?? ""}`,
      ),
    timeoutMs: POLL_TIMEOUT,
  });
  if (pid === null) throw new Error("grok pid poll succeeded without a pid");
  return pid;
}

async function mockGrokSession(
  world: KoluWorld,
  state: AgentLifecycleState,
): Promise<void> {
  const grokDir = getGrokDir();
  if (!grokDir) throw new Error("KOLU_GROK_DIR must be set");

  cleanup();

  mockCwd = fs.mkdtempSync(path.join(os.tmpdir(), `kolu-grok-${process.pid}-`));
  // Write session tree first (without pid); after the fake binary starts
  // we learn the real pid and rewrite active_sessions.
  mockFixture = writeGrokFixture({ grokDir, cwd: mockCwd, state });

  await cdTerminalInto(world, mockCwd);
  const pid = await startFakeAgent(world);
  mockFixture = writeGrokFixture({
    grokDir,
    cwd: mockCwd,
    state,
    pid,
  });
}

When(
  "a Grok session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await mockGrokSession(this, state as AgentLifecycleState);
  },
);

/** Start fake grok with session files on disk but NO pid in
 *  active_sessions.json — the production race: TUI is foreground, map
 *  row lands later. Stores the pid so a later step can write the row. */
When(
  "a Grok process is running without an active_sessions entry",
  async function (this: KoluWorld) {
    const grokDir = getGrokDir();
    if (!grokDir) throw new Error("KOLU_GROK_DIR must be set");
    cleanup();
    mockCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), `kolu-grok-${process.pid}-`),
    );
    // Session tree + empty active_sessions ([]). No pid row yet.
    mockFixture = writeGrokFixture({
      grokDir,
      cwd: mockCwd,
      state: "thinking",
    });
    await cdTerminalInto(this, mockCwd);
    pendingGrokPid = await startFakeAgent(this);
  },
);

/** padi's command-run reconcile ladder is [0, 75, 300, 1000] ms. Waiting
 *  past that forces any later match to come from externalChanges (the
 *  active_sessions watcher), not from a delayed command-run tick. */
When(
  "{int} ms elapse past the command-run reconcile window",
  async function (this: KoluWorld, ms: number) {
    await new Promise((r) => setTimeout(r, ms));
  },
);

When(
  "the active_sessions entry is written for the running Grok process with state {string}",
  async function (this: KoluWorld, state: string) {
    const grokDir = getGrokDir();
    if (!grokDir) throw new Error("KOLU_GROK_DIR must be set");
    if (!mockCwd) throw new Error("No mock cwd — start the process first");
    if (pendingGrokPid === null) {
      throw new Error("No pending grok pid — start the process first");
    }
    mockFixture = writeGrokFixture({
      grokDir,
      cwd: mockCwd,
      state: state as AgentLifecycleState,
      pid: pendingGrokPid,
    });
  },
);

/** Erase the whole active_sessions map while the mocked Grok keeps running —
 *  what a *concurrent* grok's start/exit does in production (it rewrites the
 *  file wholesale from its own snapshot, dropping every other live row).
 *
 *  The settle is load-bearing, not padding: the clobber must be CONSUMED before
 *  the state flip, or the pre-clobber watcher could publish the new state on its
 *  way out and the scenario would pass without proving anything. padi's
 *  active_sessions watcher debounces 50ms and the production incident retired
 *  the session watcher 53ms after the write, so 1500ms puts the buggy
 *  teardown far in the past by the time the next step runs. */
When(
  "a concurrent Grok clobbers the active_sessions map",
  async function (this: KoluWorld) {
    if (!mockFixture) {
      throw new Error("No Grok fixture to clobber — call mock step first");
    }
    fs.writeFileSync(mockFixture.activeSessionsPath, "[]");
    await new Promise((r) => setTimeout(r, 1500));
  },
);

When(
  "the Grok session state changes to {string}",
  async function (this: KoluWorld, state: string) {
    if (!mockFixture) {
      throw new Error("No Grok fixture to update — call mock step first");
    }
    updateGrokFixture(mockFixture, {
      state: state as AgentLifecycleState,
    });
  },
);

/** Touch events.jsonl so the session watcher re-reads (mtime nudge).
 *  Only for the happy-path Then — the live-transition scenario
 *  deliberately omits this so a dead events watcher cannot hide. */
function nudgeGrok(): void {
  if (!mockFixture) return;
  try {
    const now = new Date();
    fs.utimesSync(mockFixture.eventsPath, now, now);
  } catch {
    /* ignore */
  }
}

async function observeGrokIndicator(world: KoluWorld): Promise<{
  state: string | null;
  kind: string | null;
}> {
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

Then(
  "the tile chrome should show a Grok indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observeGrokIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "grok",
      onTick: nudgeGrok,
      onTimeout: (last, ms) =>
        new Error(
          `Expected Grok indicator state "${expectedState}" (kind=grok), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

/** Assert a live state change without utimes-nudging events.jsonl.
 *  The rewrite from `the Grok session state changes` must be enough for
 *  the session watcher — if only a manual mtime touch lights the tile,
 *  production (append-only events) is broken the same way. */
Then(
  "the tile chrome should follow the Grok state change to {string} without nudging",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observeGrokIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "grok",
      // No onTick nudge — content write alone must rewake.
      onTimeout: (last, ms) =>
        new Error(
          `Expected live Grok state "${expectedState}" without nudge (kind=grok), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
