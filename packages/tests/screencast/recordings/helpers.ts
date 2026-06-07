// Shared kolu-domain helpers for authoring recordings. (Kolu domain — knows
// about claude/terminals; depends on the World, never on the engine.)
import type { KoluWorld } from "../../support/world";

/** Sleep `ms` — paces a recording at human speed. */
export const pause = (world: KoluWorld, ms: number): Promise<void> =>
  world.page.waitForTimeout(ms);

/**
 * Wait for any dock row to reach `bucket` ("working" | "awaiting" | "idle").
 * Qualified on `data-testid="dock-row"` so it never matches a canvas-minimap
 * rect (which also carries `data-bucket`). The high-level state is `data-bucket`;
 * `data-agent-state` is the raw state ("thinking"/"tool_use"/"waiting"), which is
 * NOT what we poll here.
 *
 * THROWS on timeout (no `.catch`): a dock transition that never happens means
 * the live agent didn't run/finish — that must FAIL the recording, not silently
 * film a clip where the dock never lights up. (This is the load-bearing
 * assertion the codex review made the dock waits carry.)
 */
export function waitForDockBucket(
  world: KoluWorld,
  bucket: "working" | "awaiting" | "idle",
  timeout: number,
): Promise<unknown> {
  return world.page.waitForSelector(
    `[data-testid="dock-row"][data-bucket="${bucket}"]`,
    { state: "attached", timeout },
  );
}

// The theme the current recording pins (set by the dispatcher from
// `Recording.theme`); `newTerminal` applies it to each terminal it creates.
let activeTheme: string | undefined;
export const setActiveTheme = (name?: string): void => {
  activeTheme = name;
};

/**
 * Clear the canvas to a clean empty state: wait for the app, kill any
 * auto-restored terminal (the app-mode session can carry one), wait for the
 * canvas to empty, then hold a short beat on it. Recordings open with this so
 * the clip starts on a deliberate empty canvas — then create terminals on
 * camera.
 */
export async function clearCanvas(
  world: KoluWorld,
  beatMs = 800,
): Promise<void> {
  await world.waitForReady();
  await world.page
    .evaluate(() =>
      fetch("/rpc/terminal/killAll", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    )
    .catch(() => undefined);
  for (let i = 0; i < 20; i++) {
    if ((await world.terminalIds()).length === 0) break;
    await pause(world, 300);
  }
  await pause(world, beatMs); // a beat on the empty canvas
}

/**
 * The shared opening for a single-terminal demo: clear the canvas, create one
 * themed terminal, and nudge its tile clear of the (visible) dock so the dock
 * doesn't overlap the content. Returns the terminal id. Recordings then just
 * run their commands.
 */
export async function setupSingleTerminal(world: KoluWorld): Promise<string> {
  await clearCanvas(world, 3500); // wide beat for a clean trim (new-terminal-demo)
  const id = await newTerminal(world);
  await pause(world, 600);
  await nudgeClearOfDock(world);
  await pause(world, 400);
  return id;
}

/** Drag the active tile right just far enough that the dock no longer covers
 *  it (dock-width-aware, with a small margin). No-op if already clear. */
async function nudgeClearOfDock(world: KoluWorld): Promise<void> {
  const dock = await world.page
    .locator('[data-testid="dock"]')
    .boundingBox()
    .catch(() => null);
  const bar = world.page
    .locator('[data-testid="canvas-tile-titlebar"]')
    .first();
  const tile = await bar.boundingBox().catch(() => null);
  if (!dock || !tile) return;
  const delta = dock.x + dock.width + 24 - tile.x; // clear the dock + 24px
  if (delta <= 0) return;
  const sx = tile.x + tile.width / 2;
  const sy = tile.y + tile.height / 2;
  await world.page.mouse.move(sx, sy);
  await world.page.mouse.down();
  await world.page.mouse.move(sx + delta, sy, { steps: 12 });
  await world.page.mouse.up();
  await world.waitForFrame();
}

/** Pin a theme on a terminal via the `setTheme` RPC (invisible — no palette
 *  flash). Names come from packages/terminal-themes (e.g. "Vaughn",
 *  "Catppuccin Latte"). */
export async function setTerminalThemeRpc(
  world: KoluWorld,
  id: string,
  themeName: string,
): Promise<void> {
  await world.page
    .evaluate(
      async ({ id, themeName }) => {
        await fetch("/rpc/terminal/setTheme", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: { id, themeName } }),
        });
      },
      { id, themeName },
    )
    .catch(() => undefined);
}

