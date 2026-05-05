import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";

/** Repo identity fallback when metadata has not produced a repo color yet. */
export const FALLBACK_REPO_COLOR = "var(--color-accent)";
/** Branch identity fallback when metadata has not produced a branch color yet. */
export const FALLBACK_BRANCH_COLOR = "var(--color-fg)";

/** Repo color used consistently across switcher headings and borders. */
export function repoAccent(info: TerminalDisplayInfo): string {
  return info.repoColor ?? FALLBACK_REPO_COLOR;
}

/** Branch color used consistently across switcher branch labels. */
export function branchAccent(info: TerminalDisplayInfo): string {
  return info.branchColor ?? FALLBACK_BRANCH_COLOR;
}
