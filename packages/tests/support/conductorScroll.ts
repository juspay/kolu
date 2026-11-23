/** SCROLLING BACK IN A CONDUCTOR SCREEN — shared by a work's live pane and the
 *  Look window, which draw the one screen component under two test-id
 *  prefixes (`live-*`, `peek-*`).
 *
 *  Where the view sits is read off the screen's own buffer (the `__xterm`
 *  bridge on the screen's container); what the head says is its live readout's
 *  `data-phase` (`held` while the scroll lock holds output, `live` at the
 *  bottom, `reading` while a fresh attach paints). A snap back to the bottom
 *  is a re-attach — the head passes through `reading` and the view lands on
 *  the newest line — so "stays" is SAMPLED across a window, never read once:
 *  a snap-back cannot hide between two looks. */

import type { Page } from "playwright";
import { pollFor } from "./poll.ts";
import { POLL_TIMEOUT } from "./world.ts";

/** How long a scrolled-back view is held before "it stays" is claimed. */
const STAYS_WINDOW_MS = 2_000;
const STAYS_SAMPLE_MS = 100;

/** One screen and the head readout that speaks for it. */
export interface ConductorScreen {
  /** Selector of the screen's container (`live-screen` / `peek-screen`). */
  screen: string;
  /** Selector of the head's live readout (`live-live` / `peek-live`). */
  readout: string;
  /** How the failure names it. */
  label: string;
}

interface ScrollSample {
  /** Rows between the top of the view and the bottom of the buffer. */
  rowsBack: number | null;
  phase: string | null;
}

async function sample(page: Page, at: ConductorScreen): Promise<ScrollSample> {
  const rowsBack = await page.evaluate((sel) => {
    const el = document.querySelector<HTMLElement & { __xterm?: unknown }>(sel);
    const term = el?.__xterm as
      | { buffer: { active: { baseY: number; viewportY: number } } }
      | undefined;
    if (!term) return null;
    const buf = term.buffer.active;
    return buf.baseY - buf.viewportY;
  }, at.screen);
  const phase = await page
    .locator(at.readout)
    .getAttribute("data-phase", { timeout: 500 })
    .catch(() => null);
  return { rowsBack, phase };
}

const scrolledBack = (s: ScrollSample): boolean =>
  s.rowsBack !== null && s.rowsBack > 0 && s.phase === "held";

/** A real mouse wheel over the middle of the screen. */
export async function wheelOver(
  page: Page,
  at: ConductorScreen,
  deltaY: number,
): Promise<void> {
  const box = await page.locator(at.screen).boundingBox();
  if (!box) throw new Error(`${at.label} has no box to wheel over`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, deltaY);
}

/** The view is above the bottom and the head says `held` — first reached, then
 *  held for {@link STAYS_WINDOW_MS}, sampled every {@link STAYS_SAMPLE_MS}. A
 *  view that never scrolled back fails the first half, so the hold cannot pass
 *  on a screen that was never moved. */
export async function expectStaysScrolledBack(
  page: Page,
  at: ConductorScreen,
): Promise<void> {
  await pollFor({
    observe: () => sample(page, at),
    isDone: scrolledBack,
    timeoutMs: POLL_TIMEOUT,
    intervalMs: STAYS_SAMPLE_MS,
    onTimeout: (last, ms) =>
      new Error(
        `${at.label} never stayed scrolled back: after ${ms}ms it reads ${JSON.stringify(last)}`,
      ),
  });
  const start = Date.now();
  while (Date.now() - start < STAYS_WINDOW_MS) {
    await page.waitForTimeout(STAYS_SAMPLE_MS);
    const now = await sample(page, at);
    if (!scrolledBack(now))
      throw new Error(
        `${at.label} snapped back ${Date.now() - start}ms after it was scrolled back: it reads ${JSON.stringify(now)}`,
      );
  }
}

/** The head says `live`: the view is back at the bottom and nothing is held. */
export async function expectLiveAtBottom(
  page: Page,
  at: ConductorScreen,
): Promise<void> {
  await pollFor({
    observe: () => sample(page, at),
    isDone: (s) => s.rowsBack === 0 && s.phase === "live",
    timeoutMs: POLL_TIMEOUT,
    onTimeout: (last, ms) =>
      new Error(
        `${at.label} never came back to live at the bottom: after ${ms}ms it reads ${JSON.stringify(last)}`,
      ),
  });
}
