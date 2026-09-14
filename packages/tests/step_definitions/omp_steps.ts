/**
 * Oh My Pi status detection — step definitions.
 *
 *  Mocks an `omp` session the way real omp presents one: a fake `omp` binary
 *  (a bash copy seeded by hooks.ts, kept resident with comm="omp") writes its
 *  own **breadcrumb** — `<KOLU_OMP_DIR>/terminal-sessions/<tty>`, derived from
 *  its own stdin, exactly as omp's `getTerminalId()` does — and the scenario
 *  writes the session JSONL that crumb points at. Detection is tty-anchored
 *  (kolu reads the foreground process's stdin), so no pid plumbing is needed;
 *  what the crumb is named after is the same pty either way.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import type { AgentLifecycleState } from "../support/agent-lifecycle.ts";
import {
  type OmpFixture,
  ompMockPayload,
  ompTranscriptPath,
  updateOmpFixture,
  writeOmpFixture,
} from "../support/agent-mock-omp.ts";
import { waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const getOmpDir = () => process.env.KOLU_OMP_DIR;

let mockCwd: string | null = null;
let mockFixture: OmpFixture | null = null;

function cleanup() {
  if (mockCwd && fs.existsSync(mockCwd)) {
    fs.rmSync(mockCwd, { recursive: true, force: true });
  }
  mockCwd = null;
  mockFixture = null;
  const ompDir = getOmpDir();
  if (ompDir) {
    // Wipe the session tree AND the breadcrumbs between scenarios: a crumb for
    // a pty id that gets reused would otherwise point at a previous scenario's
    // file.
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

/** Launch the fake `omp` with the crumb-write + resident-loop payload. The
 *  payload is single-quoted for the shell, so it uses only double quotes
 *  inside. */
async function startFakeAgent(
  world: KoluWorld,
  fixture: OmpFixture,
): Promise<void> {
  const bin = process.env.KOLU_FAKE_OMP_BIN;
  if (!bin) throw new Error("KOLU_FAKE_OMP_BIN must be set");
  const ompDir = getOmpDir();
  if (!ompDir) throw new Error("KOLU_OMP_DIR must be set");
  const payload = ompMockPayload({
    breadcrumbDir: path.join(ompDir, "terminal-sessions"),
    transcriptPath: fixture.transcriptPath,
  });
  await world.page.keyboard.type(`${bin} -c '${payload}'`);
  await world.page.keyboard.press("Enter");
}

/** Mock an omp session in the terminal: a temp cwd, the session file (when
 *  `state` is given), the fake process that writes its own breadcrumb.
 *
 *  `state` OMITTED is a real production state, not a convenience default: it is
 *  omp's lazy session, whose crumb is written `fresh` before any JSONL exists —
 *  the race the "no session file yet" scenario exercises. */
async function mockOmpSession(
  world: KoluWorld,
  state?: AgentLifecycleState,
): Promise<void> {
  const ompDir = getOmpDir();
  if (!ompDir) throw new Error("KOLU_OMP_DIR must be set");

  cleanup();
  mockCwd = fs.mkdtempSync(path.join(os.tmpdir(), `kolu-omp-${process.pid}-`));
  mockFixture = ompTranscriptPath({ ompDir, cwd: mockCwd });
  if (state) writeOmpFixture(mockFixture, state);

  await cdTerminalInto(world, mockCwd);
  await startFakeAgent(world, mockFixture);
}

When(
  "an Oh My Pi session is mocked with state {string}",
  async function (this: KoluWorld, state: string) {
    await mockOmpSession(this, state as AgentLifecycleState);
  },
);

/** Start fake `omp` with NO session file on disk — the production race: omp has
 *  already written its `fresh` breadcrumb (the session is still memory-only)
 *  while the foreground is `omp`, so detection binds the session from the crumb
 *  alone. The command-run reconcile ladder will already have stopped by the
 *  time the file lands. */
When(
  "an Oh My Pi process is running with no session file yet",
  async function (this: KoluWorld) {
    await mockOmpSession(this);
  },
);

When(
  "a session file is written for the running Oh My Pi process with state {string}",
  async function (this: KoluWorld, state: string) {
    if (!mockFixture)
      throw new Error("No omp fixture — start the process first");
    writeOmpFixture(mockFixture, state as AgentLifecycleState);
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

/** Ask the resident fake to paint omp's tool-approval dialog. */
When(
  "Oh My Pi renders a tool approval prompt",
  async function (this: KoluWorld) {
    await this.page.keyboard.type("approval");
    await this.page.keyboard.press("Enter");
  },
);

/** Ask it to paint enough output that the dialog scrolls out of the screen
 *  tail — the "the prompt is gone now" state. */
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

/** Assert a live state change purely on the strength of the appended entries
 *  (or the screen clearing) — if only a manual nudge lit the tile, production
 *  is broken the same way. */
Then(
  "the tile chrome should follow the Oh My Pi state change to {string} without nudging",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observeOmpIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "omp",
      // No onTick nudge — the append / screen change alone must rewake.
      onTimeout: (last, ms) =>
        new Error(
          `Expected live Oh My Pi state "${expectedState}" without nudge (kind=omp), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
