/**
 * vazhi's screen, as a pure function of its state.
 *
 * Every frame is built here and nowhere else: `main.ts` owns the terminal and
 * the keys, this owns what the terminal shows. That split is what makes the
 * layout testable — a table, a prompt, an error line and an empty state are all
 * just strings, and no test needs a PTY to check them.
 */

import type { Forward } from "@kolu/port-forward";
import { formatTarget } from "@kolu/port-forward";
import columnify from "columnify";

/** ANSI, kept to the few attributes a monochrome-friendly TUI needs. */
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

/** The bottom line of the screen: either the keybind legend, or the prompt of
 *  whatever is being typed. */
export type Mode =
  | { readonly kind: "table" }
  | { readonly kind: "add"; readonly input: string };

/** The one transient message line — what just happened, or what just failed. */
export interface Status {
  readonly kind: "info" | "error";
  readonly text: string;
}

export interface Screen {
  readonly forwards: readonly Forward[];
  /** Index into `forwards` of the highlighted row. */
  readonly selected: number;
  readonly mode: Mode;
  readonly status: Status | undefined;
  /** Epoch ms, for the uptime column. Passed in so frames are reproducible. */
  readonly now: number;
  /** Terminal columns; lines are clipped to it so a narrow window never wraps
   *  a row into two. */
  readonly width: number;
  /** This machine's name — the host part of the URL a forward answers on. */
  readonly hostname: string;
}

/** How long a forward has been up, in the coarsest unit that still says
 *  something: seconds under a minute, then minutes, then hours, then days. */
export function formatUptime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** Keep the highlight on a real row as the list grows and shrinks under it. */
export function clampSelection(selected: number, count: number): number {
  if (count === 0) return 0;
  return Math.min(Math.max(selected, 0), count - 1);
}

/** A run of text with one optional attribute. A line is built from these rather
 *  than from pre-coloured strings so clipping counts VISIBLE characters and can
 *  never cut an escape sequence in half. */
interface Segment {
  readonly text: string;
  readonly style?: string;
}

/** Render segments into one terminal line, clipped to `width`. */
function line(segments: readonly Segment[], width: number): string {
  let used = 0;
  let out = "";
  for (const segment of segments) {
    if (used >= width) break;
    const text = segment.text.slice(0, width - used);
    used += text.length;
    out +=
      segment.style === undefined ? text : `${segment.style}${text}${RESET}`;
  }
  return out;
}

/** The forward table, aligned by columnify so the arrows line up whatever the
 *  host names are. Returns one entry per forward, marker included, undecorated. */
function tableLines(screen: Screen): string[] {
  const rows = screen.forwards.map((forward, index) => ({
    marker:
      index === clampSelection(screen.selected, screen.forwards.length)
        ? "›"
        : " ",
    target: formatTarget(forward.target),
    arrow: "→",
    listener: `0.0.0.0:${forward.localPort}`,
    uptime: `up ${formatUptime(screen.now - forward.createdAt)}`,
  }));
  return columnify(rows, {
    showHeaders: false,
    columnSplitter: "  ",
    columns: ["marker", "target", "arrow", "listener", "uptime"],
  }).split("\n");
}

/** The whole frame, as terminal lines (no trailing newline). */
export function renderScreen(screen: Screen): string[] {
  const selected = clampSelection(screen.selected, screen.forwards.length);
  const count = screen.forwards.length;
  const width = screen.width;
  const lines: string[] = [
    line(
      [
        { text: "vazhi", style: BOLD },
        {
          text: ` · ${count === 0 ? "no" : count} forward${count === 1 ? "" : "s"} · answering on ${screen.hostname}`,
          style: DIM,
        },
      ],
      width,
    ),
    "",
  ];

  if (count === 0) {
    lines.push(
      line(
        [
          {
            text: "nothing forwarded yet — press a and type host:port (e.g. pu-dev:5173)",
            style: DIM,
          },
        ],
        width,
      ),
    );
  } else {
    for (const [index, row] of tableLines(screen).entries()) {
      lines.push(
        line(
          [
            {
              text: row.trimEnd(),
              style: index === selected ? CYAN : undefined,
            },
          ],
          width,
        ),
      );
    }
  }

  lines.push("");
  if (screen.status !== undefined) {
    lines.push(
      line(
        [
          {
            text: screen.status.text,
            style: screen.status.kind === "error" ? RED : DIM,
          },
        ],
        width,
      ),
    );
  } else {
    lines.push("");
  }

  lines.push("");
  lines.push(
    screen.mode.kind === "add"
      ? line(
          [
            { text: `host:port ▸ ${screen.mode.input}` },
            { text: "  (enter to add · esc to cancel)", style: DIM },
          ],
          width,
        )
      : line(
          [{ text: "a add · x cancel · j/k move · q quit", style: DIM }],
          width,
        ),
  );
  return lines;
}
