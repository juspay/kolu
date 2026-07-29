import type { TerminalId } from "kolu-common/surface";

/** Fold the focused terminal to the top-level tile that contains it. A missing
 *  record is temporarily treated as top-level; the reactive parent read
 *  corrects the fold when metadata arrives, with no effect watching the fold. */
export function activeTileOf(
  focusedId: TerminalId | null,
  parentOf: (id: TerminalId) => TerminalId | null,
): TerminalId | null {
  if (focusedId === null) return null;
  return parentOf(focusedId) ?? focusedId;
}
