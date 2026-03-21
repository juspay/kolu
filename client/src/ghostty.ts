/**
 * Typed wrapper around ghostty-web terminal emulator.
 *
 * ghostty-web is dynamically imported to avoid blocking initial page load.
 */

import type { Terminal, ITheme, ITerminalOptions } from "ghostty-web";

// Dynamic import shape (ghostty-web exports these at runtime)
interface GhosttyModule {
  init(): Promise<void>;
  Terminal: new (opts?: ITerminalOptions) => Terminal;
}

let mod: GhosttyModule | null = null;

/** Initialize ghostty-web WASM. Idempotent. */
export async function initGhostty(): Promise<void> {
  if (mod) return;
  mod = (await import("ghostty-web")) as unknown as GhosttyModule;
  await mod.init();
}

const FONT_FAMILY = '"FiraCode Nerd Font", monospace';

export const THEME: ITheme = {
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
  if (!mod) throw new Error("ghostty-web not initialized");
  return new mod.Terminal({ fontSize, fontFamily: FONT_FAMILY, theme: THEME });
}

/** Measure cell dimensions from canvas size and known grid dimensions. */
export function measureCells(el: HTMLElement, cols: number, rows: number) {
  const canvas = el.querySelector("canvas");
  if (!canvas) throw new Error("No canvas found in terminal element");
  const { width, height } = canvas.getBoundingClientRect();
  return { cellWidth: width / cols, cellHeight: height / rows };
}

/** Calculate cols/rows to fill a container given cell dimensions. */
export function fitToContainer(
  container: HTMLElement,
  cellWidth: number,
  cellHeight: number,
) {
  const { width, height } = container.getBoundingClientRect();
  return {
    cols: Math.floor(width / cellWidth),
    rows: Math.floor(height / cellHeight),
  };
}

/** Build WebSocket URL for a terminal session. */
export function buildWsUrl(sessionId: string): string {
  const { protocol, host } = window.location;
  return `${protocol === "https:" ? "wss:" : "ws:"}//${host}/ws/${sessionId}`;
}

export type { Terminal };
