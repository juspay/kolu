export interface TileTheme {
  bg: string;
  fg: string;
}

export function tileTitleBarBg(theme: TileTheme): string {
  return `color-mix(in oklch, ${theme.fg} 8%, ${theme.bg})`;
}

export function tileTitleBarBorder(theme: TileTheme): string {
  return `color-mix(in oklch, ${theme.fg} 12%, ${theme.bg})`;
}

export function tileFgTier(theme: TileTheme, level: 1 | 2 | 3): string {
  if (level === 1) return theme.fg;
  const pct = level === 2 ? 75 : 55;
  return `color-mix(in oklch, ${theme.fg} ${pct}%, ${theme.bg})`;
}

export function tileChromeButton(theme: TileTheme): string {
  return `color-mix(in oklch, ${theme.fg} 50%, ${theme.bg})`;
}
