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

async function startFakeAgent(world: KoluWorld): Promise<number> {
  const bin = process.env.KOLU_FAKE_GROK_BIN;
  if (!bin) throw new Error("KOLU_FAKE_GROK_BIN must be set");
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
  "a Grok process is running without an active_sessions entry",
  async function (this: KoluWorld) {
    const grokDir = getGrokDir();
    if (!grokDir) throw new Error("KOLU_GROK_DIR must be set");
    cleanup();
    mockCwd = fs.mkdtempSync(
      path.join(os.tmpdir(), `kolu-grok-${process.pid}-`),
    );
    mockFixture = writeGrokFixture({
      grokDir,
      cwd: mockCwd,
      state: "thinking",
    });
    await cdTerminalInto(this, mockCwd);
    pendingGrokPid = await startFakeAgent(this);
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

const CLOBBER_CONSUMED_SETTLE_MS = 1500;

When(
  "a concurrent Grok clobbers the active_sessions map",
  async function (this: KoluWorld) {
    if (!mockFixture) {
      throw new Error("No Grok fixture to clobber — call mock step first");
    }
    fs.writeFileSync(mockFixture.activeSessionsPath, "[]");
    await new Promise((r) => setTimeout(r, CLOBBER_CONSUMED_SETTLE_MS));
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

function nudgeGrok(): void {
  if (!mockFixture) return;
  const now = new Date();
  fs.utimesSync(mockFixture.eventsPath, now, now);
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

Then(
  "the tile chrome should follow the Grok state change to {string} without nudging",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observeGrokIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "grok",
      onTimeout: (last, ms) =>
        new Error(
          `Expected live Grok state "${expectedState}" without nudge (kind=grok), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
