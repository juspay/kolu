import { tailLines } from "@kolu/padi-client/screenTail";
import type { Page } from "playwright";
import { innerTerminalFor } from "./buffer.ts";
import { padiCall } from "./rpcWire.ts";

export { innerTerminalFor as paneSelector };

export interface TerminalScreens {
  grid: { cols: number; rows: number };
  pane: string;
  daemon: string;
  paneHeldStillAcrossDaemonRead: boolean;
}

export async function readTerminalScreens(
  page: Page,
  terminalId: string,
): Promise<TerminalScreens> {
  const read = (sel: string) =>
    page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!(el instanceof HTMLDivElement)) return null;
      const term = el.__xterm;
      if (!term) return null;
      return {
        cols: term.cols,
        rows: term.rows,
        text: window.__readXtermBuffer?.(selector, 0) ?? "",
      };
    }, sel);

  const selector = innerTerminalFor(terminalId);
  const before = await read(selector);
  if (!before) {
    throw new Error(
      `no live xterm for terminal ${terminalId} — the pane is not mounted, so there is no screen to compare`,
    );
  }
  const daemon = await padiCall("screen/text", {
    id: terminalId,
    tail: before.rows,
  });
  if (typeof daemon !== "string") {
    throw new Error(
      `padi answered screen.text for ${terminalId} with ${typeof daemon}, not text`,
    );
  }
  const after = await read(selector);
  return {
    grid: { cols: before.cols, rows: before.rows },
    pane: tailLines(before.text, before.rows),
    daemon,
    paneHeldStillAcrossDaemonRead:
      !!after &&
      after.text === before.text &&
      after.cols === before.cols &&
      after.rows === before.rows,
  };
}

function screenLines(text: string): string[] {
  const lines = text.split("\n").map((line) => line.replace(/\s+$/, ""));
  let start = 0;
  while (start < lines.length && lines[start] === "") start += 1;
  return lines.slice(start);
}

const QUOTE_LINES = 24;

const quote = (lines: string[]): string =>
  lines
    .slice(0, QUOTE_LINES)
    .map((line, i) => `  ${String(i).padStart(2, "0")} |${line}`)
    .join("\n");

export function describeScreenMismatch(
  screens: TerminalScreens,
): string | null {
  const pane = screenLines(screens.pane);
  const daemon = screenLines(screens.daemon);
  const rows = Math.max(pane.length, daemon.length);
  let first = -1;
  for (let i = 0; i < rows; i++) {
    if (pane[i] !== daemon[i]) {
      first = i;
      break;
    }
  }
  if (first === -1) return null;
  return (
    `the pane and the daemon disagree about row ${first} ` +
    `(pane holds ${pane.length} content lines at ${screens.grid.cols}x${screens.grid.rows}, the daemon ${daemon.length}):\n` +
    `  pane   |${pane[first] ?? "<no such row>"}\n` +
    `  daemon |${daemon[first] ?? "<no such row>"}\n` +
    `pane screen:\n${quote(pane)}\n` +
    `daemon screen:\n${quote(daemon)}`
  );
}
