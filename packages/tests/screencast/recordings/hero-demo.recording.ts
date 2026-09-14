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

// Two DIFFERENT pre-existing checkouts so the dock groups by repo. T1 runs
// claude in kolu (write-capable — it makes the edit in act 3); T2 runs a
// second claude in drishti WITHOUT permission bypass (its permission question
// is the needs-you beat of act 2).
const DEMO_DIR = path.join(os.homedir(), "demo");
const KOLU = {
  url: "https://github.com/juspay/kolu",
  dir: path.join(DEMO_DIR, "kolu"),
};
const DRISHTI = {
  url: "https://github.com/srid/drishti",
  dir: path.join(DEMO_DIR, "drishti"),
};

// The remote leg: a second machine already seeded as a host (KOLU_PADI_HOST in
// the `record` recipe), with opencode configured there — no first-run gate.
const REMOTE_HOST_NAME = "kolu-bot";
const REMOTE_DIR = "/home/toor/code/xyne-spaces";

/**
 * Launch claude in the ACTIVE terminal and hand it `task` — screen-driven, not
 * timed. A blind boot pause loses the race both ways: a fresh checkout shows
 * the folder-trust gate (typed text lands in the dialog), a warm one boots
 * straight past it (text typed during the splash is swallowed — the attempt-3
 * failure). Poll the focused xterm's buffer: accept the trust gate if it
 * appears, then wait for claude's mounted input (the shortcut/hint line)
 * before typing. THROWS with the screen's own tail if claude never gets there.
 */
