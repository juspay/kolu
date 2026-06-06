import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchAgentAndAsk, pause, setupSingleTerminal } from "./helpers";
import type { Recording } from "./types";

// The demo clones kolu itself into ~/demo — a real, recognizable repo over the
// network (the capture box has egress). Reproducible: a fresh shallow clone
// every run. Swap REPO to demo a different project.
const REPO = "https://github.com/juspay/kolu";
const DEMO_DIR = path.join(os.homedir(), "demo");
const CLONE_PATH = path.join(DEMO_DIR, "kolu");

/**
 * The product demo: open a terminal, clone a repo, launch an agent, and ask it
 * something real — kolu's core loop in one window. Captured in app-mode
 * (chromeless); right panel + minimap out of shot, but the DOCK stays in frame
 * so its row pulses live as the agent works.
 */
export const recording: Recording = {
  name: "new-terminal-demo",
  chrome: "app",
  theme: "Vaughn",
  caption:
    "Open a terminal, clone a repo, launch an agent, ask it anything — kolu's core loop, with the dock tracking the agent live.",
  display: { hideRightPanel: true, hideMinimap: true },
  async drive(world) {
    // Idempotent fixture: a fresh ~/demo/kolu each run (the terminal's $HOME is
    // this same user, so this clears what the shell is about to clone).
    fs.mkdirSync(DEMO_DIR, { recursive: true });
    execSync(`rm -rf "${CLONE_PATH}"`, { stdio: "ignore" });

    // Shared single-terminal-demo opening: themed terminal, clear of the dock.
    await setupSingleTerminal(world);
    await pause(world, 800);

    await world.terminalRun("cd ~/demo");
    await pause(world, 600);

    await world.terminalRun(`git clone --depth 1 ${REPO}`);
    // Wait for the clone to finish (dir appears) before moving on.
    for (let i = 0; i < 60; i++) {
      if (fs.existsSync(path.join(CLONE_PATH, ".git"))) break;
      await pause(world, 500);
    }
    await pause(world, 1200);

    await world.terminalRun("cd kolu");
    await pause(world, 600);

    // The reusable climax: launch the agent (trust-skipped, sonnet) and ask it
    // something — the dock row pulses through working → awaiting as it answers.
    await launchAgentAndAsk(world, {
      prompt: "Explain this project, in 5 lines",
    });
  },
};
