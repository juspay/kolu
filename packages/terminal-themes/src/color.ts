/** RGB color parsing — single owner of "string → {r,g,b}" conversion.
 *
 *  Returns `Result<RGB, ColorParseError>` so callers must handle the
 *  bad-input case explicitly. Supports `#rrggbb`, `#rgb`, and
 *  `rgb(r, g, b)` — anything else is an error, not a silent zero. */

import { err, ok, type Result } from "neverthrow";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export type ColorParseError = { kind: "bad-color"; input: string };

/** Parse `#rgb` or `#rrggbb` (case-insensitive, optional `#`). */
export function parseHexColor(input: string): Result<RGB, ColorParseError> {
  const m = input.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return err({ kind: "bad-color", input });
  // Group 1 is required by the alternation. The destructure with explicit
  // tuple type is the one localized cast — every consumer reads `hex` as
  // `string` without nullability.
  const [, hex] = m as unknown as [string, string];
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
  const m = input.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!m) return err({ kind: "bad-color", input });
  const [, r, g, b] = m as unknown as [string, string, string, string];
  return ok({ r: +r, g: +g, b: +b });
}

/** Parse either `#hex` or `rgb(...)` form — first one to match wins. */
export function parseColor(input: string): Result<RGB, ColorParseError> {
  return parseHexColor(input).orElse(() => parseRgbColor(input));
}
