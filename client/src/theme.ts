/** Terminal theme management.
 *
 * Themes are loaded from a Nix-generated JSON file (ghostty-themes virtual module).
 * The hardcoded DEFAULT_THEME is always available as a fallback.
 */

import type { ITheme } from "ghostty-web";
import availableThemesJson from "ghostty-themes";

export interface NamedTheme {
  name: string;
  theme: ITheme;
}

export const FONT_FAMILY = '"FiraCode Nerd Font", monospace';

export const DEFAULT_THEME_NAME = "Tomorrow Night";

/** Hardcoded default theme (Tomorrow Night variant). */
export const DEFAULT_THEME: ITheme = {
  foreground: "#ffffff",
  background: "#292c33",
  cursor: "#ffffff",
  cursorAccent: "#363a43",
  selectionBackground: "#44475a",
  selectionForeground: "#c5c8c6",
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

/** All available themes: Nix-generated themes + hardcoded default. */
export const availableThemes: NamedTheme[] = [
  { name: DEFAULT_THEME_NAME, theme: DEFAULT_THEME },
  ...availableThemesJson.filter((t) => t.name !== DEFAULT_THEME_NAME),
];

/** Look up a theme by name, falling back to DEFAULT_THEME. */
export function getThemeByName(name: string | undefined): ITheme {
  if (!name || name === DEFAULT_THEME_NAME) return DEFAULT_THEME;
  return (
    availableThemesJson.find((t) => t.name === name)?.theme ?? DEFAULT_THEME
  );
}

/** Parse "#rrggbb" to [r, g, b]. */
function parseHex(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Relative luminance (sRGB). Values > 0.5 are perceptually "light". */
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Lighten or darken a hex color by a factor (positive = lighten, negative = darken). */
function adjustColor(hex: string, factor: number): string {
  const [r, g, b] = parseHex(hex);
  const adjust = (c: number) => {
    if (factor > 0) return Math.round(c + (255 - c) * factor);
    return Math.round(c * (1 + factor));
  };
  return `#${[adjust(r), adjust(g), adjust(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** Chrome colors derived from a terminal theme for consistent app UI. */
export interface ChromeColors {
  /** App background (slightly offset from terminal bg). */
  bg: string;
  /** Chrome surfaces (header, sidebar). */
  surface: string;
  /** Borders between chrome elements. */
  border: string;
  /** Primary text on chrome surfaces. */
  text: string;
  /** Muted text (status indicators, secondary labels). */
  textMuted: string;
  /** Hover state for chrome buttons. */
  hoverBg: string;
  /** Active/selected state background. */
  activeBg: string;
}

/** Derive app chrome colors from the active terminal theme. */
export function getChromeColors(theme: ITheme): ChromeColors {
  const bg = theme.background ?? "#292c33";
  const fg = theme.foreground ?? "#ffffff";
  const isLight = luminance(bg) > 0.2;

  if (isLight) {
    return {
      bg: adjustColor(bg, -0.08),
      surface: adjustColor(bg, -0.04),
      border: adjustColor(bg, -0.15),
      text: fg,
      textMuted: adjustColor(fg, 0.4),
      hoverBg: adjustColor(bg, -0.1),
      activeBg: adjustColor(bg, -0.15),
    };
  }
  return {
    bg: adjustColor(bg, -0.3),
    surface: adjustColor(bg, -0.15),
    border: adjustColor(bg, 0.15),
    text: fg,
    textMuted: adjustColor(fg, -0.4),
    hoverBg: adjustColor(bg, 0.1),
    activeBg: adjustColor(bg, 0.2),
  };
}
