/** Screen-scrape detection of Antigravity CLI's permission menus.
 *
 *  `agy` writes a tool-calling answer to the transcript BEFORE the tool runs
 *  and asks permission, so the transcript reads `tool_use` for the whole wait
 *  and cannot say whether the tool is running or waiting for a keystroke. The
 *  menu is painted on the terminal, so it is recognised there. This file is the
 *  detector plus the promote-only policy that lifts `tool_use` →
 *  `awaiting_user` while a menu is on screen. Pure and stateless: a VT-resolved
 *  screen in, a decision out. Zero `node:*` imports, zero filesystem.
 *
 *  ## The markers (`agy` 1.5.19, captured in a terminal, 2026-11-28)
 *
 *  Each is `agy`'s own fixed chrome, never model or tool text, anchored on
 *  whole lines and their place:
 *
 *   - **Command permission** — the question line `Run this command?`, and
 *     directly under it the menu's first item, `1. Yes, run command`, drawn
 *     with the selection mark `> ` or its two-space blank.
 *
 *  And for every marker, the LAST painted line of the screen must be the
 *  menu's footer, `esc to cancel` (the model and mode follow on the same row).
 *  A menu is drawn at the bottom; the same words scrolled up into history, or
 *  quoted in an answer while `agy` sits at its prompt (whose footer is the
 *  shortcuts hint), cannot fire.
 *
 *  Other prompts are not detected. Re-confirm each literal from a live capture
 *  on any `agy` UI change — never from a guess. */

import type { AntigravityInfo } from "./schemas.ts";

/** How many lines of the screen tail the detector inspects. A menu is drawn at
 *  the bottom; 40 lines covers the tallest one plus its footer. */
export const TAIL_REGION_LINES = 40;

/** Menu bodies, each matched against the tail with trailing blanks trimmed
 *  from every line. */
const MENU_MARKERS: readonly RegExp[] = [
  /^Run this command\?\n(?:> | {2})1\. Yes, run command$/m,
];

/** The footer `agy` draws under a menu (and under a running tool — so it is a
 *  place, never a marker on its own). */
const MENU_FOOTER = /^esc to cancel(?:\s|$)/;

/** The last painted lines, trailing blanks trimmed from each line and blank
 *  rows trimmed from the bottom. */
function tailRegion(screenText: string): string[] {
  const lines = screenText.split("\n").map((line) => line.trimEnd());
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  return lines.slice(Math.max(0, end - TAIL_REGION_LINES), end);
}

/** Whether one of `agy`'s permission menus is on screen. */
export function screenHasAntigravityMenu(screenText: string): boolean {
  const tail = tailRegion(screenText);
  if (!MENU_FOOTER.test(tail.at(-1) ?? "")) return false;
  const text = tail.join("\n");
  return MENU_MARKERS.some((re) => re.test(text));
}

/** The menu is asked from inside a tool call, whose answer is already the
 *  transcript's last line, so `tool_use` is the only state it can lift. An idle
 *  or thinking `agy` costs no screen read. */
export function isAntigravityScreenPollable(info: AntigravityInfo): boolean {
  return info.state === "tool_use";
}

/** Lift `tool_use` → `awaiting_user` while a permission menu is on screen;
 *  otherwise return `info` unchanged (same reference). Promote-only: the
 *  orchestrator settles back to the watcher's own value once the menu clears. */
export function promoteAntigravityFromScreen(
  info: AntigravityInfo,
  screenText: string,
): AntigravityInfo {
  if (!isAntigravityScreenPollable(info)) return info;
  return screenHasAntigravityMenu(screenText)
    ? { ...info, state: "awaiting_user" }
    : info;
}