/** Create a terminal (via the keyboard shortcut) and pin a theme on it —
 *  defaults to the recording's `activeTheme`, override per terminal. Use instead
 *  of `world.createTerminal()` in recordings so clips share a consistent look. */
export async function newTerminal(
  world: KoluWorld,
  themeName = activeTheme,
): Promise<string> {
  const id = await world.createTerminal();
  if (themeName) {
    await setTerminalThemeRpc(world, id, themeName);
    await pause(world, 300);
  }
  return id;
}

/** Like {@link newTerminal}, but created by *clicking the dock's "+" button* —
 *  a visible on-camera action (telegraphed with a coral arrow) instead of a
 *  hidden keyboard shortcut. Mirrors world.createTerminal's id-diff to learn the
 *  new terminal's id. Returns it. */
export async function createTerminalByClick(
  world: KoluWorld,
  themeName = activeTheme,
  arrowLabel = "click + to open a terminal",
): Promise<string> {
  const before = await world.terminalIds();
  await clickWithArrow(world, '[data-testid="dock-new"]', arrowLabel, "left");
  // Clicking "+" opens the new-terminal palette ("In current directory" is the
  // default row); Enter confirms it → a plain shell in the current directory.
  await pause(world, 700);
  await world.page.keyboard.press("Enter");
  await world.page.waitForFunction(
    (prev) => {
      const ids = Array.from(document.querySelectorAll("[data-terminal-id]"))
        .map((n) => n.getAttribute("data-terminal-id"))
        .filter((id): id is string => !!id);
      return ids.some((id) => !prev.includes(id));
    },
    before,
    { timeout: 15_000 },
  );
  const after = await world.terminalIds();
  const id = after.find((i) => !before.includes(i));
  if (!id) throw new Error("clicked + but no new terminal id appeared");
  if (themeName) {
    await setTerminalThemeRpc(world, id, themeName);
    await pause(world, 300);
  }
  return id;
}

/**
 * Open a SECOND terminal that slightly overlaps — and buries — the currently
 * active tile. The canvas already cascades a new tile on top at an offset; we
 * then drag it to a deterministic `(dx, dy)` offset over the base tile so the
 * overlap is reliable run-to-run (the base tile's content ends up hidden behind
 * it). Returns the new terminal id. Used to demo the dock surfacing an agent
 * that's hidden behind another tile.
 */
export async function openOverlappingTerminal(
  world: KoluWorld,
  opts: { theme?: string; dx?: number; dy?: number } = {},
): Promise<string> {
  const dx = opts.dx ?? 72;
  const dy = opts.dy ?? 64;
  const activeBar = () =>
    world.page
      .locator(
        '[data-testid="canvas-tile"][data-active="true"] [data-testid="canvas-tile-titlebar"]',
      )
      .boundingBox()
      .catch(() => null);
  // The base tile is the active one NOW — capture it before creating the new
  // tile (after creation the active selector points at the NEW tile).
  const base = await activeBar();
  // Created by clicking "+" (visible, arrowed), themed per opts.theme.
  const id = await createTerminalByClick(
    world,
    opts.theme,
    "click + for a second terminal",
  );
  await pause(world, 300);
  const fresh = await activeBar();
  if (base && fresh) {
    // Drag the new tile so its titlebar sits at base + (dx, dy): grabbing the
    // titlebar and moving the cursor by (targetTopLeft − currentTopLeft) shifts
    // the tile by that delta.
    const sx = fresh.x + fresh.width / 2;
    const sy = fresh.y + fresh.height / 2;
    const ex = sx + (base.x + dx - fresh.x);
    const ey = sy + (base.y + dy - fresh.y);
    await world.page.mouse.move(sx, sy);
    await world.page.mouse.down();
    await world.page.mouse.move(ex, ey, { steps: 16 });
    await world.page.mouse.up();
    await world.waitForFrame();
  }
  return id;
}

