/**
 * Tip registry — pure data, no SolidJS imports.
 * All tip IDs and text builders live here for easy maintenance.
 * Optional `doc` links a tip to a product-docs page via DocLink.
 */

import { posturedActionLabel } from "../canvas/useViewPosture";
import { ACTIONS } from "../input/actions";
import { formatKeybind } from "../input/keyboard";
import type { DocSlug } from "../ui/DocLink";

export type TipId = string;

export interface Tip {
  id: TipId;
  text: string;
  /** Optional product-docs slug — TipBanner renders a trailing "Docs →" link. */
  doc?: DocSlug;
}

export const CONTEXTUAL_TIPS = {
  themeFromPalette: {
    id: "theme-palette",
    text: `Tip: ${formatKeybind(ACTIONS.commandPalette.keybind)} → Theme for quick switching`,
    doc: "theming",
  },
  worktree: {
    id: "worktree",
    text: `${formatKeybind(ACTIONS.commandPalette.keybind)} → New terminal → worktree for parallel sessions`,
  },
  themeSwitch: {
    id: "theme-switch",
    text: `Tip: ${formatKeybind(ACTIONS.shuffleTheme.keybind)} cycles through terminal themes`,
    doc: "theming",
  },
  sleepTerminal: {
    id: "sleep-terminal",
    text: "Sleep (☾) pauses a terminal — its agent and PTY are released; Wake resumes the conversation right where it left off",
    doc: "sessions",
  },
} as const satisfies Record<string, Tip>;

