/**
 * Tip registry — pure data, no SolidJS imports.
 * All tip IDs and text builders live here for easy maintenance.
 */

import { SHORTCUTS, formatKeybind } from "../input/keyboard";

export type TipId = string;

export interface Tip {
  id: TipId;
  text: string;
}

/** Build the sidebar-switch tip dynamically using the terminal's position. */
export function sidebarSwitchTip(index: number): Tip {
  const key = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  return {
    id: "sidebar-switch",
    text: `Tip: ${formatKeybind(SHORTCUTS[`switchTo${key}`].keybind)} switches directly`,
  };
}

export const CONTEXTUAL_TIPS = {
  themeFromPalette: {
    id: "theme-palette",
    text: `Tip: ${formatKeybind(SHORTCUTS.commandPalette.keybind)} → Theme for quick switching`,
  },
  worktree: {
    id: "worktree",
    text: `${formatKeybind(SHORTCUTS.commandPalette.keybind)} → New terminal → worktree for parallel sessions`,
  },
} as const satisfies Record<string, Tip>;

export const AMBIENT_TIPS: readonly Tip[] = [
  {
    id: "amb-sub",
    text: `${formatKeybind(SHORTCUTS.toggleSubPanel.keybind)} splits your terminal into a bottom pane`,
  },
  { id: "amb-drag", text: "Drag sidebar entries to reorder terminals" },
  {
    id: "amb-mru",
    text: `${formatKeybind(SHORTCUTS.cycleTerminalMru.keybind)} cycles terminals in most-recently-used order`,
  },
  {
    id: "amb-search",
    text: `${formatKeybind(SHORTCUTS.findInTerminal.keybind)} searches terminal output`,
  },
  {
    id: "amb-shuffle-theme",
    text: `${formatKeybind(SHORTCUTS.shuffleTheme.keybind)} shuffles the terminal color theme`,
  },
  {
    id: "amb-export-pdf",
    text: `${formatKeybind(SHORTCUTS.exportSessionAsPdf.keybind)} exports the current session as a PDF`,
  },
  {
    id: "amb-inspector",
    text: `${formatKeybind(SHORTCUTS.toggleRightPanel.keybind)} toggles the inspector panel with full terminal context`,
  },
  {
    id: "amb-canvas",
    text: "Click the grid icon in the header to switch to Canvas mode — drag and resize terminals freely",
  },
];
