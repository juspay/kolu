import type { Page } from "playwright";
import { POLL_TIMEOUT } from "./world.ts";

export const ACTIVE_TERMINAL = "[data-focused][data-terminal-id]";

const HOLDS_XTERM = "[data-font-size]";

export const INNER_TERMINAL = `[data-terminal-id]${HOLDS_XTERM}`;

export const innerTerminalFor = (terminalId: string): string =>
  `[data-terminal-id="${terminalId}"]${HOLDS_XTERM}`;

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

type TerminalProbe = "cols" | "rows" | "fontSize";

export function readPerTerminal(
  page: Page,
  probe: TerminalProbe,
): Promise<Record<string, number>> {
  return page.evaluate(
    ({ p, innerTerminal }) => {
      const out: Record<string, number> = {};
      for (const node of document.querySelectorAll(innerTerminal)) {
        const id = node.getAttribute("data-terminal-id");
        if (!id) continue;
        if (p === "fontSize") {
          const fontSize = node.getAttribute("data-font-size");
          if (fontSize) out[id] = Number.parseFloat(fontSize);
          continue;
        }
        const liveGrid =
          node instanceof HTMLDivElement ? node.__xterm : undefined;
        if (liveGrid) out[id] = p === "cols" ? liveGrid.cols : liveGrid.rows;
      }
      return out;
    },
    { p: probe, innerTerminal: INNER_TERMINAL },
  );
}

interface ReadOptions {
  selector?: string;
  index?: number;
  timeout?: number;
}

async function waitForXtermText(
  page: Page,
  expected: string,
  {
    selector = ACTIVE_TERMINAL,
    index = 0,
    timeout = POLL_TIMEOUT,
  }: ReadOptions,
  viewportOnly: boolean,
): Promise<string> {
  const handle = await page.waitForFunction(
    ({ sel, idx, exp, vp }) => {
      const content =
        window.__readXtermBuffer?.(sel, idx, { viewport: vp }) ?? "";
      return content.includes(exp) ? content : null;
    },
    { sel: selector, idx: index, exp: expected, vp: viewportOnly },
    { timeout, polling: 50 },
  );
  return (await handle.jsonValue()) ?? "";
}

export function waitForBufferContains(
  page: Page,
  expected: string,
  options: ReadOptions = {},
): Promise<string> {
  return waitForXtermText(page, expected, options, false);
}

export function waitForVisibleRows(
  page: Page,
  expected: string,
  options: ReadOptions = {},
): Promise<string> {
  return waitForXtermText(page, expected, options, true);
}

export async function waitForFirstScreen(page: Page): Promise<void> {
  await page.waitForFunction(
    (sel) => (window.__readXtermBuffer?.(sel, 0) ?? "").trim().length > 0,
    ACTIVE_TERMINAL,
    { timeout: POLL_TIMEOUT, polling: 50 },
  );
}
