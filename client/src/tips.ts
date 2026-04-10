/**
 * Tip registry — pure data, no SolidJS imports.
 * All tip IDs and text builders live here for easy maintenance.
 */

import { SHORTCUTS, formatKeybind } from "./keyboard";

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

const isPWA = window.matchMedia("(display-mode: standalone)").matches;

export const AMBIENT_TIPS: readonly Tip[] = [
  ...(!isPWA
    ? [
        {
          id: "amb-pwa",
          text: "Install as PWA for full shortcut support (⌘T, ⌃Tab, etc.)",
        },
      ]
    : []),
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
    id: "amb-random-theme",
    text: `${formatKeybind(SHORTCUTS.randomizeTheme.keybind)} randomizes the terminal color theme`,
  },
  {
    id: "amb-export-pdf",
    text: `${formatKeybind(SHORTCUTS.exportSessionAsPdf.keybind)} exports the current session as a PDF`,
  },
];