async function launchClaudeAndAsk(
  world: KoluWorld,
  command: string,
  task: string,
): Promise<void> {
  await world.terminalRun(command);
  // Markers deliberately absent from the typed command (the shell echoes it).
  const ready = /\? for shortcuts|mode on \(shift\+tab|Try "/;
  const trust = /Do you trust the files/i;
  const deadline = Date.now() + 40_000;
  let trusted = false;
  let buf = "";
  for (;;) {
    buf = await readBufferText(world.page);
    if (!trusted && trust.test(buf)) {
      trusted = true;
      await world.page.keyboard.press("Enter"); // "Yes, I trust this folder"
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
  await pause(world, 800); // let the input settle before typing
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
  // Reuse the checkout, but revert tracked-file edits to pristine — else a prior
  // run's agent edit (the source change) persists and claude finds "no edit
  // needed", so the clip never shows the change. `checkout -- .` reverts
  // tracked files only (keeps untracked, e.g. new-terminal-demo's fixture marker).
  execFileSync("git", ["-C", repo.dir, "checkout", "--", "."], {
    stdio: "ignore",
  });
}

// Off-camera warmup tasks. Claude's is short (it must be back at its prompt
// for the act-3 handoff); the drishti claude runs WITHOUT permission bypass
// and gets a write task, so it deterministically ASKS (a real Claude Code
// permission question → `awaiting_user` → the needs-you strip) — a finished
// answer would only show as unread, never as needs-you. opencode's task is the
// longest so the remote host's asking capsule lights during act 3.
const CLAUDE_WARMUP =
  "Read the README and describe this project in two sentences.";
// `manual` permission mode: every tool use asks. The box's default is "auto"
// (auto-approve), which would never produce the act-2 question.
const CLAUDE_ASK = "claude --model sonnet --permission-mode manual";
const ASK_TASK =
  "Create a NOTES.md summarizing this repository in three bullet points.";
const OPENCODE_TASK =
  "Describe what this service does, in two short sentences.";
// Long-lived colorful output so the third tile's live ring stays lit through
// the whole clip without costing an agent boot.
const WATCH_CMD =
  "watch -c -n1 'git log --graph --oneline --color=always --decorate -18'";

// The file we review + the edit we hand claude. html-escape/src/index.ts opens
// reliably by search (the root README tree-row is flaky headless), and the edit
// — a new entity in the HTML_ENTITIES map — lands as a visible new line in the
// open source view.
const REVIEW_FILE = "packages/html-escape/src/index.ts";
const SELECT_PHRASE = "HTML_ENTITIES";
// The review note left in the comment composer (no "@claude" — it's a normal
// review comment). kolu copies it as Markdown with the file path + quoted line;
// that whole block is pasted to claude, which acts on it.
const REVIEW_NOTE = "Also escape the backtick character here.";

// Everything before this raw-tape second is cut by the transcode (trimStart).
// The fleet build-up — clones, boots, trust gates, host switch, prompts —
// happens inside this window, so the published clip OPENS on the finished
// wide shot: a zoomed-out canvas already alive with working agents.
const TRIM_START_S = 135;

/**
 * The hero — open at the peak, close on a magic trick:
 *
 *  0. (off camera, behind trimStart) Build the fleet: claude in **kolu**,
 *     a live git-graph watch tile, a second claude in **drishti** (no
 *     permission bypass) — plus opencode on the **kolu-bot** remote host in
 *     xyne-spaces. Prompt them all, spread the tiles into distant islands, zoom out.
 *  1. COLD OPEN: the wide shot — agent islands scattered across the canvas,
 *     auras glowing, dock tracking every one (this is the poster) — then a
 *     slow hand-tool PAN across the empty grid and back: the canvas is a
 *     place, not a layout.
 *  2. The drishti claude asks permission to write → the pinned **Needs-you
 *     strip** lights. Click → the camera pans to the buried tile →
 *     **maximize** from the wide shot, ANSWER the question, restore.
 *  3. Jump to claude, reset to 100%: comment on a line in the **Code tab**,
 *     hand it to claude — the open source view **updates live**.
 *  4. The **kolu-bot host tab** lights an attention capsule: opencode, on a
 *     real Linux box, has news. One click → the whole canvas switches machines.
 *  5. Finale: **reload the page**. Every terminal comes back — scrollback,
 *     agents, mid-thought. Zoom back out to the wide shot; the loop closes
 *     where it opened.
 *
 * claude is write-capable (`--dangerously-skip-permissions`); its banner shows
 * the account (email/plan), accepted for this clip. Every on-camera click is
 * telegraphed with a coral arrow. Captured wide (1600×900 → 3200×1800); the
 * minimap stays visible — it's the birds-eye proof the canvas is a place.
 */
export const recording: Recording = {
  name: "hero-demo",
  chrome: "app",
  theme: "TokyoNight Moon", // T1 + default; other tiles pin their own below
  viewport: { width: 1600, height: 900 },
  trimStart: TRIM_START_S,
  // Poster: the cold-open wide shot right after its caption clears — the whole
  // fleet alive at a glance ("many agents, one canvas"), no arrow in frame.
  posterAt: 2,
  async drive(world) {
    const driveStart = Date.now();
    ensureClone(KOLU);
    ensureClone(DRISHTI);
    // The ask-task target is untracked, so `checkout -- .` won't revert it; a
    // leftover from a prior run would let claude answer "already exists"
    // without ever ASKING — and act 2 needs the question.
    fs.rmSync(path.join(DRISHTI.dir, "NOTES.md"), { force: true });

    // ---- Act 0 (off camera — everything here hides behind trimStart) ----

    // tsx (esbuild keepNames) can wrap serialized page-function bodies in a
    // `__name` helper the page doesn't define — shim it up front (and again
    // after the act-5 reload, which wipes page globals).
    const shimPageEval = () =>
      world.page.evaluate(
        "globalThis.__name = globalThis.__name || ((f) => f)",
      );
    await shimPageEval();

    await clearCanvas(world, 500);

    // T1: claude in kolu, warmed up with a short task so its tile glows, but
    // back at its prompt in time for the act-3 handoff.
    const claudeId = await createTerminalByClick(world, "TokyoNight Moon");
    await world.terminalRun(`cd ${KOLU.dir}`);
    await pause(world, 500);
    await launchClaudeAndAsk(world, CLAUDE_SONNET, CLAUDE_WARMUP);
    const claudeRow = `[data-testid="dock-row"][data-terminal-id="${claudeId}"]`;
    await world.page.waitForSelector(`${claudeRow}[data-bucket="working"]`, {
      state: "attached",
      timeout: 30_000,
    });

    // T3: the watch tile — inherits T1's cwd (~/demo/kolu), so no cd.
    const watchId = await createTerminalByClick(world, "Kanagawa Wave");
    await world.terminalRun(WATCH_CMD);
    await pause(world, 400);

    // T2: a second claude in drishti, in manual permission mode. Its write
    // task forces a real permission question — the act-2 needs-you beat.
    const askId = await createTerminalByClick(world, "Rose Pine Moon");
    await world.terminalRun(`cd ${DRISHTI.dir}`);
    await pause(world, 500);
    await launchClaudeAndAsk(world, CLAUDE_ASK, ASK_TASK);
    const askRow = `[data-testid="dock-row"][data-terminal-id="${askId}"]`;
    await world.page.waitForSelector(`${askRow}[data-bucket="working"]`, {
      state: "attached",
      timeout: 30_000,
    });

    // The remote leg: switch to kolu-bot (seeded via KOLU_PADI_HOST, already
    // connecting since boot), start opencode in xyne-spaces, prompt it. Its
    // asking capsule on the host tab is the act-4 beat.
    const botChip = await hostChipCss(world, { name: REMOTE_HOST_NAME });
    if (!botChip) {
      throw new Error(
        `Host chip "${REMOTE_HOST_NAME}" not found — is KOLU_PADI_HOST seeded in the record recipe?`,
      );
    }
    await switchHost(world, botChip);
    // A create right after the switch can still be refused ("Daemon is
    // starting — try again in a moment"): the interstitial can clear before
    // the daemon accepts creates. Retry a few times; Escape first so a
    // half-open palette from the failed attempt can't eat the next click.
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
    await pause(world, 7000); // opencode TUI boots (configured host — no first-run gate)
    await world.terminalRun(OPENCODE_TASK);
    await pause(world, 1500);

    // Back home; compose the wide shot: zoom out until the cascade of tiles
    // fits. (No arrange-by-repo — it scatters tiles into distant columns and
    // forces an unreadable ~30% zoom; the natural cascade reads better.)
    const homeChip = await hostChipCss(world, { index: 0 });
    if (!homeChip) throw new Error("Local host chip not found");
    await switchHost(world, homeChip);

    // Spread the fleet into ISLANDS — AFTER the host round-trip (a host
    // switch remounts the canvas and re-frames the camera, invalidating any
    // earlier placement) and via the layout RPC, not mouse drags (the
    // titlebar's title/status text intercepts the pointer at low zoom, so
    // drags silently no-op — the attempt-21 failure). Absolute canvas
    // coordinates, sizes preserved; offsets sized so that centering claude at
    // ~64% zoom composes the wide shot, with the far tiles bleeding slightly
    // past the frame edge — the canvas visibly continues beyond the viewport.
    {
      const spots: ReadonlyArray<readonly [string, number, number]> = [
        [claudeId, 100, 100], // kolu claude → north-west anchor
        [watchId, 980, 40], // watch → east, nudged up
        [askId, 500, 660], // drishti claude → south, between them
      ];
      for (const [id, x, y] of spots) {
        const box = await world.page
          .locator(`[data-testid="canvas-tile"][data-terminal-id="${id}"]`)
          .boundingBox();
        if (!box) throw new Error(`island layout: tile ${id} has no box`);
        // Camera is at 100% here (fresh per-host mount), so screen size ==
        // canvas size.
        await padiCall("chrome/setCanvasLayout", {
          id,
          layout: { x, y, w: box.width, h: box.height },
        });
      }
      await pause(world, 600);
      // Frame the shot: center claude, then zoom to 64% about the center.
      await world.page
        .locator(`[data-testid="dock-row"][data-terminal-id="${claudeId}"]`)
        .click();
      await pause(world, 500);
      await zoomOutToLevel(world, 0.65);
      await pause(world, 400);
    }
    // Re-pin the tile themes: the pin at creation races the app's own theme
    // assignment (attempt 3 filmed every tile on the default), and a repeat
    // here is idempotent + invisible (no palette flash on an unchanged value).
    // Uncaught variant so a refusal shows up in the run log instead of
    // silently filming default-themed tiles again.
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

    // Hold the wide shot until the raw tape reaches trimStart. Capture began
    // BEFORE drive() (the Background navigation is on tape too), so gating on
    // drive-elapsed guarantees everything after this line survives the cut.
    const sinceDrive = Date.now() - driveStart;
    if (sinceDrive < TRIM_START_S * 1000) {
      await pause(world, TRIM_START_S * 1000 - sinceDrive);
    }

    // Every ON-CAMERA beat below is scaled ~2.8× because the X11 grab tops out
    // well under real-time, so the published clip plays as a ~2.9× timelapse —
    // unscaled holds flash by unreadably. Act 0's timings stay real-time: they
    // are cut by trimStart and never reach the screen.

    // ---- Act 1: cold open — the fleet, already alive ----
    await annotate(
      world,
      '[data-testid="dock"]',
      "a fleet of agents — two machines, one canvas",
      "right",
    );
    await pause(world, 4500);
    await clearAnnotations(world);

    // The canvas is a PLACE: grab it with the hand tool and drift — the
    // islands slide off-frame, empty grid rolls past, the minimap's viewport
    // rectangle tracks the travel — then drift back. This is the one beat
    // whose duration we own (the app's 150ms jump-pans are a blink under the
    // timelapse), so it goes slow.
    await annotate(
      world,
      '[data-testid="canvas-minimap"]',
      "an infinite canvas — go anywhere",
      "up",
    );
    // Moderate travel: the fleet shifts by about a third of the frame, so the
    // camera glides BETWEEN islands — tiles always in view, never a pan into
    // pure vacuum — then glides back.
    await handPan(world, { fromX: 1020, fromY: 680, dx: -400, dy: -220 });
    await pause(world, 400);
    await handPan(world, { fromX: 620, fromY: 460, dx: 400, dy: 220 });
    await pause(world, 500);
    await clearAnnotations(world);

    // ---- Act 2: an agent needs you — jump, maximize, ANSWER it ----
    const askEntry = `[data-testid="dock-needs-you-entry"][data-terminal-id="${askId}"]`;
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
    await pause(world, 1300); // animated pan lands

    const maximizeBtn =
      '[data-testid="canvas-tile"][data-active] [data-testid="canvas-tile-maximize"]';
    await clickWithArrow(world, maximizeBtn, "maximize", "down", 1700);
    await pause(world, 3200); // read claude's permission question full-screen
    await annotate(
      world,
      '[data-testid="canvas-tile"][data-maximized="true"]',
      "answer it right here",
      "left",
    );
    await pause(world, 2500);
    await world.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await world.page.keyboard.press("Enter"); // approve — claude resumes
    await clearAnnotations(world);
    await pause(world, 3600); // claude writes the file, on camera
    await clickWithArrow(
      world,
      maximizeBtn,
      "back to the canvas",
      "down",
      1400,
    );
    await pause(world, 1000);

    // ---- Act 3: comment on code → claude edits it, live ----
    await clickWithArrow(
      world,
      claudeRow,
      "any terminal, one click away",
      "left",
      1800,
    );
    await pause(world, 1000);
    await resetCanvasZoom(world); // cut in to 100% on claude's tile
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

    // Hand it to claude (its tile is the active one) by pasting the COPIED
    // comment AS-IS — no handwritten prompt. kolu wrote the comment to the
    // clipboard as Markdown (path + quoted line + the note); read it back and
    // dispatch a real paste event (bracketed paste) on the focused terminal so
    // the multi-line block lands intact. Enter submits; claude acts on the
    // review note and edits the file. Wait for it to finish (dock → awaiting);
    // by then the open source view has live-reloaded with the change.
    let comment = "";
    for (let i = 0; i < 5 && !comment.trim(); i++) {
      comment = await world.page
        .evaluate(() => navigator.clipboard.readText())
        .catch(() => "");
      if (!comment.trim()) await pause(world, 400);
    }
    if (!comment.trim()) {
      // Clipboard came back empty (attempt-7 failure mode) — reconstruct the
      // handoff from what we know; the on-camera story is identical.
      console.log("[hero-demo] clipboard empty after copy — using fallback");
      comment = `Review comment in ${REVIEW_FILE} (at ${SELECT_PHRASE}):\n${REVIEW_NOTE}`;
    }
    await world.focusForTyping("[data-visible]:not([data-sub-terminal])");
    await world.page.evaluate((text) => {
      // Target claude's textarea explicitly — document.activeElement can be
      // the copy button we just clicked.
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
    // Screen-driven submit: wait for the pasted block to actually render in
    // claude's input (an Enter inside the paste debounce is silently dropped —
    // the exact race the Compose box exists to avoid), then submit, retrying
    // the Enter if claude's turn doesn't start.
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
          .waitForSelector(`${claudeRow}[data-bucket="working"]`, {
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
    // Turn over = the row leaves "working". A finished turn paints "linger"
    // (just-finished), not "awaiting" — awaiting means asking, and this claude
    // bypasses permissions, so waiting for "awaiting" alone would time out.
    await world.page.waitForSelector(
      `${claudeRow}:is([data-bucket="linger"], [data-bucket="awaiting"], [data-bucket="idle"], [data-bucket="none"])`,
      { state: "attached", timeout: 120_000 },
    );
    await pause(world, 600); // let the preview's live-reload settle

    // The open source view just changed itself — claude's edit, live.
    await annotate(
      world,
      '[data-testid="pierre-file-view"]',
      "claude edited the file — live",
      "left",
    );
    await pause(world, 5000);
    await clearAnnotations(world);

    // ---- Act 4: another machine taps you on the shoulder ----
    // kolu-bot's opencode runs with permission "allow", so it finishes rather
    // than asks: accept EITHER attention capsule on the host tab — violet
    // asking or amber finished-unseen — then enter the machine via its tab.
    // The capsule is the ideal beat but not load-bearing: if it never lights
    // (remote agent-state plumbing has been flaky here), log the chip's actual
    // DOM and play the beat anyway — the tab click and the landing still work.
    const capsule = await world.page
      .waitForSelector(
        `${botChip} :is([data-testid="attention-asking"], [data-testid="attention-unseen"])`,
        { state: "visible", timeout: 60_000 },
      )
      .then(() => true)
      .catch(() => false);
    if (!capsule) {
      const chipHtml = await world.page
        .evaluate(
          (sel) => document.querySelector(sel)?.outerHTML ?? "(chip missing)",
          botChip,
        )
        .catch(() => "(eval failed)");
      console.log(
        `[hero-demo] no attention capsule on ${REMOTE_HOST_NAME}; chip: ${chipHtml.slice(0, 1500)}`,
      );
    }
    await annotate(world, botChip, "your other machine has news", "down");
    await pause(world, 3500);
    await clearAnnotations(world);
    await clickWithArrow(
      world,
      `${botChip} [data-testid="host-select"]`,
      "click → land on that box",
      "down",
      1800,
    );
    await pause(world, 2500); // host switch + center on opencode's tile
    await annotate(
      world,
      '[data-testid="canvas-tile"][data-active]',
      "a real Linux box — same window",
      "left",
    );
    await pause(world, 6000);
    await clearAnnotations(world);

    // ---- Act 5: the magic trick — reload, everything survives ----
    await switchHost(world, homeChip, { arrowLabel: "and back" });
    await pause(world, 1200);
    await world.page.reload();
    await shimPageEval();
    await world.waitForSettled(60_000);
    await pause(world, 3000); // tiles restore, scrollback repaints
    await annotate(
      world,
      '[data-testid="dock"]',
      "reloaded — every terminal survived",
      "right",
    );
    await pause(world, 6000);
    await clearAnnotations(world);

    // Close where we opened: the wide shot — same framing as the cold open
    // (center claude, 64%), so the muted loop reads seamless.
    await world.page
      .locator(`[data-testid="dock-row"][data-terminal-id="${claudeId}"]`)
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
  },
};