/** claude on the cheap model. `--dangerously-skip-permissions` drops per-tool
 *  prompts but NOT the folder-trust gate (accept it via `acceptTrustGate`).
 *  Shows the account banner (name/email/plan) — use {@link CODEX_AUTONOMOUS}
 *  for clips that must not surface personal identity. */
export const CLAUDE_SONNET =
  "claude --dangerously-skip-permissions --model sonnet";

/** codex, INTERACTIVE + autonomous: `--ask-for-approval never` (no per-command
 *  prompts) + `--sandbox read-only` (safe; enough to read + explain — and it
 *  avoids the `--dangerously-bypass…` danger-confirmation). Stays interactive so
 *  the dock reaches `awaiting` after it answers. Identity-neutral startup
 *  (provider/model/session-uuid — no name/email/plan), so it's the default. */
export const CODEX_AUTONOMOUS =
  "codex --ask-for-approval never --sandbox read-only";

export interface LaunchAgentOptions {
  /** Agent CLI + flags. Defaults to {@link CLAUDE_SONNET}. */
  command?: string;
  /** The prompt, typed after the agent is up (skipped if absent). */
  prompt?: string;
  /** Press Enter once to accept a first-run trust prompt (claude's folder-trust
   *  gate, codex's directory-trust). Default true. */
  acceptTrustGate?: boolean;
  /** ms to wait for the trust prompt / startup intro before pressing Enter. */
  trustMs?: number;
  /** ms to wait for the agent to be ready for input before typing the prompt. */
  bootMs?: number;
  /** ms to hold on the finished answer (dock glowing at awaiting). */
  dwellMs?: number;
}

/**
 * Launch an agent in the active terminal and (optionally) ask it something —
 * the reusable climax of a product demo. Keep the dock in shot: its row tracks
 * the agent live, and we wait for it to flip **working → awaiting** (i.e. the
 * agent actually answered) rather than dwelling a fixed time. Shared across
 * recordings (this one and future ones).
 *
 * Claude's first run in a folder shows a "trust this folder" gate; Enter
 * accepts the default ("Yes, I trust"). `--dangerously-skip-permissions` only
 * covers the per-tool prompts *during* the query, not this gate — so we accept
 * it explicitly before typing the prompt (otherwise the prompt lands in the
 * gate and mangles).
 */
export async function launchAgentAndAsk(
  world: KoluWorld,
  opts: LaunchAgentOptions = {},
): Promise<void> {
  await world.terminalRun(opts.command ?? CLAUDE_SONNET);
  if (opts.acceptTrustGate ?? true) {
    await pause(world, opts.trustMs ?? 2500); // folder-trust gate appears
    await world.page.keyboard.press("Enter"); // accept "Yes, I trust this folder"
  }
  await pause(world, opts.bootMs ?? 2500); // agent loads, ready for input
  if (!opts.prompt) return;

  await world.terminalRun(opts.prompt);
  // Wait for the dock bucket to go working → awaiting (the answer is on screen
  // and the row has stopped pulsing). These two waits are LOAD-BEARING — see
  // waitForDockBucket: they prove the live agent ran and finished, the whole
  // point of the clip, and THROW if the dock never lights up. (The annotations
  // that follow are best-effort visual polish and stay caught.)
  //
  // Working: point at the agent's live state in two places — the title-bar
  // badge (state + context tokens) and the dock row now tracking it.
  await waitForDockBucket(world, "working", 20_000);
  await annotate(
    world,
    '[data-testid="agent-indicator"]',
    "live state + tokens",
    "up",
  );
  await annotate(
    world,
    '[data-testid="dock-row"][data-bucket="working"]',
    "…mirrored on the dock",
    "up",
  );
  await pause(world, 3000);

  // Done: the agent answered — the dock flips to awaiting ("your turn").
  await waitForDockBucket(world, "awaiting", 90_000);
  await clearAnnotations(world);
  await annotate(
    world,
    '[data-testid="dock-row"][data-bucket="awaiting"]',
    "agent finished — your turn",
    "up",
  );
  await pause(world, opts.dwellMs ?? 2800); // hold on the answer + annotation
}

