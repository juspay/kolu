import { padiCall } from "../../support/rpcWire.ts";
import {
  ACTIVE_CANVAS_TILE_SELECTOR,
  type KoluWorld,
} from "../../support/world";

export const pause = (world: KoluWorld, ms: number): Promise<void> =>
  world.page.waitForTimeout(ms);

export function requireDockBucket(
  world: KoluWorld,
  bucket: "working" | "awaiting" | "idle",
  timeout: number,
): Promise<unknown> {
  return world.page.waitForSelector(
    `[data-testid="dock-row"][data-bucket="${bucket}"]`,
    { state: "attached", timeout },
  );
}

let activeTheme: string | undefined;
export const setActiveTheme = (name?: string): void => {
  activeTheme = name;
};

export async function clearCanvas(
  world: KoluWorld,
  beatMs = 800,
): Promise<void> {
  await world.waitForReady();
  await padiCall("lifecycle/killAll").catch(() => undefined);
  let survivors = 0;
  for (let i = 0; i < 20; i++) {
    survivors = await world.page.locator('[data-testid="canvas-tile"]').count();
    if (survivors === 0) break;
    await pause(world, 300);
  }
  if (survivors > 0) {
    throw new Error(
      `clearCanvas: ${survivors} terminal(s) survived lifecycle/killAll`,
    );
  }
  await pause(world, beatMs);
}

export async function setupSingleTerminal(world: KoluWorld): Promise<string> {
  await clearCanvas(world, 3500);
  const id = await newTerminal(world);
  await pause(world, 600);
  await nudgeClearOfDock(world);
  await pause(world, 400);
  return id;
}

export async function nudgeClearOfDock(world: KoluWorld): Promise<void> {
  const dock = await world.page
    .locator('[data-testid="dock"]')
    .boundingBox()
    .catch(() => null);
  const bar = world.page
    .locator('[data-testid="canvas-tile-titlebar"]')
    .first();
  const tile = await bar.boundingBox().catch(() => null);
  if (!dock || !tile) return;
  const delta = dock.x + dock.width + 24 - tile.x;
  if (delta <= 0) return;
  const sx = tile.x + tile.width / 2;
  const sy = tile.y + tile.height / 2;
  await world.page.mouse.move(sx, sy);
  await world.page.mouse.down();
  await world.page.mouse.move(sx + delta, sy, { steps: 12 });
  await world.page.mouse.up();
  await world.waitForFrame();
}

export async function setTerminalThemeRpc(
  _world: KoluWorld,
  id: string,
  themeName: string,
): Promise<void> {
  await padiCall("chrome/setTheme", { id, themeName }).catch(() => undefined);
}

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

