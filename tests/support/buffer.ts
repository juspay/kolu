/**
 * Helpers for reading the xterm.js buffer directly via the __xterm ref
 * exposed on terminal container elements. Replaces server-side screenState
 * RPC polling with instant client-side buffer reads.
 */

import type { Page } from "playwright";

/** Default selector for the active (visible) terminal container. */
const ACTIVE_TERMINAL = "[data-visible][data-terminal-id]";

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
    ({ sel, idx }) => {
      const containers = document.querySelectorAll(sel);
      const container = containers[idx] as HTMLElement | undefined;
      if (!container) return "";
      const term = (container as any).__xterm;
      if (!term) return "";
      const buf = term.buffer.active;
      const lines: string[] = [];
      for (let i = 0; i < buf.length; i++) {
        lines.push(buf.getLine(i)?.translateToString(true) ?? "");
      }
      return lines.join("\n");
    },
    { sel: selector, idx: index },
  );
}

/**
 * Poll the xterm buffer until it contains the expected text.
 * Returns the full buffer content on match, or throws on timeout.
 */
export async function pollUntilBufferContains(
  page: Page,
  expected: string,
  {
    selector = ACTIVE_TERMINAL,
    index = 0,
    attempts = 50,
    intervalMs = 100,
  } = {},
): Promise<string> {
  let content = "";
  for (let i = 0; i < attempts; i++) {
    content = await readBufferText(page, selector, index);
    if (content.includes(expected)) return content;
    await page.waitForTimeout(intervalMs);
  }
  throw new Error(
    `Buffer does not contain "${expected}" after ${attempts} attempts.\nBuffer (partial): ${content.slice(0, 500)}`,
  );
}
