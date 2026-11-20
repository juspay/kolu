import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import type { AgentLifecycleState } from "../support/agent-lifecycle.ts";
import {
  appendOmpTodoList,
  OMP_GONE_MARKER,
  OMP_HEARD_MARKER,
  OMP_UP_MARKER,
  type OmpFixture,
  ompMockPayload,
  ompTranscriptPath,
  stageOmpPrompt,
  updateOmpFixture,
} from "../support/agent-mock-omp.ts";
import { readBufferText, waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const getOmpDir = () => process.env.KOLU_OMP_DIR;

let mockCwd: string | null = null;
let mockFixture: OmpFixture | null = null;
let mockStagePath: string | null = null;
let mockQuietFlag: string | null = null;
let promptCounter = 0;

function cleanup() {
  if (mockCwd && fs.existsSync(mockCwd)) {
    fs.rmSync(mockCwd, { recursive: true, force: true });
  }
  mockCwd = null;
  mockFixture = null;
  mockStagePath = null;
  mockQuietFlag = null;
  const ompDir = getOmpDir();
  if (ompDir) {
    for (const sub of ["sessions", "terminal-sessions"]) {
      const dir = path.join(ompDir, sub);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
}

After({ tags: "@omp-mock" }, () => {
  cleanup();
});

async function cdTerminalInto(world: KoluWorld, cwd: string): Promise<void> {
  const marker = `OMP_CWD_READY_${Date.now()}`;
  await world.page.keyboard.type(`cd ${cwd} && echo ${marker}`);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, marker);
}

async function startFakeAgent(
  world: KoluWorld,
  fixture: OmpFixture,
  opts: { holdStarting: boolean } = { holdStarting: false },
): Promise<void> {
  const bin = process.env.KOLU_FAKE_OMP_BIN;
  if (!bin) throw new Error("KOLU_FAKE_OMP_BIN must be set");
  const ompDir = getOmpDir();
  if (!ompDir) throw new Error("KOLU_OMP_DIR must be set");
  if (!mockCwd || !mockStagePath) {
    throw new Error("No omp mock directory — call the mock step first");
  }
  mockQuietFlag = opts.holdStarting ? path.join(mockCwd, "omp-settled") : null;
  const program = path.join(mockCwd, "omp-stand-in.sh");
  fs.writeFileSync(
    program,
    ompMockPayload({
      breadcrumbDir: path.join(ompDir, "terminal-sessions"),
      transcriptPath: fixture.transcriptPath,
      stagePath: mockStagePath,
      ...(mockQuietFlag === null ? {} : { bootPaintUntil: mockQuietFlag }),
    }),
  );
  await world.page.keyboard.type(`${bin} ${program}`);
  await world.page.keyboard.press("Enter");
  try {
    await waitForBufferContains(world.page, OMP_UP_MARKER);
  } catch (err) {
    const buffer = await readBufferText(world.page);
    throw new Error(
      `the fake omp never said it was up: ${(err as Error).message}\n— terminal tail:\n${buffer.slice(-600)}`,
    );
  }
}

async function promptFakeAgent(world: KoluWorld): Promise<void> {
  promptCounter += 1;
  const words = `fix the parser ${promptCounter}`;
  await world.page.keyboard.type(words);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, `${OMP_HEARD_MARKER} ${words}`);
}

async function mockOmpSession(
  world: KoluWorld,
  state?: AgentLifecycleState,
  opts: { holdStarting: boolean } = { holdStarting: false },
): Promise<void> {
  const ompDir = getOmpDir();
  if (!ompDir) throw new Error("KOLU_OMP_DIR must be set");

  cleanup();
  mockCwd = fs.mkdtempSync(path.join(os.tmpdir(), `kolu-omp-${process.pid}-`));
  mockFixture = ompTranscriptPath({ ompDir, cwd: mockCwd });
  mockStagePath = path.join(mockCwd, "omp-session-pending.jsonl");
  if (state) stageOmpPrompt(mockStagePath, state);

  await cdTerminalInto(world, mockCwd);
  await startFakeAgent(world, mockFixture, opts);
  if (state) await promptFakeAgent(world);
}

When(
  "an Oh My Pi session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await mockOmpSession(this, state as AgentLifecycleState);
  },
);

When(
  "an Oh My Pi process is running with no session file yet",
  async function (this: KoluWorld) {
    await mockOmpSession(this);
  },
);

When(
  "an Oh My Pi agent is coming up with its screen still being drawn",
  async function (this: KoluWorld) {
    await mockOmpSession(this, undefined, { holdStarting: true });
  },
);

When("Oh My Pi's screen goes quiet", async function (this: KoluWorld) {
  if (!mockQuietFlag) {
    throw new Error("No Oh My Pi bring-up paint to settle — start one first");
  }
  await this.page.keyboard.type("settle");
  await this.page.keyboard.press("Enter");
  await pollFor({
    observe: async () => fs.existsSync(mockQuietFlag as string),
    isDone: (seen) => seen === true,
    onTimeout: (_last, ms) =>
      new Error(`the fake omp never acknowledged settle within ${ms}ms`),
    timeoutMs: POLL_TIMEOUT,
  });
});

When("Oh My Pi leaves the foreground", async function (this: KoluWorld) {
  await this.page.keyboard.type("quit");
  await this.page.keyboard.press("Enter");
  await waitForBufferContains(this.page, OMP_GONE_MARKER);
});

When(
  "a session file is written for the running Oh My Pi process with state {string}",
  async function (this: KoluWorld, state: string) {
    if (!mockFixture || !mockStagePath)
      throw new Error("No omp fixture — start the process first");
    stageOmpPrompt(mockStagePath, state as AgentLifecycleState);
    await promptFakeAgent(this);
  },
);

When(
  "the Oh My Pi session state changes to {string}",
  async function (this: KoluWorld, state: string) {
    if (!mockFixture) {
      throw new Error("No Oh My Pi fixture to update — call mock step first");
    }
    updateOmpFixture(mockFixture, state as AgentLifecycleState);
  },
);

When(
  "Oh My Pi's todo list has {int} tasks with {int} done",
  async function (this: KoluWorld, total: number, done: number) {
    if (!mockFixture) {
      throw new Error("No Oh My Pi fixture to update — call mock step first");
    }
    appendOmpTodoList(mockFixture, total, done);
  },
);

When(
  "Oh My Pi renders a tool approval prompt",
  async function (this: KoluWorld) {
    await this.page.keyboard.type("approval");
    await this.page.keyboard.press("Enter");
  },
);

When(
  "Oh My Pi clears its prompt from the screen",
  async function (this: KoluWorld) {
    await this.page.keyboard.type("clear");
    await this.page.keyboard.press("Enter");
  },
);

async function observeOmpIndicator(world: KoluWorld): Promise<{
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
  "the tile chrome should show an Oh My Pi indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observeOmpIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "omp",
      onTimeout: (last, ms) =>
        new Error(
          `Expected Oh My Pi indicator state "${expectedState}" (kind=omp), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the tile chrome should follow the Oh My Pi state change to {string} without nudging",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observeOmpIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "omp",
      onTimeout: (last, ms) =>
        new Error(
          `Expected live Oh My Pi state "${expectedState}" without nudge (kind=omp), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
