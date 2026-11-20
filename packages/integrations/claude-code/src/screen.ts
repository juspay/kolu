import type { ClaudeCodeInfo } from "./schemas.ts";

export const TAIL_REGION_LINES = 40;

const ASK_USER_QUESTION_FOOTER =
  /to navigate\s*·(?:[\s\S]*?·)?\s*Esc to cancel/;
const EDIT_GATE_FOOTER = /Esc to cancel\s*·?\s*Tab to amend/;
const PERMISSION_GATE_REMEMBER_OPTION =
  /^\s*\d+\.\s*Yes, and don.t ask again for\b/m;

const PROMPT_MARKERS: readonly RegExp[] = [
  ASK_USER_QUESTION_FOOTER,
  EDIT_GATE_FOOTER,
  PERMISSION_GATE_REMEMBER_OPTION,
];

function tailRegion(screenText: string): string[] {
  const lines = screenText.split("\n");
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? "").trim() === "") end--;
  return lines.slice(Math.max(0, end - TAIL_REGION_LINES), end);
}

export function screenHasClaudePrompt(screenText: string): boolean {
  const tail = tailRegion(screenText).join("\n");
  return PROMPT_MARKERS.some((re) => re.test(tail));
}

const PROMOTABLE_STATES = new Set<ClaudeCodeInfo["state"]>([
  "thinking",
  "tool_use",
  "waiting",
]);

export function isScreenPollable(info: ClaudeCodeInfo): boolean {
  return PROMOTABLE_STATES.has(info.state);
}

export function promoteFromScreen(
  info: ClaudeCodeInfo,
  screenText: string,
): ClaudeCodeInfo {
  if (!PROMOTABLE_STATES.has(info.state)) return info;
  return screenHasClaudePrompt(screenText)
    ? { ...info, state: "awaiting_user" }
    : info;
}
