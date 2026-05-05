import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";

export const FALLBACK_REPO_COLOR = "var(--color-accent)";
export const FALLBACK_BRANCH_COLOR = "var(--color-fg)";

export function repoAccent(info: TerminalDisplayInfo): string {
  return info.repoColor ?? FALLBACK_REPO_COLOR;
}

export function branchAccent(info: TerminalDisplayInfo): string {
  return info.branchColor ?? FALLBACK_BRANCH_COLOR;
}
