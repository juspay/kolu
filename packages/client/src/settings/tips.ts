/**
 * Tip registry — pure data, no SolidJS imports.
 * All tip IDs and text builders live here for easy maintenance.
 */

import { formatKeybind, SHORTCUTS } from "../input/keyboard";

export type TipId = string;

export interface Tip {
  id: TipId;
  text: string;
}

/** Built when the user clicks a pill in the floating tree — surfaces the
 *  numeric switch shortcut so they learn the keyboard path. */
export function pillTreeSwitchTip(index: number): Tip {
  const key = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  return {
    id: "pill-tree-switch",
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
  themeSwitch: {
    id: "theme-switch",
    text: `Tip: ${formatKeybind(SHORTCUTS.shuffleTheme.keybind)} cycles through terminal themes`,
  },
} as const satisfies Record<string, Tip>;

export const AMBIENT_TIPS: readonly Tip[] = [
  {
    id: "amb-sub",
    text: `${formatKeybind(SHORTCUTS.toggleSubPanel.keybind)} splits your terminal into a bottom pane`,
  },
  {
    id: "amb-pill-tree",
    text: "Hover the pill tree at the top of the canvas to switch terminals — click a branch pill to pan to it",
  },
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
    id: "amb-screenshot",
    text: `${formatKeybind(SHORTCUTS.screenshotTerminal.keybind)} copies a PNG screenshot of the active terminal to your clipboard`,
  },
  {
    id: "amb-inspector",
    text: `${formatKeybind(SHORTCUTS.toggleRightPanel.keybind)} toggles the inspector panel with full terminal context`,
  },
  {
    id: "amb-canvas-zoom",
    text: "Pinch or Ctrl+scroll to zoom the canvas. Two-finger scroll to pan.",
  },
  {
    id: "amb-canvas-hand",
    text: "Middle-click and drag to pan the canvas freely in any direction",
  },
  {
    id: "amb-canvas-shift-pan",
    text: "Hold Shift and drag (or scroll) to pan the canvas — even over a terminal tile",
  },
  {
    id: "amb-tile-maximize",
    text: "Double-click a tile's title bar to maximize it to the viewport. Double-click again to restore.",
  },
  {
    id: "amb-pwa-install",
    text: "Install kolu as a native app from your browser menu — unlocks ⌘T, ⌃Tab and friends",
  },
];
