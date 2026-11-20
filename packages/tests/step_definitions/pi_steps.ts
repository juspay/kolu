import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import type { AgentLifecycleState } from "../support/agent-lifecycle.ts";
import {
  type PiFixture,
  updatePiFixture,
  writePiFixture,
} from "../support/agent-mock-pi.ts";
import { waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const getPiDir = () => process.env.KOLU_PI_DIR;

let mockCwd: string | null = null;
let mockFixture: PiFixture | null = null;

function cleanup() {
  if (mockCwd && fs.existsSync(mockCwd)) {
    fs.rmSync(mockCwd, { recursive: true, force: true });
  }
  mockCwd = null;
  mockFixture = null;
  const piDir = getPiDir();
  if (piDir) {
    const sessions = path.join(piDir, "sessions");
    if (fs.existsSync(sessions)) {
      fs.rmSync(sessions, { recursive: true, force: true });
    }
  }
}

After({ tags: "@pi-mock" }, () => {
  cleanup();
});

async function cdTerminalInto(world: KoluWorld, cwd: string): Promise<void> {
  const marker = `PI_CWD_READY_${Date.now()}`;
  await world.page.keyboard.type(`cd ${cwd} && echo ${marker}`);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, marker);
}

async function startFakeAgent(world: KoluWorld): Promise<void> {
  // Bash copy at $KOLU_FAKE_PI_BIN with a compound `-c` payload so bash stays
  // resident as foreground (comm stays "pi" — a single simple command would
  // let bash's -c execve-optimisation flip comm to "sleep"). One OSC 2 from
  // inside the body so a title event reconciles after the foreground moved.
  const bin = process.env.KOLU_FAKE_PI_BIN;
  if (!bin) throw new Error("KOLU_FAKE_PI_BIN must be set");
  await world.page.keyboard.type(
    `${bin} -c "printf '\\033]0;pi\\007'; sleep 99999 ; :"`,
  );
  await world.page.keyboard.press("Enter");
}

async function mockPiSession(
  world: KoluWorld,
  state: AgentLifecycleState,
): Promise<void> {
  const piDir = getPiDir();
  if (!piDir) throw new Error("KOLU_PI_DIR must be set");

  cleanup();

  mockCwd = fs.mkdtempSync(path.join(os.tmpdir(), `kolu-pi-${process.pid}-`));
  mockFixture = writePiFixture({ piDir, cwd: mockCwd, state });

  await cdTerminalInto(world, mockCwd);
  await startFakeAgent(world);
}

When(
  "a Pi session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await mockPiSession(this, state as AgentLifecycleState);
  },
);

When(
  "a Pi process is running with no session file yet",
  async function (this: KoluWorld) {
    const piDir = getPiDir();
    if (!piDir) throw new Error("KOLU_PI_DIR must be set");
    cleanup();
    mockCwd = fs.mkdtempSync(path.join(os.tmpdir(), `kolu-pi-${process.pid}-`));
    await cdTerminalInto(this, mockCwd);
    await startFakeAgent(this);
  },
);

When(
  "a session file is written for the running Pi process with state {string}",
  async function (this: KoluWorld, state: string) {
    const piDir = getPiDir();
    if (!piDir) throw new Error("KOLU_PI_DIR must be set");
    if (!mockCwd) throw new Error("No mock cwd — start the process first");
    mockFixture = writePiFixture({
      piDir,
      cwd: mockCwd,
      state: state as AgentLifecycleState,
    });
  },
);

When(
  "the Pi session state changes to {string}",
  async function (this: KoluWorld, state: string) {
    if (!mockFixture) {
      throw new Error("No Pi fixture to update — call mock step first");
    }
    updatePiFixture(mockFixture, state as AgentLifecycleState);
  },
);

async function observePiIndicator(world: KoluWorld): Promise<{
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
  "the tile chrome should show a Pi indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observePiIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "pi",
      onTimeout: (last, ms) =>
        new Error(
          `Expected Pi indicator state "${expectedState}" (kind=pi), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the tile chrome should follow the Pi state change to {string} without nudging",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observePiIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "pi",
      onTimeout: (last, ms) =>
        new Error(
          `Expected live Pi state "${expectedState}" without nudge (kind=pi), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