type ArrowDir = "up" | "down" | "left" | "right";

/**
 * Overlay a clearly-EXTERNAL coral arrow + label pointing at `selector` (the
 * arrow points toward the element from `dir`'s side). A drawn annotation reads
 * as "the clip is showing you this" — a CSS ring read as kolu's own UI. Tagged
 * so `clearAnnotations` can drop them between phases. Reusable across recordings.
 */
export async function annotate(
  world: KoluWorld,
  selector: string,
  label: string,
  dir: ArrowDir = "up",
): Promise<void> {
  await world.page
    .evaluate(
      ({ selector, label, dir }) => {
        const target = document.querySelector(selector);
        if (!target) return;
        const r = target.getBoundingClientRect();
        const C = "#ff7a59";
        const paths: Record<string, string> = {
          up: "M17 30 V10 M17 6 L10 16 M17 6 L24 16",
          down: "M17 4 V24 M17 28 L10 18 M17 28 L24 18",
          left: "M30 17 H10 M6 17 L16 10 M6 17 L16 24",
          right: "M4 17 H24 M28 17 L18 10 M28 17 L18 24",
        };
        const vert = dir === "up" || dir === "down";
        const arrow = `<svg width="34" height="34" viewBox="0 0 34 34" fill="none" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,.55))"><path d="${paths[dir]}" stroke="${C}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
        const pill = `<span style="background:${C};color:#15171c;font-weight:700;font-size:13px;padding:5px 10px;border-radius:8px;white-space:nowrap;box-shadow:0 6px 18px rgba(0,0,0,.45)">${label}</span>`;
        const wrap = document.createElement("div");
        wrap.className = "__demo_annotation";
        wrap.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;display:flex;${vert ? "flex-direction:column" : "flex-direction:row"};align-items:center;gap:3px;font-family:ui-sans-serif,system-ui,sans-serif`;
        // arrow nearest the target: up/left → arrow first; down/right → pill first
        wrap.innerHTML =
          dir === "down" || dir === "right" ? pill + arrow : arrow + pill;
        document.body.appendChild(wrap);
        const w = wrap.offsetWidth;
        const h = wrap.offsetHeight;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        let left = cx - w / 2;
        let top = r.bottom + 6;
        if (dir === "down") top = r.top - h - 6;
        if (dir === "left") {
          left = r.right + 8;
          top = cy - h / 2;
        }
        if (dir === "right") {
          left = r.left - w - 8;
          top = cy - h / 2;
        }
        wrap.style.left = `${Math.max(2, Math.round(left))}px`;
        wrap.style.top = `${Math.max(2, Math.round(top))}px`;
      },
      { selector, label, dir },
    )
    .catch(() => undefined);
  await world.waitForFrame();
}

/** Remove all annotation overlays (between phases). */
export async function clearAnnotations(world: KoluWorld): Promise<void> {
  await world.page
    .evaluate(() => {
      for (const e of document.querySelectorAll(".__demo_annotation"))
        e.remove();
    })
    .catch(() => undefined);
}

/**
 * Point a coral arrow at `selector`, hold briefly so the click reads on camera,
 * click it, then clear the arrow. Use for on-camera mouse clicks so the viewer
 * sees *what* is being clicked (the "+" button, a dock row, …).
 */
export async function clickWithArrow(
  world: KoluWorld,
  selector: string,
  label: string,
  dir: ArrowDir = "left",
  holdMs = 700,
): Promise<void> {
  await annotate(world, selector, label, dir);
  await pause(world, holdMs);
  await world.page.locator(selector).click();
  await world.waitForFrame();
  await clearAnnotations(world);
}

