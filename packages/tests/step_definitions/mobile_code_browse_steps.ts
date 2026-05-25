/** Steps for the mobile code-browser drawer — see
 *  `MobileCodeSheet.tsx`, `MobileTileView.tsx`, `MobileChromeSheet.tsx`. */

import { Then, When } from "@cucumber/cucumber";
import {
  HYDRATION_TIMEOUT,
  type KoluWorld,
  POLL_TIMEOUT,
} from "../support/world.ts";

const FILES_TRIGGER = '[data-testid="mobile-files-trigger"]';
const CODE_SHEET = '[data-testid="mobile-code-sheet"]';
const CODE_BACK = '[data-testid="mobile-code-back"]';
const CODE_CLOSE = '[data-testid="mobile-code-close"]';
const TREE = '[data-testid="pierre-file-tree"]';
const FILE_VIEW = '[data-testid="pierre-file-view"]';
const PREVIEW_IFRAME = '[data-testid="browse-preview-iframe"]';

function fileRow(path: string): string {
  return `${TREE} [data-item-path="${path}"][data-item-type="file"]:not([data-file-tree-sticky-row])`;
}

/** Two-step wait mirroring `waitForCodeTabReady` in `code_tab_steps.ts`.
 *  The full chain (`fs.watcher → server → SSE → SolidJS → Pierre mount`)
 *  can take well over the per-interaction `POLL_TIMEOUT` on a loaded
 *  darwin CI runner — fusing both axes into one wait starves the slow
 *  hydration side. Wait for any non-sticky row at the hydration budget,
 *  then the specific row at the interaction budget. */
async function waitForMobileTreeRow(
  world: KoluWorld,
  path: string,
): Promise<void> {
  await world.page
    .locator(
      `${TREE} [data-item-path][data-item-type]:not([data-file-tree-sticky-row])`,
    )
    .first()
    .waitFor({ state: "visible", timeout: HYDRATION_TIMEOUT });
  await world.page
    .locator(fileRow(path))
    .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
}

When("I tap the mobile files button", async function (this: KoluWorld) {
  await this.page.locator(FILES_TRIGGER).tap();
});

When(
  "I tap mobile file {string}",
  async function (this: KoluWorld, path: string) {
    // Pierre's virtualized tree repositions rows reactively, so
    // Playwright's stability check never settles on a tap target inside
    // the drawer; `dispatchEvent` fires the click event the row's handler
    // listens for without the stability/visibility actionability gate.
    await waitForMobileTreeRow(this, path);
    await this.page.locator(fileRow(path)).dispatchEvent("click");
    await this.waitForFrame();
  },
);

When("I tap the mobile code back button", async function (this: KoluWorld) {
  await this.page.locator(CODE_BACK).dispatchEvent("click");
  await this.waitForFrame();
});

When("I tap the mobile code close button", async function (this: KoluWorld) {
  await this.page.locator(CODE_CLOSE).dispatchEvent("click");
  await this.waitForFrame();
});

/** Dispatch a synthetic touchstart on the buffer cell where `target`
 *  appears in the active terminal's output. Exercises the
 *  touchstart-capture handler in `Terminal.tsx` that powers mobile
 *  file-ref taps — xterm's hover-armed link provider never fires on
 *  iOS, so kolu intercepts the touch directly. The test path bypasses
 *  Playwright's tap actionability gates (which never settle against
 *  xterm's reactive buffer rendering) and goes straight at the
 *  handler the production code registers. */
