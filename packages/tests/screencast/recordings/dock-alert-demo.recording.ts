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
  openFileBySearch,
  openOverlappingTerminal,
  pause,
  selectTextInView,
  waitForDockBucket,
} from "./helpers";
import type { Recording } from "./types";

// Two DIFFERENT pre-existing checkouts so the dock groups by repo. T1 runs
// claude in kolu (write-capable — it makes the edit at the end); T2 runs codex
// in drishti for live "working" status in a second repo.
const DEMO_DIR = path.join(os.homedir(), "demo");
const KOLU = {
  url: "https://github.com/juspay/kolu",
  dir: path.join(DEMO_DIR, "kolu"),
};
const DRISHTI = {
  url: "https://github.com/srid/drishti",
  dir: path.join(DEMO_DIR, "drishti"),
};

function ensureClone(repo: { url: string; dir: string }): void {
  if (!fs.existsSync(path.join(repo.dir, ".git"))) {
    fs.mkdirSync(DEMO_DIR, { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", repo.url, repo.dir], {
      stdio: "ignore",
    });
    return;
  }
  // Reuse the checkout, but revert tracked-file edits to pristine — else a prior
  // run's agent edit (the README/source change) persists and claude finds "no
  // edit needed", so the clip never shows the change. `checkout -- .` reverts
  // tracked files only (keeps untracked, e.g. new-terminal-demo's fixture marker).
  execFileSync("git", ["-C", repo.dir, "checkout", "--", "."], {
    stdio: "ignore",
  });
}

const CODEX_TASK =
  "Read the source and summarize this project's architecture in 4 bullet points.";
// The file we review + the edit we hand claude. html-escape/src/index.ts opens
// reliably by search (the root README tree-row is flaky headless), and the edit
// — a new entity in the HTML_ENTITIES map — lands as a visible new line in the
// open source view.
const REVIEW_FILE = "packages/html-escape/src/index.ts";
const SELECT_PHRASE = "HTML_ENTITIES";
const CLAUDE_EDIT =
  "Apply the review comment I just left on packages/html-escape/src/index.ts: add an entry to the HTML_ENTITIES map that escapes the backtick character as &#96;. Just make the edit, no preamble.";

/**
 * The hero — one real workflow that exercises the whole surface: **Dock,
 * terminals, and the right-panel code browser**, ending on a live edit.
 *
 *  1. Empty canvas → click "+" to open claude in **kolu** (Vaughn).
 *  2. Click "+" for codex in **drishti** (light theme), which buries claude's
 *     tile. The dock now groups two repos and shows each agent's live status.
 *  3. Click claude's dock row to jump to its tile (dock-as-navigator) — the
 *     **Code tab** follows, now browsing kolu.
 *  4. Open a source file, select a line, and leave a **comment** for claude;
 *     copy it (the comment-on-any-file → agent handoff).
 *  5. Hand it to claude in the terminal — claude **edits the file**, and the
 *     open source view **updates live**. The loop closes, on camera.
 *
 * claude is write-capable (`--dangerously-skip-permissions`); its banner shows
 * the account (email/plan), accepted for this clip. Every on-camera click is
 * telegraphed with a coral arrow. Captured wide (1600×900 → 3200×1800) so the
 * dock, tiles, and panel all fit.
 */
