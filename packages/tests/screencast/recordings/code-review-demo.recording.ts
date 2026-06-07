import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  annotate,
  clearAnnotations,
  clearCanvas,
  clickWithArrow,
  createTerminalByClick,
  openFileBySearch,
  pause,
  selectTextInView,
} from "./helpers";
import type { Recording } from "./types";

// A pre-existing checkout to browse — the flow opens with the project already on
// disk and just `cd`s into it (no on-camera clone).
const DEMO_DIR = path.join(os.homedir(), "demo");
const KOLU = {
  url: "https://github.com/juspay/kolu",
  dir: path.join(DEMO_DIR, "kolu"),
};

function ensureClone(repo: { url: string; dir: string }): void {
  if (fs.existsSync(path.join(repo.dir, ".git"))) return;
  fs.mkdirSync(DEMO_DIR, { recursive: true });
  execFileSync("git", ["clone", "--depth", "1", repo.url, repo.dir], {
    stdio: "ignore",
  });
}

/**
 * Code-review demo — kolu's "comment on any file → hand it to an agent" loop,
 * the Code tab in one short clip (no agents, so it stays tight):
 *
 *  1. Open a terminal and `cd` into a repo (kolu) — the Code tab follows the
 *     active terminal's repo.
 *  2. Open the **Code tab → "All files"** and open a source file (by file
 *     search — robust against the virtualized tree).
 *  3. **Comment on it**: select a phrase in the source, which floats the inline
 *     "+ Comment" pill; leave a note for an agent, Save, and **copy the tray as
 *     Markdown** — ready to paste straight into claude/codex.
 *
 * Every on-camera click is telegraphed with a coral arrow. Captured wide
 * (logical 1600×900 → 3200×1800) so the terminal + the open Code panel both fit.
 */
export const recording: Recording = {
  name: "code-review-demo",
  chrome: "app",
  theme: "Nord", // distinct per recording (new-terminal=Dracula, dock-alert=Vaughn/Latte)
  display: { hideRightPanel: true, hideMinimap: true }, // panel starts collapsed; we open it on camera
  viewport: { width: 1600, height: 900 },
  // Payoff is the selected source + comment composer; sample it near the end.
  posterAt: 12,
  async drive(world) {
    ensureClone(KOLU);

    // A terminal in kolu — the Code tab browses the active terminal's repo.
    await clearCanvas(world, 800);
    await createTerminalByClick(world, "Nord");
    await pause(world, 400);
    await world.terminalRun("cd ~/demo/kolu");
    await pause(world, 1000); // let the cwd/repo register for the Code tab

    // Open the right panel → Code tab → "All files" (the whole tree, not just
    // the working-tree diff).
    await world.page
      .locator('header button[aria-label*="Toggle inspector"]')
      .click();
    await world.waitForFrame();
    await pause(world, 400);
    await clickWithArrow(
      world,
      '[data-testid="right-panel-tab-code"]',
      "the Code tab — your repo's files",
      "down",
      600,
    );
    await clickWithArrow(
      world,
      '[data-testid="diff-filter-chip"]',
      "All files",
      "down",
      500,
    );
    await world.page.locator('[data-testid="diff-mode-browse"]').click();
    await world.waitForFrame();
    await pause(world, 400);

    // Open a specific source file by search — robust against the virtualized
    // file tree (a direct tree-row click is flaky; a path search isn't).
    await openFileBySearch(
      world,
      "html-escape",
      "packages/html-escape/src/index.ts",
      "open any file",
    );
    await pause(world, 900);

    // Comment on the source. Select a phrase → the prose/source comment seam
    // floats the inline "+ Comment" pill; open it, leave a note for an agent,
    // Save, and copy the tray as Markdown to paste straight into claude/codex.
    await selectTextInView(
      world,
      '[data-testid="pierre-file-view"]',
      "zero-dependency leaf package",
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
      .fill("@codex — add a unit test covering all five entities.");
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
      "copy as Markdown → paste into your agent",
      "down",
      700,
    );
    await pause(world, 1100);
  },
};
