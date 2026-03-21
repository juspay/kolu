/**
 * Typed wrapper around ghostty-web terminal emulator.
 *
 * ghostty-web is dynamically imported to avoid blocking initial page load.
 * The Terminal renders onto an HTML canvas inside the target element.
 */

import type {
  Terminal,
  ITheme,
  ITerminalOptions,
} from "ghostty-web";

// ghostty-web's dynamic import shape
interface GhosttyModule {
  init(): Promise<void>;
  Terminal: new (opts?: ITerminalOptions) => Terminal;
}

let ghosttyModule: GhosttyModule | null = null;

/** Initialize ghostty-web WASM. Idempotent. */
export async function initGhostty(): Promise<void> {
  if (ghosttyModule) return;
  const mod = (await import("ghostty-web")) as unknown as GhosttyModule;
  await mod.init();
  ghosttyModule = mod;
}

const FONT_FAMILY = '"FiraCode Nerd Font", monospace';

export const GHOSTTY_THEME: ITheme = {
  foreground: "#ffffff",
  background: "#292c33",
  cursor: "#ffffff",
  cursorAccent: "#363a43",
  selectionBackground: "#ffffff",
  selectionForeground: "#ffffff",
  black: "#1d1f21",
  red: "#bf6b69",
  green: "#b7bd73",
  yellow: "#e9c880",
  blue: "#88a1bb",
  magenta: "#ad95b8",
  cyan: "#95bdb7",
  white: "#c5c8c6",
  brightBlack: "#666666",
  brightRed: "#c55757",
  brightGreen: "#bcc95f",
  brightYellow: "#e1c65e",
  brightBlue: "#83a5d6",
  brightMagenta: "#bc99d4",
  brightCyan: "#83beb1",
  brightWhite: "#eaeaea",
};

/** Create a new terminal instance. Call initGhostty() first. */
export function createTerminal(fontSize?: number): Terminal {
  if (!ghosttyModule) throw new Error("ghostty-web not initialized");
  return new ghosttyModule.Terminal({
    fontSize,
    fontFamily: FONT_FAMILY,
    theme: GHOSTTY_THEME,
  });
}

/** Measure cell dimensions by dividing canvas size by known grid size. */
export function measureCells(
  el: HTMLElement,
  cols: number,
  rows: number,
): {
  cellWidth: number;
  cellHeight: number;
} {
  const canvas = el.querySelector("canvas");
  if (!canvas) throw new Error("No canvas found in terminal element");
  const rect = canvas.getBoundingClientRect();
  return {
    cellWidth: rect.width / cols,
    cellHeight: rect.height / rows,
  };
}

/** Calculate cols/rows to fill a container, given cell dimensions. */
export function fitToContainer(
  container: HTMLElement,
  cellWidth: number,
  cellHeight: number,
): { cols: number; rows: number } {
  const rect = container.getBoundingClientRect();
  return {
    cols: Math.floor(rect.width / cellWidth),
    rows: Math.floor(rect.height / cellHeight),
  };
}

/** Build WebSocket URL for a terminal session. */
export function buildWsUrl(sessionId: string): string {
  const loc = window.location;
  // In dev mode (Vite), the proxy handles /ws
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}/ws/${sessionId}`;
}

export type { Terminal };
