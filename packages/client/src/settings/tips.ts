/**
 * Tip registry — pure data, no SolidJS imports.
 * All tip IDs and text builders live here for easy maintenance.
 */

import { ACTIONS } from "../input/actions";
import { formatKeybind } from "../input/keyboard";

export type TipId = string;

export interface Tip {
  id: TipId;
  text: string;
}

/** Built when the user clicks a compact switcher pill — surfaces the
 *  numeric switch shortcut so they learn the keyboard path. */
export function workspaceSwitcherSwitchTip(index: number): Tip {
  const key = (index + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  return {
    id: "workspace-switcher-switch",
    text: `Tip: ${formatKeybind(ACTIONS[`switchTo${key}`].keybind)} switches directly`,
  };
}

export const CONTEXTUAL_TIPS = {
  themeFromPalette: {
    id: "theme-palette",
    text: `Tip: ${formatKeybind(ACTIONS.commandPalette.keybind)} → Theme for quick switching`,
  },
  worktree: {
    id: "worktree",
    text: `${formatKeybind(ACTIONS.commandPalette.keybind)} → New terminal → worktree for parallel sessions`,
  },
  themeSwitch: {
    id: "theme-switch",
    text: `Tip: ${formatKeybind(ACTIONS.shuffleTheme.keybind)} cycles through terminal themes`,
  },
} as const satisfies Record<string, Tip>;

export const AMBIENT_TIPS: readonly Tip[] = [
  {
    id: "amb-sub",
    text: `${formatKeybind(ACTIONS.toggleSubPanel.keybind)} splits your terminal into a bottom pane`,
  },
  {
    id: "amb-workspace-switcher-shortcut",
    text: `${formatKeybind(ACTIONS.openWorkspaceSwitcher.keybind)} opens the workspace switcher with search focused`,
  },
  {
    id: "amb-mru",
    text: `${formatKeybind(ACTIONS.cycleTerminalMru.keybind)} cycles terminals in most-recently-used order`,
  },
  {
    id: "amb-search",
    text: `${formatKeybind(ACTIONS.findInTerminal.keybind)} searches terminal output`,
  },
  {
    id: "amb-shuffle-theme",
    text: `${formatKeybind(ACTIONS.shuffleTheme.keybind)} shuffles the terminal color theme`,
  },
  {
    id: "amb-screenshot",
    text: `${formatKeybind(ACTIONS.screenshotTerminal.keybind)} copies a PNG screenshot of the active terminal to your clipboard`,
  },
  {
    id: "amb-export-session",
    text: `${formatKeybind(ACTIONS.commandPalette.keybind)} → "Export agent session as HTML" saves the active Claude/OpenCode/Codex transcript as a self-contained, navigable file`,
  },
  {
    id: "amb-inspector",
    text: `${formatKeybind(ACTIONS.toggleInspectorCompanion.keybind)} welds an inspector panel beside the active tile`,
  },
  {
    id: "amb-code-companion",
    text: `${formatKeybind(ACTIONS.toggleCodeCompanion.keybind)} welds a code/diff browser beside the active tile`,
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