export async function createTerminalByClick(
  world: KoluWorld,
  themeName = activeTheme,
  arrowLabel = "click + to open a terminal",
): Promise<string> {
  const before = await world.terminalIds();
  await clickWithArrow(world, '[data-testid="dock-new"]', arrowLabel, "left");
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

export async function openOverlappingTerminal(
  world: KoluWorld,
  opts: { theme?: string; dx?: number; dy?: number } = {},
): Promise<string> {
  const dx = opts.dx ?? 72;
  const dy = opts.dy ?? 64;
  const activeBar = () =>
    world.page
      .locator(
        `${ACTIVE_CANVAS_TILE_SELECTOR} [data-testid="canvas-tile-titlebar"]`,
      )
      .boundingBox()
      .catch(() => null);
  const base = await activeBar();
  const id = await createTerminalByClick(
    world,
    opts.theme,
    "click + for a second terminal",
  );
  await pause(world, 300);
  const fresh = await activeBar();
  if (base && fresh) {
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

export const CLAUDE_SONNET =
  "claude --dangerously-skip-permissions --model sonnet";

export const CODEX_AUTONOMOUS =
  "codex --ask-for-approval never --sandbox read-only";

const TRUST_GATE_APPEARS_MS = 2500;
const AGENT_BOOT_MS = 2500;
const DOCK_WORKING_DWELL_MS = 3000;
const ANSWER_DWELL_MS = 2800;

export interface LaunchAgentOptions {
  command?: string;
  prompt?: string;
  acceptTrustGate?: boolean;
  trustMs?: number;
  bootMs?: number;
  dwellMs?: number;
}

export async function launchAgentAndAsk(
  world: KoluWorld,
  opts: LaunchAgentOptions = {},
): Promise<void> {
  await world.terminalRun(opts.command ?? CLAUDE_SONNET);
  if (opts.acceptTrustGate ?? true) {
    await pause(world, opts.trustMs ?? TRUST_GATE_APPEARS_MS);
    await world.page.keyboard.press("Enter");
  }
  await pause(world, opts.bootMs ?? AGENT_BOOT_MS);
  if (!opts.prompt) return;

  await world.terminalRun(opts.prompt);
  await requireDockBucket(world, "working", 20_000);
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
  await pause(world, DOCK_WORKING_DWELL_MS);

  await requireDockBucket(world, "awaiting", 90_000);
  await clearAnnotations(world);
  await annotate(
    world,
    '[data-testid="dock-row"][data-bucket="awaiting"]',
    "agent finished — your turn",
    "up",
  );
  await pause(world, opts.dwellMs ?? ANSWER_DWELL_MS);
}

type ArrowDir = "up" | "down" | "left" | "right";

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

export async function clearAnnotations(world: KoluWorld): Promise<void> {
  await world.page
    .evaluate(() => {
      for (const e of document.querySelectorAll(".__demo_annotation"))
        e.remove();
    })
    .catch(() => undefined);
}

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

export async function selectTextInView(
  world: KoluWorld,
  containerSelector: string,
  target: string,
): Promise<void> {
  // tsx (esbuild keepNames) wraps the nested function declarations below in a
  // `__name(...)` helper that doesn't exist in the page — define a no-op shim
  // first or the serialized waitForFunction predicate throws ReferenceError.
  // (This evaluate itself has no nested declarations, so it isn't wrapped.)
  await world.page.evaluate(
    "globalThis.__name = globalThis.__name || ((f) => f)",
  );
  const rectHandle = await world.page.waitForFunction(
    ({ containerSelector, target }) => {
      const shadowDfs = (
        root: Node,
        visit: (node: Node) => boolean,
      ): boolean => {
        const stack = [root];
        while (stack.length > 0) {
          const node = stack.pop();
          if (!node) continue;
          if (visit(node)) return true;
          if (node instanceof Element) {
            if (node.shadowRoot) stack.push(...node.shadowRoot.childNodes);
            stack.push(...node.childNodes);
          }
        }
        return false;
      };
      const view = document.querySelector(containerSelector);
      if (!view) return false;
      let node: Node | null = null;
      let off = -1;
      shadowDfs(view, (candidate) => {
        if (candidate.nodeType !== Node.TEXT_NODE) return false;
        const index = (candidate.nodeValue ?? "").indexOf(target);
        if (index === -1) return false;
        node = candidate;
        off = index;
        return true;
      });
      if (node === null || off < 0) return null;
      const range = document.createRange();
      range.setStart(node, off);
      range.setEnd(node, off + target.length);
      const rects = range.getClientRects();
      const first = rects[0],
        last = rects[rects.length - 1];
      if (!first || !last) return null;
      return {
        sx: first.left,
        sy: first.top + first.height / 2,
        ex: last.right,
        ey: last.top + last.height / 2,
      };
    },
    { containerSelector, target },
    { timeout: 15_000 },
  );
  let rect: { sx: number; sy: number; ex: number; ey: number } | null;
  try {
    rect = (await rectHandle.jsonValue()) as typeof rect;
  } finally {
    await rectHandle.dispose();
  }
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

async function canvasZoomStep(world: KoluWorld): Promise<void> {
  await world.page
    .locator('[data-testid="minimap-zoombar"] button[title="Zoom out"]')
    .click();
  await world.waitForFrame();
}

export async function zoomOutToFitTiles(
  world: KoluWorld,
  {
    margin = 24,
    maxSteps = 16,
    minZoom = 0.5,
  }: { margin?: number; maxSteps?: number; minZoom?: number } = {},
): Promise<void> {
  for (let i = 0; i < maxSteps; i++) {
    const done = await world.page.evaluate(
      ({ m, floor }) => {
        const c = document.querySelector('[data-testid="canvas-container"]');
        if (!c) return true;
        const zoom = Number(c.getAttribute("data-zoom") ?? "1");
        if (zoom < floor) return true;
        const cr = c.getBoundingClientRect();
        const tiles = Array.from(
          document.querySelectorAll('[data-testid="canvas-tile"]'),
        );
        if (tiles.length === 0) return true;
        return tiles.every((t) => {
          const r = t.getBoundingClientRect();
          return (
            r.left >= cr.left + m &&
            r.right <= cr.right - m &&
            r.top >= cr.top + m &&
            r.bottom <= cr.bottom - m
          );
        });
      },
      { m: margin, floor: minZoom },
    );
    if (done) return;
    await canvasZoomStep(world);
    await pause(world, 90);
  }
}

export async function resetCanvasZoom(world: KoluWorld): Promise<void> {
  await world.page
    .locator('[data-testid="minimap-zoombar"] button[title="Reset to 100%"]')
    .click();
  await world.waitForFrame();
}

export async function zoomOutToLevel(
  world: KoluWorld,
  target: number,
  maxClicks = 10,
): Promise<void> {
  for (let i = 0; i < maxClicks; i++) {
    const zoom = await world.page.evaluate(() =>
      Number(
        document
          .querySelector('[data-testid="canvas-container"]')
          ?.getAttribute("data-zoom") ?? "1",
      ),
    );
    if (zoom <= target) return;
    await canvasZoomStep(world);
    await pause(world, 90);
  }
}

export async function dragTileTo(
  world: KoluWorld,
  terminalId: string,
  x: number,
  y: number,
): Promise<void> {
  const bar = world.page.locator(
    `[data-testid="canvas-tile"][data-terminal-id="${terminalId}"] [data-testid="canvas-tile-titlebar"]`,
  );
  for (let attempt = 0; attempt < 2; attempt++) {
    const box = await bar.boundingBox();
    if (!box) throw new Error(`dragTileTo: no titlebar for ${terminalId}`);
    const sx = box.x + box.width / 2;
    const sy = box.y + box.height / 2;
    await world.page.mouse.move(sx, sy);
    await world.page.mouse.down();
    await world.page.mouse.move(x, y, { steps: 14 });
    await world.page.mouse.up();
    await world.waitForFrame();
    await pause(world, 200);
    const landed = await bar.boundingBox();
    if (!landed) throw new Error(`dragTileTo: ${terminalId} vanished mid-drag`);
    const lx = landed.x + landed.width / 2;
    const ly = landed.y + landed.height / 2;
    if (Math.hypot(lx - x, ly - y) <= 60) return;
    console.log(
      `[dragTileTo] ${terminalId} landed at (${Math.round(lx)}, ${Math.round(ly)}), wanted (${x}, ${y}) — retrying`,
    );
  }
  throw new Error(`dragTileTo: ${terminalId} refused to land at (${x}, ${y})`);
}

export async function handPan(
  world: KoluWorld,
  opts: { fromX: number; fromY: number; dx: number; dy: number },
): Promise<void> {
  const weights = [0.25, 0.5, 0.25];
  await world.page.keyboard.down("Shift");
  await world.page.mouse.move(opts.fromX, opts.fromY);
  await world.page.mouse.down();
  let progress = 0;
  for (const w of weights) {
    progress += w;
    await world.page.mouse.move(
      opts.fromX + opts.dx * progress,
      opts.fromY + opts.dy * progress,
      { steps: Math.max(6, Math.round(30 * w)) },
    );
  }
  await world.page.mouse.up();
  await world.page.keyboard.up("Shift");
  await world.waitForFrame();
}

export async function hostChipCss(
  world: KoluWorld,
  opts: { name?: string; index?: number },
): Promise<string | null> {
  return world.page.evaluate((o) => {
    const row = document.querySelector('[data-testid="host-chip-row"]');
    if (!row) return null;
    const chips = Array.from(row.querySelectorAll('[data-testid="host-chip"]'));
    const chip =
      o.name !== undefined
        ? chips.find((c) => (c.textContent ?? "").includes(o.name as string))
        : chips[o.index ?? 0];
    const key = chip?.getAttribute("data-host");
    if (!key) return null;
    const escaped = key.replace(/["\\]/g, "\\$&");
    return `[data-testid="host-chip-row"] [data-testid="host-chip"][data-host="${escaped}"]`;
  }, opts);
}

export async function switchHost(
  world: KoluWorld,
  chipCss: string,
  opts: { arrowLabel?: string; timeout?: number } = {},
): Promise<void> {
  const select = `${chipCss} [data-testid="host-select"]`;
  if (opts.arrowLabel) {
    await clickWithArrow(world, select, opts.arrowLabel, "down", 600);
  } else {
    await world.page.locator(select).click();
    await world.waitForFrame();
  }
  await world.page.waitForFunction(
    (sel) => document.querySelector(sel)?.hasAttribute("data-active") ?? false,
    chipCss,
    { timeout: 10_000 },
  );
  await pause(world, 600);
  await world.page.waitForFunction(
    () =>
      !document.querySelector(
        '[data-testid="daemon-warming"], [data-testid="connect-canvas"], [data-testid="host-down-canvas"], [data-testid="boot-stalled-canvas"]',
      ),
    undefined,
    { timeout: opts.timeout ?? 120_000 },
  );
}
