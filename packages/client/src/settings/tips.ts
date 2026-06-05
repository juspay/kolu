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
    text: `${formatKeybind(ACTIONS.toggleRightPanel.keybind)} toggles the inspector panel with full terminal context`,
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
    id: "amb-chrome-maximize",
    text: "Use the maximize toggle in the header to switch between the tiled canvas and maximized mode.",
  },
  {
    id: "amb-pwa-install",
    text: "Install kolu as a native app from your browser menu — unlocks ⌘T, ⌃Tab and friends",
  },
  {
    id: "amb-file-ref-link",
    text: "Click a `packages/foo/bar.ts:42` path in any terminal to open it in the right panel at that line",
  },
  {
    id: "amb-minimap-window",
    text: "Click the `All` chip in the minimap's zoom bar to pick an activity window (4h/12h/24h/48h) — older tiles collapse to small ghost markers so attention stays on what's still in play",
  },
  {
    id: "amb-terminal-intent",
    text: `Click the annotation slot in a tile's title bar (or ${formatKeybind(ACTIONS.commandPalette.keybind)} → "Edit intent") to attach a note — line 1 supplants the branch name in dock/switcher; the rest renders as markdown`,
  },
  {
    id: "amb-comments-on-files",
    text: "Select any text in the Code tab (file browse, branch diff, or HTML artifact) to drop a `+ Comment` — your queue copies to the clipboard as Markdown for the agent",
  },
  {
    id: "amb-markdown-preview",
    text: "Open a `.md` file in the Code tab's browse mode to read it rendered — flip the Source ⇄ Rendered toggle in the file header to see the raw Markdown",
  },
  {
    id: "amb-code-tab-back-forward",
    text: "The Code tab is a browser — follow a link or jump between files, then use the ◀ ▶ buttons (or Alt+←/→) to go back and forward through everywhere you've been",
  },
];
