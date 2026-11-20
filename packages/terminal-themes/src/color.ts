import { err, ok, type Result } from "neverthrow";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type ColorParseError = { kind: "bad-color"; input: string };

/** Parse `#rgb` or `#rrggbb` (case-insensitive, optional `#`). */
export function parseHexColor(input: string): Result<RGB, ColorParseError> {
  const hex = input.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)?.[1];
  if (hex === undefined) return err({ kind: "bad-color", input });
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  const n = Number.parseInt(full, 16);
  return ok({
    r: (n >> 16) & 0xff,
    g: (n >> 8) & 0xff,
    b: n & 0xff,
  });
}

/** Parse `rgb(r, g, b)` with whitespace-tolerant separators. */
export function parseRgbColor(input: string): Result<RGB, ColorParseError> {
  const [, r, g, b] = input.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/) ?? [];
  if (r === undefined || g === undefined || b === undefined) {
    return err({ kind: "bad-color", input });
  }
  return ok({ r: +r, g: +g, b: +b });
}

/** Parse either `#hex` or `rgb(...)` form — first one to match wins. */
export function parseColor(input: string): Result<RGB, ColorParseError> {
  return parseHexColor(input).orElse(() => parseRgbColor(input));
}
