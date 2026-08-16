/** Styled runs parsed from official FORMAT_VT — the tile's paint source. */

export type ColorRef =
  | { kind: "default" }
  | { kind: "palette"; index: number }
  | { kind: "rgb"; r: number; g: number; b: number };

export interface CellStyle {
  fg: ColorRef;
  bg: ColorRef;
  bold: boolean;
  italic: boolean;
  faint: boolean;
  inverse: boolean;
  underline: boolean;
}

export interface StyledRun {
  text: string;
  cols: number;
  style: CellStyle;
}

export interface StyledLine {
  runs: StyledRun[];
}

export interface ThemePalette {
  foreground?: string;
  background?: string;
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

const NAMED: readonly (keyof ThemePalette)[] = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];

/** xterm's 16-color table — used only when a theme omits that named slot. */
const XTERM16 = [
  "#000000",
  "#cd0000",
  "#00cd00",
  "#cdcd00",
  "#0000ee",
  "#cd00cd",
  "#00cdcd",
  "#e5e5e5",
  "#7f7f7f",
  "#ff0000",
  "#00ff00",
  "#ffff00",
  "#5c5cff",
  "#ff00ff",
  "#00ffff",
  "#ffffff",
] as const;

export function defaultStyle(): CellStyle {
  return {
    fg: { kind: "default" },
    bg: { kind: "default" },
    bold: false,
    italic: false,
    faint: false,
    inverse: false,
    underline: false,
  };
}

export function lineText(line: StyledLine): string {
  let out = "";
  for (const run of line.runs) out += run.text;
  return out;
}

/** Display columns of a visual row (sum of run widths). */
export function lineCols(line: StyledLine): number {
  let n = 0;
  for (const run of line.runs) n += run.cols;
  return n;
}

/** True when `lines[index]` is a hard-wrap continuation of the previous row.
 *  Matches xterm's `IBufferLine.isWrapped` so e2e buffer reads can rejoin. */
export function lineContinuesPrevious(
  lines: readonly StyledLine[],
  index: number,
  cols: number,
): boolean {
  if (index <= 0) return false;
  const prev = lines[index - 1];
  return prev !== undefined && lineCols(prev) >= cols;
}

export function resolveColor(
  ref: ColorRef,
  theme: ThemePalette,
  role: "fg" | "bg",
): string {
  if (ref.kind === "default") {
    return role === "fg"
      ? (theme.foreground ?? "#dddddd")
      : (theme.background ?? "#000000");
  }
  if (ref.kind === "rgb") return `rgb(${ref.r},${ref.g},${ref.b})`;
  const i = ref.index;
  if (i < 16) {
    const key = NAMED[i];
    const named = key !== undefined ? theme[key] : undefined;
    return named ?? XTERM16[i] ?? "#dddddd";
  }
  if (i < 232) {
    const n = i - 16;
    const r = Math.floor(n / 36);
    const g = Math.floor((n % 36) / 6);
    const b = n % 6;
    const v = (c: number) => (c === 0 ? 0 : 55 + c * 40);
    return `rgb(${v(r)},${v(g)},${v(b)})`;
  }
  const gray = 8 + (i - 232) * 10;
  return `rgb(${gray},${gray},${gray})`;
}

export type CodepointWidth = (cp: number) => number;

function measureCols(text: string, width: CodepointWidth): number {
  let cols = 0;
  for (const ch of text) {
    const w = width(ch.codePointAt(0) ?? 0);
    if (w > 0) cols += w;
  }
  return cols;
}

function applySgr(style: CellStyle, raw: string): void {
  const parts =
    raw.length === 0
      ? [0]
      : raw.split(";").map((s) => (s.length === 0 ? 0 : Number(s)));
  for (let i = 0; i < parts.length; i++) {
    const n = parts[i] ?? 0;
    if (n === 0) {
      Object.assign(style, defaultStyle());
      continue;
    }
    if (n === 1) {
      style.bold = true;
      continue;
    }
    if (n === 2) {
      style.faint = true;
      continue;
    }
    if (n === 3) {
      style.italic = true;
      continue;
    }
    if (n === 4) {
      style.underline = true;
      continue;
    }
    if (n === 7) {
      style.inverse = true;
      continue;
    }
    if (n === 22) {
      style.bold = false;
      style.faint = false;
      continue;
    }
    if (n === 23) {
      style.italic = false;
      continue;
    }
    if (n === 24) {
      style.underline = false;
      continue;
    }
    if (n === 27) {
      style.inverse = false;
      continue;
    }
    if (n === 39) {
      style.fg = { kind: "default" };
      continue;
    }
    if (n === 49) {
      style.bg = { kind: "default" };
      continue;
    }
    if (n >= 30 && n <= 37) {
      style.fg = { kind: "palette", index: n - 30 };
      continue;
    }
    if (n >= 40 && n <= 47) {
      style.bg = { kind: "palette", index: n - 40 };
      continue;
    }
    if (n >= 90 && n <= 97) {
      style.fg = { kind: "palette", index: n - 90 + 8 };
      continue;
    }
    if (n >= 100 && n <= 107) {
      style.bg = { kind: "palette", index: n - 100 + 8 };
      continue;
    }
    if (n === 38 || n === 48) {
      const dest = n === 38 ? "fg" : "bg";
      const mode = parts[++i];
      if (mode === 5) {
        const index = parts[++i] ?? 0;
        style[dest] = { kind: "palette", index };
      } else if (mode === 2) {
        const r = parts[++i] ?? 0;
        const g = parts[++i] ?? 0;
        const b = parts[++i] ?? 0;
        style[dest] = { kind: "rgb", r, g, b };
      }
    }
  }
}

function skipOsc(vt: string, from: number): number {
  for (let i = from; i < vt.length; i++) {
    const c = vt.charCodeAt(i);
    if (c === 0x07) return i + 1;
    if (c === 0x1b && vt.charCodeAt(i + 1) === 0x5c) return i + 2;
  }
  return vt.length;
}

/** Parse Ghostty FORMAT_VT into column-aligned styled runs. */
export function parseVtStyled(vt: string, width: CodepointWidth): StyledLine[] {
  const lines: StyledLine[] = [];
  const style = defaultStyle();
  let runs: StyledRun[] = [];
  let buf = "";

  const flush = (): void => {
    if (buf.length === 0) return;
    runs.push({
      text: buf,
      cols: measureCols(buf, width),
      style: { ...style, fg: { ...style.fg }, bg: { ...style.bg } },
    });
    buf = "";
  };
  const endLine = (): void => {
    flush();
    lines.push({ runs });
    runs = [];
  };

  let i = 0;
  while (i < vt.length) {
    const c = vt.charCodeAt(i);
    if (c === 0x0a) {
      endLine();
      i++;
      continue;
    }
    if (c === 0x0d) {
      i++;
      continue;
    }
    if (c === 0x1b) {
      const next = vt.charCodeAt(i + 1);
      if (next === 0x5b) {
        const rest = vt.slice(i + 2);
        const m = /^([0-9;]*)([A-Za-z])/.exec(rest);
        if (m) {
          i += 2 + m[0].length;
          if (m[2] === "m") {
            flush();
            applySgr(style, m[1] ?? "");
          }
          continue;
        }
      }
      if (next === 0x5d) {
        i = skipOsc(vt, i + 2);
        continue;
      }
      i++;
      continue;
    }
    buf += vt[i];
    i++;
  }
  flush();
  if (runs.length > 0 || lines.length === 0) lines.push({ runs });
  return lines;
}
