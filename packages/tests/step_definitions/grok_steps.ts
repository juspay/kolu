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
import { waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const getGrokDir = () => process.env.KOLU_GROK_DIR;

let mockCwd: string | null = null;
let mockFixture: GrokFixture | null = null;

function cleanup() {
  if (mockCwd && fs.existsSync(mockCwd)) {
    fs.rmSync(mockCwd, { recursive: true, force: true });
  }
  mockCwd = null;
  mockFixture = null;
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
  const marker = `GROK_PID_`;
  // Compound command keeps bash resident as foreground with comm="grok".
  // Echo $$ so the step can write active_sessions.json with the real pid.
  // The -c payload is SINGLE-quoted so the interactive shell does not expand
  // $$; the fake-grok bash expands it to its own pid (matchesAgent basename).
  await world.page.keyboard.type(
    `${bin} -c 'echo ${marker}$$; printf "\\033]0;grok\\007"; sleep 99999 ; :'`,
  );
  await world.page.keyboard.press("Enter");
  const buf = await waitForBufferContains(world.page, marker);
  const m = new RegExp(`${marker}(\\d+)`).exec(buf);
  if (!m?.[1]) throw new Error(`Failed to parse grok pid from buffer: ${buf}`);
  return Number.parseInt(m[1], 10);
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

/** Touch events.jsonl so the session watcher re-reads (mtime nudge). */
function nudgeGrok(): void {
  if (!mockFixture) return;
  try {
    const now = new Date();
    fs.utimesSync(mockFixture.eventsPath, now, now);
  } catch {
    /* ignore */
  }
}

Then(
  "the tile chrome should show a Grok indicator with state {string}",
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
