import type { TerminalId } from "kolu-common/surface";

/** Whether one terminal is visibly receiving input in the foreground page. */
export function isTerminalWatched(
  activeHost: boolean,
  id: TerminalId,
  focusedId: TerminalId | null,
  pageFocused: boolean,
): boolean {
  return activeHost && id === focusedId && pageFocused;
}
