import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CODEX_AUTONOMOUS,
  launchAgentAndAsk,
  pause,
  setupSingleTerminal,
} from "./helpers";
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
    // this same user, so this clears what the shell is about to clone). Remove
    // ONLY the clone target the harness owns (never DEMO_DIR or anything above
    // it) and do it via fs — no shell interpolation of a user-home path into
    // `rm -rf`.
    fs.mkdirSync(DEMO_DIR, { recursive: true });
    fs.rmSync(CLONE_PATH, { recursive: true, force: true });

    // Shared single-terminal-demo opening: themed terminal, clear of the dock.
    await setupSingleTerminal(world);
    await pause(world, 800);

    await world.terminalRun("cd ~/demo");
    await pause(world, 600);

    await world.terminalRun(`git clone --depth 1 ${REPO}`);
    // Wait for the clone to finish (`.git` appears) before moving on, and ASSERT
    // it did — a network failure here would otherwise `cd kolu` into nothing and
    // film an agent launched in the wrong directory (a misleading marketing clip).
    let cloned = false;
    for (let i = 0; i < 60; i++) {
      if (fs.existsSync(path.join(CLONE_PATH, ".git"))) {
        cloned = true;
        break;
      }
      await pause(world, 500);
    }
    if (!cloned) {
      throw new Error(
        `git clone did not produce ${CLONE_PATH}/.git within 30s — clone failed`,
      );
    }
    await pause(world, 1200);

    await world.terminalRun("cd kolu");
    await pause(world, 600);

    // The reusable climax: launch codex (interactive + autonomous; identity-
    // neutral banner, unlike claude's name/email/plan) and ask it something —
    // the dock row pulses through working → awaiting as it answers. Codex shows
    // no trust gate (banner → input directly), so don't press Enter; give its
    // typewriter intro a generous beat to become input-ready before typing.
    await launchAgentAndAsk(world, {
      command: CODEX_AUTONOMOUS,
      acceptTrustGate: false,
      bootMs: 7000,
      prompt: "Explain this project, in 5 lines",
    });
  },
};