When(
  "I tap terminal text {string}",
  async function (this: KoluWorld, target: string) {
    // The preceding `I run` step only waits one frame after typing — the
    // PTY → server → SSE → xterm render chain takes longer, so the
    // freshly-echoed target text may not have hit the buffer yet on a
    // loaded CI host. Poll the buffer for the target's presence (any
    // non-prompt row whose joined logical line contains it) before
    // computing the tap point — `waitForFunction` retries on a 25ms
    // cadence, so the first frame that lands the output unblocks us.
    await this.page.waitForFunction(
      (targetText) => {
        type BL = {
          translateToString(trim?: boolean): string;
          isWrapped: boolean;
        };
        type X = {
          buffer: {
            active: {
              viewportY: number;
              length: number;
              getLine(i: number): BL | undefined;
            };
          };
        };
        const el = document.querySelector("[data-focused]") as
          | (HTMLElement & { __xterm?: X })
          | null;
        const t = el?.__xterm;
        if (!t) return false;
        const b = t.buffer.active;
        for (let r = 0; r < b.length; r++) {
          let line = b.getLine(r)?.translateToString(false) ?? "";
          let s = r;
          while (s + 1 < b.length && b.getLine(s + 1)?.isWrapped) {
            line += b.getLine(s + 1)?.translateToString(false) ?? "";
            s++;
          }
          if (!line.includes("❯") && line.includes(targetText)) return true;
          r = s;
        }
        return false;
      },
      target,
      { timeout: 15000 },
    );
    const point = await this.page.evaluate((targetText) => {
      type BufferLine = {
        translateToString(trim?: boolean): string;
        isWrapped: boolean;
      };
      type XtermForClick = {
        cols: number;
        rows: number;
        scrollToBottom(): void;
        buffer: {
          active: {
            viewportY: number;
            length: number;
            getLine(index: number): BufferLine | undefined;
          };
        };
      };
      const el = document.querySelector("[data-focused]") as
        | (HTMLElement & { __xterm?: XtermForClick })
        | null;
      const term = el?.__xterm;
      const screen = el?.querySelector(".xterm-screen");
      if (!el || !term || !screen) return null;
      // The mobile-emulated viewport's soft-keyboard pop and reactive
      // chrome-sheet animations can leave the terminal scrolled away
      // from the most recent output. Anchor to the bottom so the
      // freshly-echoed path lands in the row scan below.
      term.scrollToBottom();
      const b = term.buffer.active;
      const top = b.viewportY;
      const cols = term.cols;
      const rect = (screen as Element).getBoundingClientRect();
      const cellW = rect.width / cols;
      const cellH = rect.height / term.rows;
      // Walk physical rows, joining wrapped continuations into logical
      // lines. Mobile-emulated viewports are narrow enough that
      // `/tmp/some/long/path.txt` echoes split across rows — searching
      // physical rows alone misses the target on `aarch64-darwin` CI
      // even though it's right there in the buffer. `isWrapped` flags
      // continuations (false on the first row of each logical line).
      // If the viewport starts mid-line (logical line begun above
      // `top`), walk back to that line's start so the join captures
      // every wrapped segment.
      let lineStart = top;
      while (lineStart > 0 && b.getLine(lineStart)?.isWrapped) lineStart--;
      let r = lineStart;
      while (r < top + term.rows) {
        let joined = b.getLine(r)?.translateToString(false) ?? "";
        let endRow = r;
        while (endRow + 1 < b.length && b.getLine(endRow + 1)?.isWrapped) {
          joined += b.getLine(endRow + 1)?.translateToString(false) ?? "";
          endRow++;
        }
        // Skip the command-echo line (prompt + typed text). Prompt
        // glyphs vary by shell; `❯` covers starship's default. Apply
        // to the JOINED line so wrapped echoes are still filtered.
        if (!joined.includes("❯")) {
          const idx = joined.indexOf(targetText);
          if (idx >= 0) {
            // Map the logical-string offset back to a physical (row, col)
            // — `idx + targetText.length/2` lands on a cell inside the
            // target so the touch hits the production handler's cell-hit
            // test even when the target wraps.
            const mid = idx + Math.floor(targetText.length / 2);
            const physRow = r + Math.floor(mid / cols);
            const physCol = mid % cols;
            // Only return if the cell is actually inside the viewport
            // — a logical line straddling viewport edges might match
            // on a segment that's scrolled out.
            if (physRow >= top && physRow < top + term.rows) {
              const x = rect.left + (physCol + 0.5) * cellW;
              const y = rect.top + (physRow - top + 0.5) * cellH;
              return { x, y };
            }
          }
        }
        r = endRow + 1;
      }
      return null;
    }, target);
    if (!point) {
      throw new Error(`terminal text "${target}" not found in viewport`);
    }
    await this.page.evaluate((p) => {
      const el = document.querySelector("[data-focused]");
      if (!el) return;
      const touch = new Touch({
        identifier: 1,
        target: el,
        clientX: p.x,
        clientY: p.y,
        pageX: p.x,
        pageY: p.y,
        screenX: p.x,
        screenY: p.y,
        radiusX: 1,
        radiusY: 1,
        rotationAngle: 0,
        force: 1,
      });
      el.dispatchEvent(
        new TouchEvent("touchstart", {
          cancelable: true,
          bubbles: true,
          touches: [touch],
          targetTouches: [touch],
          changedTouches: [touch],
        }),
      );
    }, point);
    await this.waitForFrame();
  },
);

Then(
  "a toast should mention {string}",
  async function (this: KoluWorld, fragment: string) {
    await this.page
      .locator(`[data-sonner-toast]`, { hasText: fragment })
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile code sheet should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(CODE_SHEET)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile code sheet should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(CODE_SHEET)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile file tree should contain {string}",
  async function (this: KoluWorld, path: string) {
    await waitForMobileTreeRow(this, path);
  },
);

Then(
  "the mobile file view should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(FILE_VIEW)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile file view should not be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(FILE_VIEW)
      .waitFor({ state: "hidden", timeout: POLL_TIMEOUT });
  },
);

Then(
  "the mobile html preview should be visible",
  async function (this: KoluWorld) {
    await this.page
      .locator(PREVIEW_IFRAME)
      .waitFor({ state: "visible", timeout: POLL_TIMEOUT });
  },
);
