import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Recording } from "./types";

// The demo clones kolu itself into ~/demo — a real, recognizable repo over the
// network (the capture box has egress). Reproducible: a fresh shallow clone
// every run. Swap REPO to demo a different project.
const REPO = "https://github.com/juspay/kolu";
const DEMO_DIR = path.join(os.homedir(), "demo");
const CLONE_PATH = path.join(DEMO_DIR, "kolu");

// The agent launched at the climax. The capture box must have it on PATH +
// authenticated for the TUI to render — true on this dev box (it is running
// Claude Code), which is why the demo is captured locally rather than on a
// clean pu box.
const AGENT_CMD = "claude";

const pause = (
  world: { page: { waitForTimeout(ms: number): Promise<void> } },
  ms: number,
) => world.page.waitForTimeout(ms);

/**
 * The product demo: open a terminal, clone a repo, cd in, and launch the agent
 * — kolu's core loop in one window. Captured in app-mode (chromeless), right
 * panel hidden so the terminal fills the frame.
 */
export const recording: Recording = {
  name: "new-terminal-demo",
  chrome: "app",
  caption:
    "Open a terminal, clone a repo, and launch an agent — kolu's core loop in one window.",
  display: { hideRightPanel: true, cleanCanvas: true },
  async drive(world) {
    // Idempotent fixture: a fresh ~/demo/kolu each run (the terminal's $HOME is
    // this same user, so this clears what the shell is about to clone).
    fs.mkdirSync(DEMO_DIR, { recursive: true });
    execSync(`rm -rf "${CLONE_PATH}"`, { stdio: "ignore" });

    await world.waitForReady();
    await pause(world, 800);

    await world.createTerminal();
    await pause(world, 1200);

    await world.terminalRun("cd ~/demo");
    await pause(world, 700);

    await world.terminalRun(`git clone --depth 1 ${REPO}`);
    // Wait for the clone to finish (dir appears) before moving on.
    for (let i = 0; i < 60; i++) {
      if (fs.existsSync(path.join(CLONE_PATH, ".git"))) break;
      await pause(world, 500);
    }
    await pause(world, 1500);

    await world.terminalRun("cd kolu");
    await pause(world, 700);

    await world.terminalRun("ls");
    await pause(world, 1600);

    await world.terminalRun(AGENT_CMD);
    // Dwell on the launched agent so the loop ends on the payoff.
    await pause(world, 3500);
  },
};