// Walk open shadow trees (Pierre's file view nests one; the Markdown preview is
// light DOM and the same DFS handles it). Used by selectTextInView.
const SHADOW_DFS_FN_SRC = `
function shadowDfs(root, visit) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    const r = visit(node);
    if (r) return r;
    if (node.nodeType === 1) {
      if (node.shadowRoot) for (const ch of node.shadowRoot.childNodes) stack.push(ch);
      for (const ch of node.childNodes) stack.push(ch);
    }
  }
}`;

/**
 * Drive a REAL mouse drag to select the `target` text inside the element matched
 * by `containerSelector` (e.g. the Code-tab file view). Mirrors the e2e harness's
 * `dragSelectText` so a recording can demo the comment-on-any-file flow: the
 * selection wakes kolu's floating comment pill. Throws if the text isn't found.
 */
export async function selectTextInView(
  world: KoluWorld,
  containerSelector: string,
  target: string,
): Promise<void> {
  const c = JSON.stringify(containerSelector);
  const t = JSON.stringify(target);
  await world.page.waitForFunction(
    `(() => { ${SHADOW_DFS_FN_SRC}
      const view = document.querySelector(${c});
      if (!view) return false;
      let found = false;
      shadowDfs(view, (n) => { if (n.nodeType === 3 && (n.nodeValue || "").indexOf(${t}) !== -1) { found = true; return true; } });
      return found;
    })()`,
    undefined,
    { timeout: 15_000 },
  );
  const rect = (await world.page.evaluate(
    `(() => { ${SHADOW_DFS_FN_SRC}
      const view = document.querySelector(${c});
      if (!view) return null;
      let node = null, off = -1;
      shadowDfs(view, (n) => { if (n.nodeType === 3) { const i = (n.nodeValue || "").indexOf(${t}); if (i !== -1) { node = n; off = i; return true; } } });
      if (!node || off < 0) return null;
      const range = document.createRange();
      range.setStart(node, off);
      range.setEnd(node, off + ${t}.length);
      const rects = range.getClientRects();
      const first = rects[0], last = rects[rects.length - 1];
      if (!first || !last) return null;
      return { sx: first.left, sy: first.top + first.height / 2, ex: last.right, ey: last.top + last.height / 2 };
    })()`,
  )) as { sx: number; sy: number; ex: number; ey: number } | null;
  if (!rect) {
    throw new Error(`Could not locate "${target}" in ${containerSelector}`);
  }
  // Three move steps keep Chromium's selection model awake for short ranges.
  await world.page.mouse.move(rect.sx, rect.sy);
  await world.page.mouse.down();
  await world.page.mouse.move(
    (rect.sx + rect.ex) / 2,
    (rect.sy + rect.ey) / 2,
    {
      steps: 3,
    },
  );
  await world.page.mouse.move(rect.ex, rect.ey, { steps: 3 });
  await world.page.mouse.up();
  await world.waitForFrame();
}

/**
 * Open a file in the Code tab's "All files" browser by typing `query` into the
 * file-filter search and clicking the row whose path is `filePath`. Faster +
 * more robust than expanding nested folders by hand. Pass `arrowLabel` to
 * telegraph the click with a coral arrow.
 */
export async function openFileBySearch(
  world: KoluWorld,
  query: string,
  filePath: string,
  arrowLabel?: string,
): Promise<void> {
  await world.page.locator('[data-testid="diff-filter-search"]').fill(query);
  await world.waitForFrame();
  await pause(world, 400);
  const row = `[data-testid="pierre-file-tree"] [data-item-path=${JSON.stringify(filePath)}][data-item-type="file"]:not([data-file-tree-sticky-row])`;
  if (arrowLabel) {
    await clickWithArrow(world, row, arrowLabel, "left", 500);
  } else {
    await world.page.locator(row).click();
    await world.waitForFrame();
  }
}
