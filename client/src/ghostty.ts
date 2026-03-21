/**
 * Typed wrapper around ghostty-web terminal emulator.
 *
 * ghostty-web is dynamically imported to avoid blocking initial page load.
 * The Terminal renders onto an HTML canvas inside the target element.
 */

// ghostty-web doesn't ship TS types, so we declare what we use
interface GhosttyTheme {
  foreground?: string;
  background?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

interface GhosttyOptions {
  fontSize?: number;
  fontFamily?: string;
  theme?: GhosttyTheme;
}

interface GhosttyModule {
  init(): Promise<void>;
  Terminal: new (opts?: GhosttyOptions) => GhosttyTerminal;
}

interface GhosttyTerminal {
  open(element: HTMLElement): void;
  write(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  dispose(): void;
  onData(cb: (data: string) => void): void;
  onResize(cb: (size: { cols: number; rows: number }) => void): void;
  get fontSize(): number;
  set fontSize(size: number);
}

let ghosttyModule: GhosttyModule | null = null;

/** Initialize ghostty-web WASM. Idempotent. */
export async function initGhostty(): Promise<void> {
  if (ghosttyModule) return;
  const mod = (await import("ghostty-web")) as GhosttyModule;
  await mod.init();
  ghosttyModule = mod;
}

const FONT_FAMILY = '"FiraCode Nerd Font", monospace';

export const GHOSTTY_THEME: GhosttyTheme = {
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
export function createTerminal(fontSize?: number): GhosttyTerminal {
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

export type { GhosttyTerminal };