export const recording: Recording = {
  name: "dock-alert-demo",
  chrome: "app",
  theme: "Vaughn", // T1; T2 overrides to a light theme below
  // Dock + right panel both stay (new app default); minimap out of shot.
  display: { hideMinimap: true },
  viewport: { width: 1600, height: 900 },
  // Poster: the live-edit climax — claude's diff in the terminal + the Code
  // panel. The most compelling single frame ("watch an agent edit your code").
  posterAt: 42,
  async drive(world) {
    ensureClone(KOLU);
    ensureClone(DRISHTI);

    // T1: claude in kolu, left idle at its prompt (it makes the edit later).
    await clearCanvas(world, 800);
    const claudeId = await createTerminalByClick(world, "Vaughn");
    await pause(world, 400);
    await world.terminalRun("cd ~/demo/kolu");
    await pause(world, 500);
    await world.terminalRun(CLAUDE_SONNET);
    await pause(world, 2000); // folder-trust gate
    await world.page.keyboard.press("Enter"); // "Yes, I trust this folder"
    await pause(world, 3000); // claude boots, idle at its prompt

    // T2: codex in drishti, opened on top so it buries claude's tile. Two repos
    // → the dock groups them; codex works → live status.
    await pause(world, 400);
    await openOverlappingTerminal(world, { theme: "Catppuccin Latte" });
    await pause(world, 300);
    await world.terminalRun("cd ~/demo/drishti");
    await pause(world, 500);
    await world.terminalRun(CODEX_AUTONOMOUS);
    await pause(world, 2000); // codex directory-trust prompt
    await world.page.keyboard.press("Enter"); // "Yes, continue"
    await pause(world, 4500); // codex boots
    await world.terminalRun(CODEX_TASK);
    await waitForDockBucket(world, "working", 20_000); // codex live

    // The dock now groups two repos with live status. Point it out.
    await annotate(
      world,
      '[data-testid="dock"]',
      "two repos, two agents — the dock tracks each",
      "right",
    );
    await pause(world, 1500);
    await clearAnnotations(world);

    // Jump to claude's (buried) tile via its dock row — the dock is the
    // navigator. Raising it makes the Code tab follow kolu, claude's repo.
    const claudeRow = `[data-testid="dock-row"][data-terminal-id="${claudeId}"]`;
    await clickWithArrow(
      world,
      claudeRow,
      "click a row → jump to its tile",
      "left",
    );
    await pause(world, 900);

    // The Code tab (open by default) now browses kolu. Open the README and
    // comment on a line — the comment-on-any-file → agent handoff.
    await clickWithArrow(
      world,
      '[data-testid="right-panel-tab-code"]',
      "the Code tab — kolu's files",
      "down",
      500,
    );
    await openFileBySearch(world, "html-escape", REVIEW_FILE, "open a file");
    await world.page
      .waitForSelector('[data-testid="pierre-file-view"]', {
        timeout: 15_000,
      })
      .catch(() => undefined);
    await pause(world, 700);
    await selectTextInView(
      world,
      '[data-testid="pierre-file-view"]',
      SELECT_PHRASE,
    );
    await world.page
      .waitForSelector('[data-testid="kolu-comment-pill"]', { timeout: 5_000 })
      .catch(() => undefined);
    await annotate(
      world,
      '[data-testid="kolu-comment-pill"]',
      "select text → comment on any file",
      "down",
    );
    await pause(world, 800);
    await world.page
      .locator('[data-testid="kolu-comment-pill"]')
      .dispatchEvent("mousedown");
    await world.waitForFrame();
    await clearAnnotations(world);
    await world.page
      .locator('[data-testid="kolu-comment-composer"] textarea')
      .fill("@claude — also escape the backtick character here.");
    await pause(world, 600);
    await world.page
      .locator('[data-testid="kolu-comment-composer"]')
      .getByRole("button", { name: "Save" })
      .click();
    await world.waitForFrame();
    await pause(world, 500);
    await world.page
      .waitForSelector('[data-testid="kolu-comments-tray"]', {
        timeout: 10_000,
      })
      .catch(() => undefined);
    await clickWithArrow(
      world,
      '[data-testid="kolu-tray-copy"]',
      "copy it for the agent",
      "down",
      700,
    );
    await pause(world, 700);

    // Hand it to claude (its tile is the active one) — it edits README.md on
    // disk. Wait for claude to finish (its dock row → awaiting); by then the
    // open README preview has live-reloaded with the change.
    await world.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await world.terminalRun(CLAUDE_EDIT);
    await world.page
      .waitForSelector(`${claudeRow}[data-bucket="working"]`, {
        state: "attached",
        timeout: 30_000,
      })
      .catch(() => undefined);
    await world.page
      .waitForSelector(`${claudeRow}[data-bucket="awaiting"]`, {
        state: "attached",
        timeout: 90_000,
      })
      .catch(() => undefined);
    await pause(world, 600); // let the preview's live-reload settle

    // The open source view just changed itself — claude's edit, live.
    await annotate(
      world,
      '[data-testid="pierre-file-view"]',
      "claude edited the file — live",
      "left",
    );
    await pause(world, 3000); // hold on the changed file + the arrow
    await clearAnnotations(world);
  },
};
