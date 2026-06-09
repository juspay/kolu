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
    ({ sel, idx }) => window.__readXtermBuffer?.(sel, idx) ?? "",
    { sel: selector, idx: index },
  );
}

/** Serializable discriminant for {@link readPerTerminal}: which per-terminal
 *  scalar to project off each inner xterm container. */
type PerTerminalProbe = "cols" | "fontSize";

/**
 * Enumerate the inner terminal containers — those carrying both
 * `data-terminal-id` and `data-font-size` — and project one per-terminal
 * scalar off each, keyed by id. The outer CanvasTile wrapper carries
 * `data-terminal-id` but no `data-font-size`, so it's filtered out (it also
 * never holds the `__xterm` ref). `cols` reads the live xterm grid width via
 * the `__xterm` ref attached in Terminal.tsx's onMount; `fontSize` parses the
 * `data-font-size` attribute. The probe is a serializable discriminant rather
 * than a live closure because the body runs inside `page.evaluate`.
 */
export function readPerTerminal(
  page: Page,
  probe: PerTerminalProbe,
): Promise<Record<string, number>> {
  return page.evaluate((p) => {
    const out: Record<string, number> = {};
    for (const n of document.querySelectorAll(
      "[data-terminal-id][data-font-size]",
    )) {
      const id = n.getAttribute("data-terminal-id");
      if (!id) continue;
      if (p === "cols") {
        const term = (n as unknown as { __xterm?: { cols: number } }).__xterm;
        if (term && typeof term.cols === "number") out[id] = term.cols;
      } else {
        const fs = n.getAttribute("data-font-size");
        if (fs) out[id] = Number.parseFloat(fs);
      }
    }
    return out;
  }, probe);
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
      const content = window.__readXtermBuffer?.(sel, idx) ?? "";
      return content.includes(exp) ? content : null;
    },
    { sel: selector, idx: index, exp: expected },
    { timeout },
  );
  // The handle's predicate above returns either a non-null string (match)
  // or `null`, and `waitForFunction` only resolves on a truthy value — so
  // `jsonValue()` is structurally always a string by the time we read it.
  // The `?? ""` fallback satisfies the type checker without a `!`.
  return (await handle.jsonValue()) ?? "";
}
