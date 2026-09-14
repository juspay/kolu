/**
 * Xyne status detection — step definitions.
 *
 * Mocks an Xyne session by writing `agent/sessions/<encoded-cwd>/…jsonl`
 * under the per-worker `KOLU_XYNE_DIR`, then launches the fake `xyne`
 * binary so `matchesAgent(state, "xyne")` succeeds. Xyne derives no busy
 * states from its persisted transcript, so the only indicator assertion is
 * `waiting` — the dock-lighting surface.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { After, Then, When } from "@cucumber/cucumber";
import { writeXyneFixture } from "../support/agent-mock-xyne.ts";
import {
  ACTIVE_TERMINAL,
  readBufferText,
  waitForBufferContains,
} from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import { type KoluWorld, POLL_TIMEOUT } from "../support/world.ts";

const getXyneDir = () => process.env.KOLU_XYNE_DIR;

let mockCwd: string | null = null;

function cleanup() {
  if (mockCwd && fs.existsSync(mockCwd)) {
    fs.rmSync(mockCwd, { recursive: true, force: true });
  }
  mockCwd = null;
  const xyneDir = getXyneDir();
  if (xyneDir && fs.existsSync(xyneDir)) {
    fs.rmSync(xyneDir, { recursive: true, force: true });
  }
}

After({ tags: "@xyne-mock" }, () => {
  cleanup();
});

async function cdTerminalInto(world: KoluWorld, cwd: string): Promise<void> {
  const marker = `XYNE_CWD_READY_${Date.now()}`;
  await world.page.keyboard.type(`cd ${cwd} && echo ${marker}`);
  await world.page.keyboard.press("Enter");
  await waitForBufferContains(world.page, marker);
}

/** Launch the fake `xyne` binary — a renamed bash that stays resident with
 *  comm="xyne" so `readForegroundBasename() === "xyne"` matches. Wait for
 *  the PID line the PROCESS prints (not the echoed command line — only its
 *  own output carries the `XYNE_PID=<digits>` shape). */
async function startFakeAgent(
  world: KoluWorld,
  body = "sleep 99999",
): Promise<void> {
  const bin = process.env.KOLU_FAKE_XYNE_BIN;
  if (!bin) throw new Error("KOLU_FAKE_XYNE_BIN must be set");
  await world.page.keyboard.type(`${bin} -c 'echo XYNE_PID=$$; ${body}'`);
  await world.page.keyboard.press("Enter");
  await pollFor({
    observe: () => readBufferText(world.page, ACTIVE_TERMINAL),
    isDone: (buf) => /XYNE_PID=\d+/.exec(buf ?? "") !== null,
    onTimeout: (last, ms) =>
      new Error(`Fake xyne never printed its pid after ${ms}ms: ${last ?? ""}`),
    timeoutMs: POLL_TIMEOUT,
  });
}

/** Xyne's idle frame, recorded verbatim from a real `xyne` in a PTY: sync
 *  begin, hide cursor, reset pen, park the cursor in the input box, show
 *  cursor, sync end — no cell changes. Repainted at Xyne's ~30 fps. */
const XYNE_IDLE_REPAINT_LOOP = String.raw`while :; do printf "\033[?2026h\033[?25l\033[0m\033[5;6H\033[?25h\033[?2026l"; sleep 0.033; done`;

async function mockXyneSession(
  world: KoluWorld,
  agentBody?: string,
): Promise<void> {
  const xyneDir = getXyneDir();
  if (!xyneDir) throw new Error("KOLU_XYNE_DIR must be set");
  cleanup();
  mockCwd = fs.mkdtempSync(path.join(os.tmpdir(), `kolu-xyne-${process.pid}-`));
  // Write the session tree BEFORE the fake binary starts — the adapter's
  // resolve is read-on-demand, and the sessions-dir externalChanges rewake
  // covers any reconcile-window race.
  writeXyneFixture({
    xyneDir,
    cwd: mockCwd,
    model: "juspay/kimi-k3",
    title: "Mock Xyne session",
  });
  await cdTerminalInto(world, mockCwd);
  await startFakeAgent(world, agentBody);
}

When("a Xyne session is mocked", async function (this: KoluWorld) {
  await mockXyneSession(this);
});

When(
  "a Xyne session is mocked with an idle cursor repaint loop",
  async function (this: KoluWorld) {
    await mockXyneSession(this, XYNE_IDLE_REPAINT_LOOP);
  },
);

async function observeXyneIndicator(world: KoluWorld): Promise<{
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
  "the tile chrome should show a Xyne indicator with state {string}",
  async function (this: KoluWorld, expectedState: string) {
    await pollFor({
      observe: () => observeXyneIndicator(this),
      isDone: (o) => o.state === expectedState && o.kind === "xyne",
      onTimeout: (last, ms) =>
        new Error(
          `Expected Xyne indicator state "${expectedState}" (kind=xyne), got state="${last?.state ?? null}" kind="${last?.kind ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);

Then(
  "the tile title state pip should stop moving",
  async function (this: KoluWorld) {
    // The pip moves while padi calls the terminal active. A waiting agent
    // settles once its output goes quiet for the finish window (~5s), so an
    // idle repaint loop that is still spinning after POLL_TIMEOUT is the bug.
    await pollFor({
      observe: () =>
        this.page.evaluate(() =>
          document
            .querySelector(
              '[data-testid="canvas-tile-titlebar"] [data-testid="state-pip"]',
            )
            ?.getAttribute("data-motion"),
        ),
      isDone: (motion) => motion === "none",
      onTimeout: (last, ms) =>
        new Error(
          `Expected the title state pip to stop moving, data-motion="${last ?? null}" after ${ms}ms`,
        ),
      timeoutMs: POLL_TIMEOUT,
    });
  },
);
