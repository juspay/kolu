/**
 * Helpers for reading the xterm.js buffer directly via the __xterm ref
 * exposed on terminal container elements.
 *
 * The actual buffer-read loop lives in `hooks.ts` as `window.__readXtermBuffer`
 * (injected via addInitScript) so it's defined once and shared across
 * readBufferText, waitForBufferContains, and getTerminalPid.
 */

import type { Page } from "playwright";
import { POLL_TIMEOUT } from "./world.ts";

/** Default selector for the active (focused) terminal container.
 *  In canvas mode multiple xterms carry `data-visible` (every tile mounts
 *  its xterm); only one carries `data-focused` at any time. */
export const ACTIVE_TERMINAL = "[data-focused][data-terminal-id]";

/**
 * Read all lines from a terminal's xterm buffer (joined by newline).
 * @param index — when multiple terminals match the selector, pick the Nth (0-based). Default: 0.
 */
export function readBufferText(
  page: Page,
  selector = ACTIVE_TERMINAL,
  index = 0,
): Promise<string> {
  return page.evaluate(
    ({ sel, idx }) => (window as any).__readXtermBuffer(sel, idx),
    { sel: selector, idx: index },
  );
}

/**
 * Wait for the xterm buffer to contain the expected text using Playwright's
 * native waitForFunction (rAF-based polling inside the browser context).
 * Returns the full buffer content on match, or throws on timeout.
 */
export async function waitForBufferContains(
  page: Page,
  expected: string,
  { selector = ACTIVE_TERMINAL, index = 0, timeout = POLL_TIMEOUT } = {},
): Promise<string> {
  const handle = await page.waitForFunction(
    ({ sel, idx, exp }) => {
      const content = (window as any).__readXtermBuffer(sel, idx);
      return content.includes(exp) ? content : null;
    },
    { sel: selector, idx: index, exp: expected },
    { timeout },
  );
  return (await handle.jsonValue())!;
}
