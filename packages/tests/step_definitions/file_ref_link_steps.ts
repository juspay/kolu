import { When } from "@cucumber/cucumber";
import { ACTIVE_TERMINAL, waitForBufferContains } from "../support/buffer.ts";
import { pollFor } from "../support/poll.ts";
import type { KoluWorld } from "../support/world.ts";
import { POLL_TIMEOUT } from "../support/world.ts";

type RefClickPoint = { x: number; y: number } | null;

/** Locate a clickable file-ref in the active terminal and compute
 *  pixel coordinates from the **public** xterm API
 *  (`term.cols/rows` + the `.xterm-screen` bounding rect). The
 *  previous step reached into `term._core._linkProviderService` —
 *  fragile to xterm internals (which already broke once on this
 *  branch when the field was renamed). The real-mouse path also
 *  exercises xterm's hit-testing, which the click handler relies on
 *  in production. */
async function findRefClickPoint(
  world: KoluWorld,
  refText: string,
): Promise<RefClickPoint> {
  return world.page.evaluate(
    ({ sel, target }) => {
      type BufferLine = { translateToString(trim?: boolean): string };
      type XtermForClick = {
        cols: number;
        rows: number;
        buffer: {
          active: {
            viewportY: number;
            getLine(index: number): BufferLine | undefined;
          };
        };
      };
      const container = document.querySelector(sel) as
        | (HTMLElement & { __xterm?: XtermForClick })
        | null;
      const term = container?.__xterm;
      const screen = container?.querySelector(".xterm-screen");
      if (!container || !term || !screen) return null;
      const { active } = term.buffer;
      const top = active.viewportY;
      for (let row = top; row < top + term.rows; row++) {
        const line = active.getLine(row)?.translateToString(true) ?? "";
        const col = line.indexOf(target);
        if (col < 0) continue;
        const rect = screen.getBoundingClientRect();
        const cellW = rect.width / term.cols;
        const cellH = rect.height / term.rows;
        return {
          x: rect.left + (col + 0.5) * cellW,
          y: rect.top + (row - top + 0.5) * cellH,
        };
      }
      return null;
    },
    { sel: ACTIVE_TERMINAL, target: refText },
  );
}

/** Resolve the on-screen pixel point of a terminal file-ref, waiting for the
 *  preconditions both the mouse-click and touch-tap activation paths share. */
async function resolveRefPoint(
  world: KoluWorld,
  refText: string,
): Promise<{ x: number; y: number }> {
  // The file-ref → Code-tab open path needs the terminal's git context
  // (repoRoot) resolved: Terminal.tsx's activateFileRef bails when meta.git
  // is still null. On the slower aarch64-darwin runner the `cd` into the
  // repo and the ensuing git resolution lag behind the echoed
  // `path:line` text the click targets, so the click would silently
  // no-op (the ref resolves, but there's no repoRoot to open with). Wait
  // for the active tile's branch annotation to show a real branch first.
  // The annotation lives on the active canvas tile (desktop) or the
  // fullscreen tile's titlebar (mobile) — both carry `terminal-meta-branch`.
  await world.page.waitForFunction(
    () => {
      const el =
        document.querySelector(
          '[data-testid="canvas-tile"][data-active="true"] [data-testid="terminal-meta-branch"]',
        ) ??
        document.querySelector(
          '[data-testid="mobile-tile-titlebar"] [data-testid="terminal-meta-branch"]',
        );
      const t = (el?.textContent ?? "").trim();
      return t !== "" && t !== "—";
    },
    undefined,
    { timeout: POLL_TIMEOUT },
  );
  // Buffer poll first so the regex match window has a chance to
  // include the just-echoed text.
  await waitForBufferContains(world.page, refText);
  const point = await pollFor({
    observe: () => findRefClickPoint(world, refText),
    isDone: (p) => p !== null,
    onTimeout: (last, ms) =>
      new Error(
        `terminal ref "${refText}" had no clickable point after ${ms}ms (last=${JSON.stringify(last)})`,
      ),
    timeoutMs: POLL_TIMEOUT,
    intervalMs: 50,
  });
  if (point === null) throw new Error("unreachable: missing ref point");
  return point;
}

When(
  "I trigger the terminal file-ref link {string}",
  async function (this: KoluWorld, refText: string) {
    const point = await resolveRefPoint(this, refText);
    // Move first so xterm's hover detection fires (link decorations
    // appear on hover), then click — same gesture a real user makes.
    await this.page.mouse.move(point.x, point.y);
    await this.waitForFrame();
    await this.page.mouse.click(point.x, point.y);
    await this.waitForFrame();
  },
);

When(
  "I tap the terminal file-ref link {string}",
  async function (this: KoluWorld, refText: string) {
    // Touch counterpart: a real CDP tap on the ref cell. xterm's own link
    // activation is mouse/hover-only and never fires for touch, so this
    // exercises Terminal.tsx's tap handler, which hit-tests the ref itself and
    // follows it into the Code tab instead of focusing the terminal.
    const point = await resolveRefPoint(this, refText);
    await this.page.touchscreen.tap(point.x, point.y);
    await this.waitForFrame();
  },
);
