/** Workspace switcher ordering policies.
 *
 *  The input is always one live-terminal list. Desktop and mobile choose
 *  explicit order policies from that list so future desktop grouping changes do
 *  not silently rewrite mobile swipe order. */

import type { TerminalId } from "kolu-common/surface";
import type { TerminalDisplayInfo } from "../../terminal/terminalDisplay";
import type { TileLayout } from "../TileLayout";

/** Live-terminal source row before a presentation-specific order is applied. */
export interface WorkspaceSwitcherSourceEntry {
  id: TerminalId;
  info: TerminalDisplayInfo;
  layout?: TileLayout;
}

/** Pair terminal ids with display info and optional canvas layout. */
export function buildWorkspaceEntries(
  ids: TerminalId[],
  getDisplayInfo: (id: TerminalId) => TerminalDisplayInfo | undefined,
  getLayout?: (id: TerminalId) => TileLayout | undefined,
): WorkspaceSwitcherSourceEntry[] {
  const entries: WorkspaceSwitcherSourceEntry[] = [];
  for (const id of ids) {
    const info = getDisplayInfo(id);
    if (!info) continue;
    entries.push({ id, info, layout: getLayout?.(id) });
  }
  return entries;
}

/** Desktop reads spatially: leftmost tile first, then topmost as tie-break. */
export function desktopWorkspaceOrder(
  entries: WorkspaceSwitcherSourceEntry[],
): WorkspaceSwitcherSourceEntry[] {
  return [...entries].sort((a, b) => {
    const ax = a.layout?.x ?? Infinity;
    const bx = b.layout?.x ?? Infinity;
    if (ax !== bx) return ax - bx;
    const ay = a.layout?.y ?? Infinity;
    const by = b.layout?.y ?? Infinity;
    return ay - by;
  });
}

/** Mobile has no canvas affordance, so it keeps the live terminal order. */
export function mobileWorkspaceOrder(
  entries: WorkspaceSwitcherSourceEntry[],
): WorkspaceSwitcherSourceEntry[] {
  return [...entries];
}

/** Flatten an ordered source-entry list to terminal ids for swipe traversal. */
export function flatWorkspaceOrder(
  entries: WorkspaceSwitcherSourceEntry[],
): TerminalId[] {
  return entries.map((entry) => entry.id);
}
