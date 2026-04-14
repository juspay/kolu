/** Variegated theme picker — choose a theme whose background is
 *  perceptually distinct from a set of already-in-use backgrounds.
 *
 *  Why this exists: new terminals get an auto-picked theme so the sidebar
 *  ends up with a recognisable colour-per-terminal instead of a sea of
 *  look-alikes. Pure random collides; nearest-neighbour maximisation in
 *  OkLab gives a visibly spread palette.
 *
 *  Kept as a separate module from `theme.ts` so the picker is trivially
 *  unit-testable — `theme.ts` imports the Nix-generated `ghostty-themes`
 *  virtual module, which vitest can't resolve without extra wiring. */

import type { NamedTheme } from "./theme";

interface OkLab {
  L: number;
  a: number;
  b: number;
}

/** sRGB gamma → linear light. */
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Parse `#rgb` / `#rrggbb` into OkLab. Returns `undefined` for any other
 *  input (hex with alpha, named colours, etc.) — the caller treats an
 *  unparseable bg as "not a candidate for distance comparisons". */
export function hexToOkLab(hex: string): OkLab | undefined {
  const m = hex.trim().match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
  if (!m) return undefined;
  const s = m[1]!;
  const full =
    s.length === 3 ? s[0]! + s[0]! + s[1]! + s[1]! + s[2]! + s[2]! : s;
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

// Memoise hex → OkLab. A variegated pick reads every candidate's bg on every
// invocation; across ~300 themes the repeated parse adds up.
const labCache = new Map<string, OkLab | undefined>();
function getLab(hex: string): OkLab | undefined {
  if (labCache.has(hex)) return labCache.get(hex);
  const computed = hexToOkLab(hex);
  labCache.set(hex, computed);
  return computed;
}

/** Luminance is DIVIDED by this factor when computing distance, so
 *  hue/chroma drift matters more than light/dark drift. Bigger factor =
 *  stronger "stay in the same luminance family" preference. Three was
 *  chosen by eye on the ghostty theme set — big enough that a mostly-dark
 *  palette stays mostly dark, small enough that a mid-tone theme can still
 *  win when hue space is saturated. */
const L_DOWNWEIGHT = 3;

/** Reject candidates whose background chroma (saturation in the a,b plane)
 *  exceeds this threshold. The picker maximises distance, so without a cap
 *  it gleefully picks the most extreme bg in colour space — which in the
 *  ghostty catalog means bright yellow / neon green / acid pink. The
 *  threshold (~20 themes excluded out of 485) keeps moderately-saturated
 *  picks like deep blue or rich purple, which read as "interesting" not
 *  "garish". */
const MAX_CANDIDATE_CHROMA = 0.08;

function chroma(lab: OkLab): number {
  return Math.sqrt(lab.a * lab.a + lab.b * lab.b);
}

/** Anisotropic OkLab distance — luminance is scaled down so the picker
 *  prefers hue spread over luminance swaps. Exported for the test suite. */
export function okLabDistance(x: OkLab, y: OkLab): number {
  const dL = (x.L - y.L) / L_DOWNWEIGHT;
  const da = x.a - y.a;
  const db = x.b - y.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

/**
 * Pick a theme whose background is maximally distinct from `usedBgs`.
 *
 * Returns the name of the candidate whose background has the largest
 * min-distance (in anisotropic OkLab) to any background in `usedBgs`.
 * Ties are broken by `rand()`, which must return a value in `[0, 1)`
 * (default `Math.random`).
 *
 * - Empty `candidates` → throws; callers always have the full theme list.
 * - Empty `usedBgs` (or only unparseable hex) → every in-gamut candidate
 *   ties at `+Infinity`; `rand()` picks one.
 * - Candidates without a parseable bg, or with a chroma above
 *   {@link MAX_CANDIDATE_CHROMA}, score `-Infinity` so they only win when
 *   nothing else is available.
 */
export function pickVariegatedTheme(
  candidates: NamedTheme[],
  usedBgs: string[],
  rand: () => number = Math.random,
): string {
  if (candidates.length === 0) {
    throw new Error("pickVariegatedTheme: no candidates");
  }
  const usedLabs: OkLab[] = [];
  for (const hex of usedBgs) {
    const lab = getLab(hex);
    if (lab) usedLabs.push(lab);
  }
  let bestScore = Number.NEGATIVE_INFINITY;
  const bestIdxs: number[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const bg = candidates[i]!.theme.background;
    const lab = bg ? getLab(bg) : undefined;
    let score: number;
    if (!lab || chroma(lab) > MAX_CANDIDATE_CHROMA) {
      score = Number.NEGATIVE_INFINITY;
    } else if (usedLabs.length === 0) {
      score = Number.POSITIVE_INFINITY;
    } else {
      let min = Number.POSITIVE_INFINITY;
      for (const u of usedLabs) {
        const d = okLabDistance(lab, u);
        if (d < min) min = d;
      }
      score = min;
    }
    if (score > bestScore) {
      bestScore = score;
      bestIdxs.length = 0;
      bestIdxs.push(i);
    } else if (score === bestScore) {
      bestIdxs.push(i);
    }
  }
  const pickIdx = bestIdxs[Math.floor(rand() * bestIdxs.length)] ?? 0;
  return candidates[pickIdx]!.name;
}
