import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readBufferText } from "../../support/buffer.ts";
import { padiCall } from "../../support/rpcWire.ts";
import type { KoluWorld } from "../../support/world";
import {
  annotate,
  CLAUDE_SONNET,
  clearAnnotations,
  clearCanvas,
  clickWithArrow,
  createTerminalByClick,
  handPan,
  hostChipCss,
  openFileBySearch,
  pause,
  resetCanvasZoom,
  selectTextInView,
  switchHost,
  zoomOutToLevel,
} from "./helpers";
import type { Recording } from "./types";

const DEMO_DIR = path.join(os.homedir(), "demo");
const KOLU = {
  url: "https://github.com/juspay/kolu",
  dir: path.join(DEMO_DIR, "kolu"),
};
const DRISHTI = {
  url: "https://github.com/srid/drishti",
  dir: path.join(DEMO_DIR, "drishti"),
};

const REMOTE_HOST_NAME = "kolu-bot";
const REMOTE_DIR = "/home/toor/code/xyne-spaces";

async function launchClaudeAndAsk(
  world: KoluWorld,
  command: string,
  task: string,
): Promise<void> {
  await world.terminalRun(command);
  const ready = /\? for shortcuts|mode on \(shift\+tab|Try "/;
  const trust = /Do you trust the files/i;
  const deadline = Date.now() + 40_000;
  let trusted = false;
  let buf = "";
  for (;;) {
    buf = await readBufferText(world.page);
    if (!trusted && trust.test(buf)) {
      trusted = true;
      await world.page.keyboard.press("Enter");
      await pause(world, 900);
      continue;
    }
    if (ready.test(buf)) break;
    if (Date.now() > deadline) {
      throw new Error(
        `claude never reached its input box; screen tail:\n${buf.split("\n").slice(-12).join("\n")}`,
      );
    }
    await pause(world, 500);
  }
  await pause(world, 800);
  await world.terminalRun(task);
}

function ensureClone(repo: { url: string; dir: string }): void {
  if (!fs.existsSync(path.join(repo.dir, ".git"))) {
    fs.mkdirSync(DEMO_DIR, { recursive: true });
    execFileSync("git", ["clone", "--depth", "1", repo.url, repo.dir], {
      stdio: "ignore",
    });
    return;
  }
  execFileSync("git", ["-C", repo.dir, "checkout", "--", "."], {
    stdio: "ignore",
  });
}

const CLAUDE_WARMUP =
  "Read the README and describe this project in two sentences.";
const CLAUDE_ASK = "claude --model sonnet --permission-mode manual";
const ASK_TASK =
  "Create a NOTES.md summarizing this repository in three bullet points.";
const OPENCODE_TASK =
  "Describe what this service does, in two short sentences.";
const WATCH_CMD =
  "watch -c -n1 'git log --graph --oneline --color=always --decorate -18'";

const REVIEW_FILE = "packages/html-escape/src/index.ts";
const SELECT_PHRASE = "HTML_ENTITIES";
const REVIEW_NOTE = "Also escape the backtick character here.";

const TRIM_START_S = 135;

export const recording: Recording = {
  name: "hero-demo",
  chrome: "app",
  theme: "TokyoNight Moon",
  viewport: { width: 1600, height: 900 },
  trimStart: TRIM_START_S,
  posterAt: 2,
  async drive(world) {
    const cast = await act0OffCamera(world);
    await act1ColdOpen(world);
    await act2NeedsYou(world, cast);
    await act3CommentToEdit(world, cast);
    await act4OtherMachine(world, cast);
    await act5Reload(world, cast);
  },
};

type Cast = {
  claudeId: string;
  claudeRow: string;
  askId: string;
  botChip: string;
  homeChip: string;
};

// tsx (esbuild keepNames) can wrap serialized page-function bodies in a
// `__name` helper the page doesn't define — shim it up front (and again
// after the act-5 reload, which wipes page globals).
function defineNameShimForSerializedPageFns(world: KoluWorld): Promise<void> {
  return world.page.evaluate(
    "globalThis.__name = globalThis.__name || ((f) => f)",
  );
}

async function act0OffCamera(world: KoluWorld): Promise<Cast> {
  const driveStart = Date.now();
  ensureClone(KOLU);
  ensureClone(DRISHTI);
  fs.rmSync(path.join(DRISHTI.dir, "NOTES.md"), { force: true });

  await defineNameShimForSerializedPageFns(world);

  await clearCanvas(world, 500);

  const claudeId = await createTerminalByClick(world, "TokyoNight Moon");
  await world.terminalRun(`cd ${KOLU.dir}`);
  await pause(world, 500);
  await launchClaudeAndAsk(world, CLAUDE_SONNET, CLAUDE_WARMUP);
  const claudeRow = `[data-testid="dock-row"][data-terminal-id="${claudeId}"]`;
  await world.page.waitForSelector(`${claudeRow}[data-bucket="working"]`, {
    state: "attached",
    timeout: 30_000,
  });

  const watchId = await createTerminalByClick(world, "Kanagawa Wave");
  await world.terminalRun(WATCH_CMD);
  await pause(world, 400);

  const askId = await createTerminalByClick(world, "Rose Pine Moon");
  await world.terminalRun(`cd ${DRISHTI.dir}`);
  await pause(world, 500);
  await launchClaudeAndAsk(world, CLAUDE_ASK, ASK_TASK);
  const askRow = `[data-testid="dock-row"][data-terminal-id="${askId}"]`;
  await world.page.waitForSelector(`${askRow}[data-bucket="working"]`, {
    state: "attached",
    timeout: 30_000,
  });

  const botChip = await hostChipCss(world, { name: REMOTE_HOST_NAME });
  if (!botChip) {
    throw new Error(
      `Host chip "${REMOTE_HOST_NAME}" not found — is KOLU_PADI_HOST seeded in the record recipe?`,
    );
  }
  await switchHost(world, botChip);
  let remoteCreated = false;
  for (let attempt = 0; attempt < 4 && !remoteCreated; attempt++) {
    try {
      await createTerminalByClick(world);
      remoteCreated = true;
    } catch {
      await world.page.keyboard.press("Escape");
      await pause(world, 4000);
    }
  }
  if (!remoteCreated) {
    throw new Error(`could not create a terminal on ${REMOTE_HOST_NAME}`);
  }
  await world.terminalRun(`cd ${REMOTE_DIR}`);
  await pause(world, 500);
  await world.terminalRun("opencode");
  await pause(world, 7000);
  await world.terminalRun(OPENCODE_TASK);
  await pause(world, 1500);

  const homeChip = await hostChipCss(world, { index: 0 });
  if (!homeChip) throw new Error("Local host chip not found");
  await switchHost(world, homeChip);

  {
    const spots: ReadonlyArray<readonly [string, number, number]> = [
      [claudeId, 100, 100],
      [watchId, 980, 40],
      [askId, 500, 660],
    ];
    for (const [id, x, y] of spots) {
      const box = await world.page
        .locator(`[data-testid="canvas-tile"][data-terminal-id="${id}"]`)
        .boundingBox();
      if (!box) throw new Error(`island layout: tile ${id} has no box`);
      await padiCall("chrome/setCanvasLayout", {
        id,
        layout: { x, y, w: box.width, h: box.height },
      });
    }
    await pause(world, 600);
    await world.page
      .locator(`[data-testid="dock-row"][data-terminal-id="${claudeId}"]`)
      .click();
    await pause(world, 500);
    await zoomOutToLevel(world, 0.65);
    await pause(world, 400);
  }
  for (const [id, themeName] of [
    [claudeId, "TokyoNight Moon"],
    [watchId, "Kanagawa Wave"],
    [askId, "Rose Pine Moon"],
  ] as const) {
    try {
      await padiCall("chrome/setTheme", { id, themeName });
    } catch (e) {
      console.log(`[hero-demo] theme pin ${themeName} failed: ${String(e)}`);
    }
  }

  const sinceDrive = Date.now() - driveStart;
  if (sinceDrive < TRIM_START_S * 1000) {
    await pause(world, TRIM_START_S * 1000 - sinceDrive);
  }
  return { claudeId, claudeRow, askId, botChip, homeChip };
}

async function act1ColdOpen(world: KoluWorld): Promise<void> {
  await annotate(
    world,
    '[data-testid="dock"]',
    "a fleet of agents — two machines, one canvas",
    "right",
  );
  await pause(world, 4500);
  await clearAnnotations(world);

  await annotate(
    world,
    '[data-testid="canvas-minimap"]',
    "an infinite canvas — go anywhere",
    "up",
  );
  await handPan(world, { fromX: 1020, fromY: 680, dx: -400, dy: -220 });
  await pause(world, 400);
  await handPan(world, { fromX: 620, fromY: 460, dx: 400, dy: 220 });
  await pause(world, 500);
  await clearAnnotations(world);
}

async function act2NeedsYou(world: KoluWorld, cast: Cast): Promise<void> {
  const askEntry = `[data-testid="dock-needs-you-entry"][data-terminal-id="${cast.askId}"]`;
  await world.page.waitForSelector(askEntry, {
    state: "visible",
    timeout: 90_000,
  });
  await annotate(
    world,
    '[data-testid="dock-needs-you-strip"]',
    "an agent needs you — pinned, never lost",
    "right",
  );
  await pause(world, 4000);
  await clearAnnotations(world);
  await clickWithArrow(world, askEntry, "click → jump to it", "right", 1700);
  await pause(world, 1300);

  const maximizeBtn =
    '[data-testid="canvas-tile"][data-active] [data-testid="canvas-tile-maximize"]';
  await clickWithArrow(world, maximizeBtn, "maximize", "down", 1700);
  await pause(world, 3200);
  await annotate(
    world,
    '[data-testid="canvas-tile"][data-maximized="true"]',
    "answer it right here",
    "left",
  );
  await pause(world, 2500);
  await world.focusForTyping("[data-visible]:not([data-sub-terminal])");
  await world.page.keyboard.press("Enter");
  await clearAnnotations(world);
  await pause(world, 3600);
  await clickWithArrow(world, maximizeBtn, "back to the canvas", "down", 1400);
  await pause(world, 1000);
}

async function act3CommentToEdit(world: KoluWorld, cast: Cast): Promise<void> {
  await clickWithArrow(
    world,
    cast.claudeRow,
    "any terminal, one click away",
    "left",
    1800,
  );
  await pause(world, 1000);
  await resetCanvasZoom(world);
  await pause(world, 500);

  await clickWithArrow(
    world,
    '[data-testid="right-panel-tab-code"]',
    "the Code tab — kolu's files",
    "down",
    1400,
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
  await pause(world, 1700);
  await world.page
    .locator('[data-testid="kolu-comment-pill"]')
    .dispatchEvent("mousedown");
  await world.waitForFrame();
  await clearAnnotations(world);
  await world.page
    .locator('[data-testid="kolu-comment-composer"] textarea')
    .fill(REVIEW_NOTE);
  await pause(world, 1000);
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
    "copy the comment",
    "down",
    1800,
  );
  await pause(world, 500);

  let comment = "";
  for (let i = 0; i < 5 && !comment.trim(); i++) {
    comment = await world.page
      .evaluate(() => navigator.clipboard.readText())
      .catch(() => "");
    if (!comment.trim()) await pause(world, 400);
  }
  if (!comment.trim()) {
    console.log("[hero-demo] clipboard empty after copy — using fallback");
    comment = `Review comment in ${REVIEW_FILE} (at ${SELECT_PHRASE}):\n${REVIEW_NOTE}`;
  }
  await world.focusForTyping("[data-visible]:not([data-sub-terminal])");
  await world.page.evaluate((text) => {
    const el =
      document.querySelector(
        '[data-testid="canvas-tile"][data-active] .xterm-helper-textarea',
      ) ?? document.activeElement;
    if (!el) return;
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, comment);
  {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const buf = await readBufferText(world.page);
      if (/Pasted text|escape the backtick/.test(buf)) break;
      await pause(world, 300);
    }
    await pause(world, 700);
    let working = false;
    for (let i = 0; i < 3 && !working; i++) {
      await world.page.keyboard.press("Enter");
      working = await world.page
        .waitForSelector(`${cast.claudeRow}[data-bucket="working"]`, {
          state: "attached",
          timeout: 8_000,
        })
        .then(() => true)
        .catch(() => false);
    }
    if (!working) {
      throw new Error("claude never started its turn after the paste");
    }
  }
  await world.page.waitForSelector(
    `${cast.claudeRow}:is([data-bucket="linger"], [data-bucket="awaiting"], [data-bucket="idle"], [data-bucket="none"])`,
    { state: "attached", timeout: 120_000 },
  );
  await pause(world, 600);

  await annotate(
    world,
    '[data-testid="pierre-file-view"]',
    "claude edited the file — live",
    "left",
  );
  await pause(world, 5000);
  await clearAnnotations(world);
}

async function act4OtherMachine(world: KoluWorld, cast: Cast): Promise<void> {
  const capsule = await world.page
    .waitForSelector(
      `${cast.botChip} :is([data-testid="attention-asking"], [data-testid="attention-unseen"])`,
      { state: "visible", timeout: 60_000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!capsule) {
    const chipHtml = await world.page
      .evaluate(
        (sel) => document.querySelector(sel)?.outerHTML ?? "(chip missing)",
        cast.botChip,
      )
      .catch(() => "(eval failed)");
    console.log(
      `[hero-demo] no attention capsule on ${REMOTE_HOST_NAME}; chip: ${chipHtml.slice(0, 1500)}`,
    );
  }
  await annotate(world, cast.botChip, "your other machine has news", "down");
  await pause(world, 3500);
  await clearAnnotations(world);
  await clickWithArrow(
    world,
    `${cast.botChip} [data-testid="host-select"]`,
    "click → land on that box",
    "down",
    1800,
  );
  await pause(world, 2500);
  await annotate(
    world,
    '[data-testid="canvas-tile"][data-active]',
    "a real Linux box — same window",
    "left",
  );
  await pause(world, 6000);
  await clearAnnotations(world);
}

async function act5Reload(world: KoluWorld, cast: Cast): Promise<void> {
  await switchHost(world, cast.homeChip, { arrowLabel: "and back" });
  await pause(world, 1200);
  await world.page.reload();
  await defineNameShimForSerializedPageFns(world);
  await world.waitForSettled(60_000);
  await pause(world, 3000);
  await annotate(
    world,
    '[data-testid="dock"]',
    "reloaded — every terminal survived",
    "right",
  );
  await pause(world, 6000);
  await clearAnnotations(world);

  await world.page
    .locator(`[data-testid="dock-row"][data-terminal-id="${cast.claudeId}"]`)
    .click();
  await pause(world, 500);
  await zoomOutToLevel(world, 0.65);
  await pause(world, 400);
  await annotate(
    world,
    '[data-testid="host-chip-row"]',
    "agents on every machine — kolu is the window",
    "down",
  );
  await pause(world, 7000);
  await clearAnnotations(world);
}
