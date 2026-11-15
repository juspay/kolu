/**
 * Reading BOTH copies of one terminal's screen — the one the browser pane is
 * showing and the one the daemon is holding — in the single shape that makes
 * them comparable.
 *
 * There are two readers already and this module adds neither: the pane is read
 * through `window.__readXtermBuffer` (the `__xterm` bridge every other step
 * uses, `./buffer.ts`), and the daemon is read through padi's own
 * `screen.text` procedure over the harness's wire (`./rpcWire.ts` — the same
 * transport the browser dials). What is new here is only the AGREEMENT: how a
 * pane's buffer and a daemon's buffer are cut to the same window so "equal"
 * means something.
 *
 * The window is THE SCREEN — the rows a person is looking at — expressed as
 * `tail: N` with N = the pane's own `rows`, folded by `tailLines` on both
 * sides (`@kolu/padi-client/screenTail`, which is the published definition of
 * what `screen.text { tail }` answers, so the two sides are cut by the SAME
 * function and not by two implementations of one idea). Taking a tail rather
 * than a line range is what makes the comparison immune to the two buffers
 * holding different amounts of scrollback above the screen: both sides are
 * asked for "the last N lines with the blank run below the cursor dropped",
 * and a terminal whose bottom is its live output answers with exactly its
 * screen.
 *
 * It is also why a grid divergence CANNOT hide: the two tails are cut at the
 * PANE's row count, so a pane holding a different number of rows than the
 * daemon's mirror reaches a different distance up its own buffer and the texts
 * stop matching.
 */

import { tailLines } from "@kolu/padi-client/screenTail";
import type { Page } from "playwright";
import { padiCall } from "./rpcWire.ts";

/** The INNER terminal container for one terminal id — the element that holds
 *  the `__xterm` ref. `data-font-size` is this suite's spelling for "inner"
 *  (the outer CanvasTile wrapper carries the id but no font size and no
 *  terminal — see `./buffer.ts`). */
export const paneSelector = (terminalId: string): string =>
  `[data-terminal-id="${terminalId}"][data-font-size]`;

/** One terminal, read twice. */
export interface TerminalScreens {
  /** The grid the PANE's xterm is holding right now. Under lockstep this is
   *  the grid the daemon's mirror is at, because the only thing that moves it
   *  is a frame on the attach stream. */
  grid: { cols: number; rows: number };
  /** The pane's screen — the last `grid.rows` lines of its xterm buffer. */
  pane: string;
  /** The daemon's screen — the last `grid.rows` lines of ITS mirror, as padi
   *  answers `screen.text`. */
  daemon: string;
  /** Did the pane hold still ACROSS the daemon read? Two screens can only be
   *  compared at one instant, and there is no instant at which both can be
   *  sampled — so the pane is read on both sides of the daemon's answer. When
   *  those two reads are the same text, the daemon's answer was taken while
   *  the pane was in exactly that state and the comparison means something.
   *  When they differ, output landed mid-read: the sample says nothing and
   *  the caller takes another. */
  stable: boolean;
}

/** Read one terminal's screen from both sides, with the daemon's read
 *  sandwiched between two reads of the pane ({@link TerminalScreens.stable}).
 *
 *  The cost of the sandwich is one extra page evaluation; what it buys is a
 *  comparison that holds while the program is WRITING, which is the only
 *  state in which the defect this guards can appear at all. */
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

  const selector = paneSelector(terminalId);
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
    stable:
      !!after &&
      after.text === before.text &&
      after.cols === before.cols &&
      after.rows === before.rows,
  };
}

/** One side's screen as comparable lines: trailing blanks on each row are
 *  noise (the daemon right-trims every row it serializes, so the pane's rows
 *  are trimmed to match), and a leading run of blank rows is only "how far
 *  down the content starts" — which the row-for-row comparison below already
 *  answers through the content itself. */
function screenLines(text: string): string[] {
  const lines = text.split("\n").map((line) => line.replace(/\s+$/, ""));
  let start = 0;
  while (start < lines.length && lines[start] === "") start += 1;
  return lines.slice(start);
}

/** How many lines of each screen a failure message quotes. Enough to show a
 *  full small pane without burying the first difference. */
const QUOTE_LINES = 24;

const quote = (lines: string[]): string =>
  lines
    .slice(0, QUOTE_LINES)
    .map((line, i) => `  ${String(i).padStart(2, "0")} |${line}`)
    .join("\n");

/** `null` when the two screens are the same text, otherwise the sentence that
 *  says where they stopped being the same — naming the first row that differs
 *  and quoting both screens, because "they differ" is not a diagnosis. */
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
