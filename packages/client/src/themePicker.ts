/** Theme picker — choose a theme whose background is perceptually distinct
 *  from already-in-use backgrounds, or shuffle to a random one.
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

/** Filter candidates to those with parseable, in-gamut backgrounds.
 *  Falls back to the full list when filtering leaves nothing. */
function filterEligible(
  candidates: NamedTheme[],
  excludeBgs?: Set<string>,
): NamedTheme[] {
  const eligible = candidates.filter((t) => {
    const bg = t.theme.background;
    if (!bg) return false;
    if (excludeBgs?.has(bg)) return false;
    const lab = getLab(bg);
    return lab !== undefined && chroma(lab) <= MAX_CANDIDATE_CHROMA;
  });
  return eligible.length > 0 ? eligible : candidates;
}

/** Candidates within this OkLab distance of the best score are all eligible
 *  for the random pick. Widens the tie pool so spread picks are
 *  nondeterministic — different `rand` values yield different themes even
 *  when there's a single strict argmax winner. Tuned so ~3-6 themes
 *  typically land in the band on the ghostty catalog. */
const SCORE_TOLERANCE = 0.02;

/** Pick the candidate whose background is farthest from `peerBgs`, with a
 *  tolerance band so near-best candidates also compete. */
function pickSpread(
  candidates: NamedTheme[],
  peerBgs: string[],
  rand: () => number,
): string {
  const pool = filterEligible(candidates);
  const peerLabs: OkLab[] = [];
  for (const hex of peerBgs) {
    const lab = getLab(hex);
    if (lab) peerLabs.push(lab);
  }
  if (peerLabs.length === 0) {
    return pool[Math.floor(rand() * pool.length)]!.name;
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
  for (let i = 0; i < scores.length; i++) {
    if (scores[i]! >= threshold) band.push(i);
  }
  const pickIdx = band[Math.floor(rand() * band.length)] ?? 0;
  return pool[pickIdx]!.name;
}

/** Pick uniformly at random, excluding `excludeBgs`. */
function pickShuffle(
  candidates: NamedTheme[],
  excludeBgs: string[],
  rand: () => number,
): string {
  const pool = filterEligible(candidates, new Set(excludeBgs));
  return pool[Math.floor(rand() * pool.length)]!.name;
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
 * above {@link MAX_CANDIDATE_CHROMA}, falling back to the full list when
 * filtering leaves nothing.
 */
export function pickTheme(
  candidates: NamedTheme[],
  config:
    | { spread: true; peerBgs: string[]; rand?: () => number }
    | { spread?: false; excludeBgs: string[]; rand?: () => number },
): string {
  if (candidates.length === 0) {
    throw new Error("pickTheme: no candidates");
  }
  const rand = config.rand ?? Math.random;
  if (config.spread) {
    return pickSpread(candidates, config.peerBgs, rand);
  }
  return pickShuffle(candidates, config.excludeBgs, rand);
}