export const AMBIENT_TIPS: readonly Tip[] = [
  {
    id: "amb-sub",
    text: `${formatKeybind(ACTIONS.toggleSubPanel.keybind)} splits your terminal into a bottom pane`,
  },
  {
    id: "amb-host-map",
    text: "Set KOLU_PADI_HOST=localhost,you@box to work across machines — a host strip appears in the top bar; click a host to switch the whole canvas to it live (no reload), each chip showing its connection and how many agents await you",
    doc: "remote-hosts",
  },
  {
    id: "amb-workspace-switcher-shortcut",
    text: `${formatKeybind(ACTIONS.openWorkspaceSwitcher.keybind)} opens Terminals (browse by host or type to search all); ${formatKeybind(ACTIONS.commandPalette.keybind)} at root finds the same terminals by name`,
  },
  {
    id: "amb-palette-finds-everything",
    text: `${formatKeybind(ACTIONS.commandPalette.keybind)} finds terminals and hosts too — type a branch, repo, or machine name without opening a separate switcher`,
    doc: "switcher",
  },
  {
    id: "amb-visit-recency",
    text: `${formatKeybind(ACTIONS.commandPalette.keybind)} then Enter jumps to the previous terminal (Recent hides the one you're in) — works across hosts too`,
    doc: "switcher",
  },
  {
    id: "amb-mru",
    text: `${formatKeybind(ACTIONS.cycleTerminalMru.keybind)} cycles terminals in most-recently-used order (same trail as Recent, this host only; survives reload)`,
  },
  {
    // Replaces the old "searches terminal output" tip (id `amb-search`), which
    // is misleading now that the chord is terminal-scoped. New id so users who
    // already saw the old one still get the corrected copy.
    id: "amb-codetab-find",
    text: `${formatKeybind(ACTIONS.findInTerminal.keybind)} searches the terminal; outside one — the Code tab, a preview, a panel — it hands off to your browser's own find-in-page`,
    doc: "code-tab",
  },
  {
    id: "amb-inspector-ports",
    text: "The Inspector's Ports section lists what the terminal is serving — click a port to open it, and kolu opens a forward first if it needs one (loopback, or a remote host)",
  },
  {
    id: "amb-shuffle-theme",
    text: `${formatKeybind(ACTIONS.shuffleTheme.keybind)} shuffles the terminal color theme`,
    doc: "theming",
  },
  {
    id: "amb-screenshot",
    text: `${formatKeybind(ACTIONS.screenshotTerminal.keybind)} copies a PNG screenshot of the active terminal to your clipboard`,
    doc: "power-features",
  },
  {
    id: "amb-export-session",
    text: `${formatKeybind(ACTIONS.commandPalette.keybind)} → "Export agent session as HTML" saves the active Claude/OpenCode/Codex transcript as a chat log, a full transcript, or both`,
    doc: "power-features",
  },
  {
    id: "amb-inspector",
    text: `${formatKeybind(ACTIONS.toggleRightPanel.keybind)} toggles the right panel — the Code browser plus an Inspector tab with full terminal context`,
    doc: "right-panel",
  },
  {
    id: "amb-inspector-attach",
    text: "The Inspector tab's Attach section copies `kaval-tui attach`, `snapshot`, and `send` commands for the main terminal and each split, plus a kaval-tui/padi-tui reference — drive (and even prompt) any pane from any shell",
    doc: "right-panel",
  },
  {
    id: "amb-inspector-compose",
    text: "The Inspector tab's Compose box lets you draft a multiline prompt and send it into the active terminal (⌘/Ctrl+Enter) — it lands in the agent's input box for you to review and submit, and each terminal keeps its own draft across reloads",
    doc: "right-panel",
  },
  {
    id: "amb-canvas-zoom",
    text: "Pinch or Ctrl+scroll to zoom the canvas. Two-finger scroll to pan.",
    doc: "canvas",
  },
  {
    id: "amb-canvas-hand",
    text: "Middle-click and drag to pan the canvas freely in any direction",
    doc: "canvas",
  },
  {
    id: "amb-canvas-shift-pan",
    text: "Hold Shift and drag (or scroll) to pan the canvas — even over a terminal tile",
    doc: "canvas",
  },
  {
    id: "amb-tile-maximize",
    text: "Double-click a tile's title bar to maximize it to the viewport. Double-click again to restore.",
    doc: "tiles",
  },
  {
    id: "amb-canvas-dblclick-create",
    text: "Double-click an empty spot on the canvas to open the New terminal menu — no need to reach for the dock's + or a shortcut",
    doc: "canvas",
  },
  {
    id: "amb-chrome-maximize",
    text: `${formatKeybind(ACTIONS.toggleCanvasPosture.keybind)} (or the maximize toggle in the header, or ${formatKeybind(ACTIONS.commandPalette.keybind)} → "${posturedActionLabel("tiled")}" / "${posturedActionLabel("maximized")}") switches between the tiled canvas and maximized mode.`,
    doc: "canvas",
  },
  {
    id: "amb-pwa-install",
    text: "Install kolu as a native app from your browser menu — unlocks ⌘T, ⌃Tab and friends",
    doc: "install-pwa",
  },
  {
    id: "amb-welcome",
    text: `${formatKeybind(ACTIONS.commandPalette.keybind)} → "Tutorial" reopens the welcome anytime — pin kolu as an app, reach it remotely, run agents`,
  },
  {
    id: "amb-file-ref-link",
    text: "Click a `packages/foo/bar.ts:42` path in any terminal to open it in the right panel at that line",
    doc: "code-tab",
  },
  {
    id: "amb-folder-ref-link",
    text: "Click a folder path like `packages/client/` in a terminal to reveal it in the Code tab's file tree",
    doc: "code-tab",
  },
  {
    id: "amb-minimap-window",
    text: "Click the `All` chip in the minimap's zoom bar to pick an activity window (4h/12h/24h/48h) — older tiles collapse to small ghost markers so attention stays on what's still in play",
    doc: "canvas",
  },
  {
    id: "amb-dock-sleeping",
    text: "The dock's Filters row has two chips: the activity window (hides stale terminals) and a ☾ chip that hides sleeping ones — click ☾ when you want the dock to show only what's awake",
    doc: "dock",
  },
  {
    id: "amb-terminal-intent",
    text: `Click the annotation slot in a tile's title bar (or ${formatKeybind(ACTIONS.commandPalette.keybind)} → "Edit intent") to attach a note — line 1 supplants the branch name in dock/switcher; the rest renders as markdown`,
  },
  {
    id: "amb-comments-on-files",
    text: "Select any text in the Code tab (file browse, branch diff, or HTML artifact) to drop a `+ Comment` — your queue copies to the clipboard as Markdown for the agent",
    doc: "code-tab",
  },
  {
    id: "amb-markdown-preview",
    text: "Open a `.md` file in the Code tab's browse mode to read it rendered — flip the Source ⇄ Rendered toggle in the file header to see the raw Markdown",
    doc: "code-tab",
  },
  {
    id: "amb-code-tab-back-forward",
    text: "The Code tab is a browser — follow a link or jump between files, then use the ◀ ▶ buttons, Alt+←/→, or your mouse's back/forward buttons to retrace everywhere you've been",
    doc: "code-tab",
  },
];
