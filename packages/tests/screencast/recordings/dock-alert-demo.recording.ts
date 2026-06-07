import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  CLAUDE_SONNET,
  CODEX_AUTONOMOUS,
  annotate,
  clearAnnotations,
  clearCanvas,
  clickWithArrow,
  createTerminalByClick,
  openOverlappingTerminal,
  pause,
  waitForDockBucket,
} from "./helpers";
import type { Recording } from "./types";

// Two DIFFERENT pre-existing checkouts — so the dock has two repos to group by,
// and the flow opens with projects already on disk (realistic: you don't clone
// on camera, you `cd` into what you already have). T1 runs claude in kolu; T2
// runs codex in drishti.
const DEMO_DIR = path.join(os.homedir(), "demo");
const KOLU = {
  url: "https://github.com/juspay/kolu",
  dir: path.join(DEMO_DIR, "kolu"),
};
const DRISHTI = {
  url: "https://github.com/srid/drishti",
  dir: path.join(DEMO_DIR, "drishti"),
};

// Ensure a shallow clone exists — idempotent, and REUSED across runs (we never
// delete), so only the first ever run pays the clone. Runs in Node, off-camera:
// the on-camera flow only `cd`s into the already-present checkout.
function ensureClone(repo: { url: string; dir: string }): void {
  if (fs.existsSync(path.join(repo.dir, ".git"))) return;
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  execFileSync("git", ["clone", "--depth", "1", repo.url, repo.dir], {
    stdio: "ignore",
  });
}

// Drives claude to invoke its **AskUserQuestion** tool — the real
// multiple-choice prompt — and wait on the pick (rather than charging ahead or
// asking in plain text). We hand it the exact options so the rendered question
// is well-formed. That wait is the `awaiting` ("needs you") state the dock
// surfaces while claude's tile is buried. The answer side selects an option in
// that prompt with the keyboard (↓ then Enter) — see drive().
const CLAUDE_ASK =
  'Use your AskUserQuestion tool to ask me how I want to add a small feature to this project. Present exactly these options to pick from: "A CLI flag", "A config-file setting", "An environment variable". Do not write any code — just ask and wait for my pick.';
// codex gets real work so its row reads `working` (a live contrast to claude's
// `awaiting`) while we point at the dock.
const CODEX_TASK =
  "Read the source and summarize this project's architecture in 4 bullet points.";

/**
 * Dock-alert demo — the dock tells you *who needs you*, across repos and across
 * tiles you can't even see:
 *
 *  1. Empty canvas → click "+" to open a terminal (Vaughn). `cd` into **kolu**
 *     and launch claude; have it call its **AskUserQuestion** tool (a real
 *     multiple-choice prompt) so it stops and waits on your pick.
 *  2. Click "+" for a second terminal (a LIGHT theme), which opens on top and
 *     **buries** claude's tile. `cd` into **drishti** and run codex. Now the
 *     dock groups two repos, each with its agent's live status: drishti · codex
 *     `working`, kolu · claude `awaiting`.
 *  3. claude's tile is hidden, but the dock flags it — a coral arrow points at
 *     claude's `awaiting` row.
 *  4. You act on it: click that dock row to raise the buried tile, and pick an
 *     option in claude's AskUserQuestion prompt. The loop closes.
 *
 * Every on-camera mouse click is telegraphed with a coral arrow. Two different
 * agents in two different repos, end to end — realistic, and it shows repo
 * grouping + live status + the dock-as-navigator in one clip. claude's banner
 * surfaces the account (email/plan); accepted for this clip. Captured wide
 * (2560×1440) for a full-bleed embed on the home page.
 */
export const recording: Recording = {
  name: "dock-alert-demo",
  chrome: "app",
  theme: "Vaughn", // T1; T2 overrides to a light theme below
  // Dock stays — it's the star; the right panel also stays (new app default).
  display: { hideMinimap: true },
  viewport: { width: 1600, height: 900 }, // room for dock + two tiles + the panel
  // The payoff is the dock alert near the end; sample the poster there so the
  // still shows the arrow on the dock, not the load-in. Tuned to the clip.
  posterAt: 23,
  async drive(world) {
    // Both projects already on disk (off-camera, idempotent).
    ensureClone(KOLU);
    ensureClone(DRISHTI);

    // Empty canvas → click "+" (arrowed) to open T1 in kolu, launch claude, and
    // ask it to ask US a question (so it waits on you).
    await clearCanvas(world, 800);
    const claudeId = await createTerminalByClick(world, "Vaughn");
    await pause(world, 400);
    await world.terminalRun("cd ~/demo/kolu");
    await pause(world, 500);
    await world.terminalRun(CLAUDE_SONNET);
    await pause(world, 2000); // folder-trust gate appears
    await world.page.keyboard.press("Enter"); // "Yes, I trust this folder"
    await pause(world, 3000); // claude boots to its prompt
    await world.terminalRun(CLAUDE_ASK);

    // claude is live — assert the dock confirms it (load-bearing).
    await waitForDockBucket(world, "working", 20_000);

    // Click "+" for T2 (a LIGHT theme), opened on top so it BURIES claude's
    // tile. cd into drishti and run codex — which shows a directory-trust prompt
    // on a fresh checkout, so press Enter to accept ("Yes, continue") before the
    // task, or the task leaks to the shell.
    await pause(world, 400);
    await openOverlappingTerminal(world, { theme: "Catppuccin Latte" });
    await pause(world, 300);
    await world.terminalRun("cd ~/demo/drishti");
    await pause(world, 500);
    await world.terminalRun(CODEX_AUTONOMOUS);
    await pause(world, 2000); // codex directory-trust prompt appears
    await world.page.keyboard.press("Enter"); // "Yes, continue"
    await pause(world, 4500); // codex boots to its REPL
    await world.terminalRun(CODEX_TASK);

    // claude has come back with its question and is waiting → its row is
    // `awaiting` (codex is still `working`). Its tile is buried behind codex, but
    // the dock alerts you. Point the arrow at claude's row (by id, so it can't
    // grab codex's row).
    const claudeRow = `[data-testid="dock-row"][data-terminal-id="${claudeId}"]`;
    await waitForDockBucket(world, "awaiting", 60_000);
    await pause(world, 300);
    await annotate(
      world,
      claudeRow,
      "claude needs you — buried behind drishti, the dock still says so",
      "left",
    );
    await pause(world, 1300); // hold so the viewer reads the alert

    // Act on it: click claude's dock row (arrowed) to raise the buried tile (the
    // dock is also the navigator — activating a tile lifts it to the front),
    // then answer claude's question. The loop closes.
    await clearAnnotations(world);
    await clickWithArrow(
      world,
      claudeRow,
      "click the row → jump straight to it",
      "left",
    );
    await pause(world, 600); // claude's tile lifts to the front
    // Answer claude's AskUserQuestion prompt: focus the (now-raised) tile, move
    // the selection to a choice, and confirm — a real pick, not typed text.
    await world.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await world.page.keyboard.press("ArrowDown"); // highlight the 2nd option
    await pause(world, 500);
    await world.page.keyboard.press("Enter"); // pick it
    await pause(world, 1200); // claude takes the choice and gets back to work
  },
};
