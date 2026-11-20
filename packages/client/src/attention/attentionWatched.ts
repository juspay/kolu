import type { TerminalId } from "kolu-common/surface";

export function isTerminalWatched(
  activeHost: boolean,
  id: TerminalId,
  focusedId: TerminalId | null,
  pageFocused: boolean,
): boolean {
  return activeHost && id === focusedId && pageFocused;
}
