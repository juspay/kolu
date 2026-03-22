/** Named terminal themes. Each theme satisfies ghostty-web's ITheme. */

import type { ITheme } from "ghostty-web";
import { createSignal } from "solid-js";

export interface NamedTheme {
  name: string;
  theme: ITheme;
}

const THEMES: NamedTheme[] = [
  {
    name: "Atom One Dark",
    theme: {
      foreground: "#abb2bf",
      background: "#21252b",
      cursor: "#abb2bf",
      cursorAccent: "#21252b",
      selectionBackground: "#323844",
      selectionForeground: "#abb2bf",
      black: "#21252b",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#767676",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#abb2bf",
    },
  },
  {
    name: "Catppuccin Mocha",
    theme: {
      foreground: "#cdd6f4",
      background: "#1e1e2e",
      cursor: "#f5e0dc",
      cursorAccent: "#1e1e2e",
      selectionBackground: "#585b70",
      selectionForeground: "#cdd6f4",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#a6adc8",
      brightBlack: "#585b70",
      brightRed: "#f37799",
      brightGreen: "#89d88b",
      brightYellow: "#ebd391",
      brightBlue: "#74a8fc",
      brightMagenta: "#f2aede",
      brightCyan: "#6bd7ca",
      brightWhite: "#bac2de",
    },
  },
  {
    name: "Dracula",
    theme: {
      foreground: "#f8f8f2",
      background: "#282a36",
      cursor: "#f8f8f2",
      cursorAccent: "#282a36",
      selectionBackground: "#44475a",
      selectionForeground: "#ffffff",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    name: "Gruvbox Dark",
    theme: {
      foreground: "#ebdbb2",
      background: "#282828",
      cursor: "#ebdbb2",
      cursorAccent: "#282828",
      selectionBackground: "#665c54",
      selectionForeground: "#ebdbb2",
      black: "#282828",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightBlack: "#928374",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
  },
  {
    name: "Nord",
    theme: {
      foreground: "#d8dee9",
      background: "#2e3440",
      cursor: "#eceff4",
      cursorAccent: "#2e3440",
      selectionBackground: "#434c5e",
      selectionForeground: "#eceff4",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#596377",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  {
    name: "Rose Pine",
    theme: {
      foreground: "#e0def4",
      background: "#191724",
      cursor: "#e0def4",
      cursorAccent: "#191724",
      selectionBackground: "#403d52",
      selectionForeground: "#e0def4",
      black: "#26233a",
      red: "#eb6f92",
      green: "#31748f",
      yellow: "#f6c177",
      blue: "#9ccfd8",
      magenta: "#c4a7e7",
      cyan: "#ebbcba",
      white: "#e0def4",
      brightBlack: "#6e6a86",
      brightRed: "#eb6f92",
      brightGreen: "#31748f",
      brightYellow: "#f6c177",
      brightBlue: "#9ccfd8",
      brightMagenta: "#c4a7e7",
      brightCyan: "#ebbcba",
      brightWhite: "#e0def4",
    },
  },
  {
    name: "Tokyo Night",
    theme: {
      foreground: "#c0caf5",
      background: "#1a1b26",
      cursor: "#c0caf5",
      cursorAccent: "#15161e",
      selectionBackground: "#33467c",
      selectionForeground: "#c0caf5",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#414868",
      brightRed: "#f7768e",
      brightGreen: "#9ece6a",
      brightYellow: "#e0af68",
      brightBlue: "#7aa2f7",
      brightMagenta: "#bb9af7",
      brightCyan: "#7dcfff",
      brightWhite: "#c0caf5",
    },
  },
  {
    name: "Solarized Dark",
    theme: {
      foreground: "#839496",
      background: "#002b36",
      cursor: "#839496",
      cursorAccent: "#002b36",
      selectionBackground: "#073642",
      selectionForeground: "#93a1a1",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
];

export default THEMES;

const THEME_KEY = "kolu-theme";
const DEFAULT_THEME = "Catppuccin Mocha";

function loadTheme(): NamedTheme {
  const saved = localStorage.getItem(THEME_KEY);
  return (
    THEMES.find((t) => t.name === saved) ??
    THEMES.find((t) => t.name === DEFAULT_THEME)!
  );
}

const [currentTheme, setCurrentThemeRaw] =
  createSignal<NamedTheme>(loadTheme());

export function setCurrentTheme(named: NamedTheme) {
  localStorage.setItem(THEME_KEY, named.name);
  setCurrentThemeRaw(named);
}

export { currentTheme };
