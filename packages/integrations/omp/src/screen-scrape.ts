import { type PaneReading, paneHolds } from "anyagent";
import type { OmpInfo } from "./schemas.ts";

export const TAIL_REGION_LINES = 40;

interface DialogMarker {
  corner: string;
  title: string;
}

const ROUND_CORNER = "╭─ ";

const DIALOG_MARKERS: readonly DialogMarker[] = [
  { corner: ROUND_CORNER, title: "Allow tool" },
  { corner: ROUND_CORNER, title: "Ask" },
];

const PROMPT_MARKERS: readonly RegExp[] = DIALOG_MARKERS.map(
  ({ corner, title }) =>
    new RegExp(`^${escapeForRegExp(corner + title)}\\b`, "m"),
);

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tailRegion(screenText: string): string[] {
  const lines = screenText.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(Math.max(0, end - TAIL_REGION_LINES), end);
}

export function screenHasOmpPrompt(screenText: string): boolean {
  const tail = tailRegion(screenText).join("\n");
  return PROMPT_MARKERS.some((re) => re.test(tail));
}

const STEERING_HEADER = /^\s*Steering · (\d+)\s*$/;
const STEERING_ITEM = /^\s*\d+\.\s(.*)$/;
const STEERING_CLOSER = /^\s*└ Alt\+↑ to edit\s*$/;

export function ompSteerPane(screenText: string, words: string): PaneReading {
  const rows = screenText.split("\n");
  const header = rows.findIndex((line) => STEERING_HEADER.test(line));
  if (header === -1) {
    return rows.some((line) => STEERING_CLOSER.test(line))
      ? {
          kind: "unreadable",
          why: `omp's steering pane runs past the ${rows.length} rows kolu read, so its items are above them`,
        }
      : { kind: "absent" };
  }
  const held = Number(STEERING_HEADER.exec(rows[header] ?? "")?.[1]);
  const items: string[] = [];
  for (const line of rows.slice(header + 1)) {
    const item = STEERING_ITEM.exec(line);
    if (item === null) break;
    items.push(item[1] ?? "");
  }
  if (items.length !== held) {
    return {
      kind: "unreadable",
      why: `omp's steering pane says it holds ${held} message(s) and kolu could read ${items.length} of its rows`,
    };
  }
  return paneHolds(items, words);
}

const PROMOTABLE_STATES = new Set<OmpInfo["state"]>(["thinking", "tool_use"]);

export function isOmpScreenPollable(info: OmpInfo): boolean {
  return PROMOTABLE_STATES.has(info.state);
}

export function promoteOmpFromScreen(
  info: OmpInfo,
  screenText: string,
): OmpInfo {
  if (!PROMOTABLE_STATES.has(info.state)) return info;
  return screenHasOmpPrompt(screenText)
    ? { ...info, state: "awaiting_user" }
    : info;
}
