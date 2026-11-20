import { type NonEmpty, nonEmpty } from "nonempty";
import type { NamedTheme } from "./theme.ts";

interface OkLab {
  L: number;
  a: number;
  b: number;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Parse `#rgb` / `#rrggbb` into OkLab. Returns `undefined` for any other
 *  input (hex with alpha, named colours, etc.) — the caller treats an
 *  unparseable bg as "not a candidate for distance comparisons". */
export function hexToOkLab(hex: string): OkLab | undefined {
  const m = hex.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return undefined;
  const [, s] = m as unknown as [string, string];
  const full = s.length === 3 ? [...s].map((c) => c + c).join("") : s;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const l_ = Math.cbrt(
    0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl,
  );
  const m_ = Math.cbrt(
    0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl,
  );
  const s_ = Math.cbrt(
    0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl,
  );
  return {
    L: 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  };
}

const labCache = new Map<string, OkLab | undefined>();
function getLab(hex: string): OkLab | undefined {
  if (labCache.has(hex)) return labCache.get(hex);
  const computed = hexToOkLab(hex);
  labCache.set(hex, computed);
  return computed;
}

const DARK_L_MAX = 0.5;

function labFamily(lab: OkLab): "light" | "dark" {
  return lab.L < DARK_L_MAX ? "dark" : "light";
}

/** Classify a theme as `"light"` / `"dark"` by its background luminance, or
 *  `undefined` when the background is missing / unparseable. Used to restrict
 *  the picker's candidate pool to one luminance family (see `pickTheme`'s
 *  `mode` option). Exported for the test suite. */
export function themeMode(t: NamedTheme): "light" | "dark" | undefined {
  const bg = t.theme.background;
  const lab = bg ? getLab(bg) : undefined;
  return lab ? labFamily(lab) : undefined;
}

const L_DOWNWEIGHT = 3;

const MAX_CANDIDATE_CHROMA = 0.08;

const MIN_COLOURFUL_CHROMA = 0.02;

function chroma(lab: OkLab): number {
  return Math.sqrt(lab.a * lab.a + lab.b * lab.b);
}

/** True when the theme's background has enough chroma to count as "colourful"
 *  (not grey). Garish ceilings stay on the quality gate only — this is the
 *  floor. Exported for the test suite. */
export function themeColourful(t: NamedTheme): boolean {
  const bg = t.theme.background;
  const lab = bg ? getLab(bg) : undefined;
  if (!lab) return false;
  return chroma(lab) >= MIN_COLOURFUL_CHROMA;
}

/** Pool filter passed to {@link pickTheme}. */
export type ThemePickMode = "light" | "dark" | "colourful";

/** Anisotropic OkLab distance — luminance is scaled down so the picker
 *  prefers hue spread over luminance swaps. Exported for the test suite. */
export function okLabDistance(x: OkLab, y: OkLab): number {
  const dL = (x.L - y.L) / L_DOWNWEIGHT;
  const da = x.a - y.a;
  const db = x.b - y.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/** Choose the candidate pool, relaxing constraints in priority order so an
 *  exhausted request never silently reintroduces a *worse* theme than the one
 *  constraint it couldn't satisfy. The quality gate (parseable, in-gamut — not
 *  garish) is ALWAYS required; distinctness (`excludeBgs`) is kept longer than
 *  the pool `mode` (light/dark/colourful), which is dropped first. So a
 *  `mode: "dark"` request that runs out of dark themes yields a *light* theme
 *  (family relaxed) before it would ever yield a garish or duplicate one —
 *  never all constraints at once. Only a degenerate catalogue with no
 *  in-gamut theme falls through to the raw list, preserving the non-emptiness
 *  type guarantee. The `??` chain short-circuits, so the common (non-empty)
 *  case runs just the first filter. */
function filterEligible(
  candidates: NonEmpty<NamedTheme>,
  excludeBgs?: Set<string>,
  mode?: ThemePickMode,
): NonEmpty<NamedTheme> {
  // Quality gate — never relaxed except in a degenerate catalogue.
  const quality = candidates.filter((t) => {
    const bg = t.theme.background;
    if (!bg) return false;
    const lab = getLab(bg);
    return lab !== undefined && chroma(lab) <= MAX_CANDIDATE_CHROMA;
  });
  const inMode = (t: NamedTheme): boolean => {
    if (!mode) return true;
    switch (mode) {
      case "colourful":
        return themeColourful(t);
      case "light":
      case "dark":
        return themeMode(t) === mode;
      default: {
        const _exhaustive: never = mode;
        return _exhaustive;
      }
    }
  };
  const notExcluded = (t: NamedTheme): boolean =>
    !excludeBgs?.has(t.theme.background ?? "");
  return (
    nonEmpty(quality.filter((t) => notExcluded(t) && inMode(t))) ??
    nonEmpty(quality.filter(notExcluded)) ??
    nonEmpty(quality) ??
    candidates
  );
}

const SCORE_TOLERANCE = 0.02;

function pickSpread(
  candidates: NonEmpty<NamedTheme>,
  peerBgs: string[],
  rand: () => number,
  mode?: ThemePickMode,
): string {
  const pool = filterEligible(candidates, undefined, mode);
  const peerLabs: OkLab[] = [];
  for (const hex of peerBgs) {
    const lab = getLab(hex);
    if (lab) peerLabs.push(lab);
  }
  if (peerLabs.length === 0) {
    const idx = Math.floor(rand() * pool.length);
    return (pool[idx] ?? pool[0]).name;
  }
  const scores: number[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const t of pool) {
    const bg = t.theme.background;
    const lab = bg ? getLab(bg) : undefined;
    let score: number;
    if (!lab) {
      score = Number.NEGATIVE_INFINITY;
    } else {
      let min = Number.POSITIVE_INFINITY;
      for (const u of peerLabs) {
        const d = okLabDistance(lab, u);
        if (d < min) min = d;
      }
      score = min;
    }
    scores.push(score);
    if (score > bestScore) bestScore = score;
  }
  const threshold = bestScore - SCORE_TOLERANCE;
  const band: number[] = [];
  for (const [i, score] of scores.entries()) {
    if (score >= threshold) band.push(i);
  }
  const pickIdx = band[Math.floor(rand() * band.length)] ?? 0;
  return (pool[pickIdx] ?? pool[0]).name;
}

function pickShuffle(
  candidates: NonEmpty<NamedTheme>,
  excludeBgs: string[],
  rand: () => number,
  mode?: ThemePickMode,
): string {
  const pool = filterEligible(candidates, new Set(excludeBgs), mode);
  const idx = Math.floor(rand() * pool.length);
  return (pool[idx] ?? pool[0]).name;
}

/**
 * Unified theme picker.
 *
 * - `{ spread: true, peerBgs }` — pick a theme whose background is
 *   maximally distinct from `peerBgs` (with a tolerance band for
 *   nondeterminism). Use for new-terminal creation.
 * - `{ excludeBgs }` — pick uniformly at random, excluding `excludeBgs`.
 *   Use for user-triggered ⌘J shuffle.
 *
 * Both modes reject candidates with unparseable backgrounds or chroma
 * above {@link MAX_CANDIDATE_CHROMA}, and — when `mode` is set — restrict the
 * pool to that light/dark family or to colourful (saturated) tints, falling
 * back to the quality-gated list when the mode filter leaves nothing.
 *
 * Caller must pass a non-empty candidates list — empty is a compile error.
 */
export function pickTheme(
  candidates: NonEmpty<NamedTheme>,
  config:
    | {
        spread: true;
        peerBgs: string[];
        rand?: () => number;
        mode?: ThemePickMode;
      }
    | {
        spread?: false;
        excludeBgs: string[];
        rand?: () => number;
        mode?: ThemePickMode;
      },
): string {
  const rand = config.rand ?? Math.random;
  if (config.spread) {
    return pickSpread(candidates, config.peerBgs, rand, config.mode);
  }
  return pickShuffle(candidates, config.excludeBgs, rand, config.mode);
}
