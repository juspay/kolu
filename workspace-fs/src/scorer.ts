/**
 * Fuzzy file-path scorer — matches query characters in order against
 * a file path, rewarding word boundaries, consecutive runs, and exact
 * prefixes. Returns null for non-matches.
 *
 * Inspired by VS Code's fuzzyScorer but stripped to essentials.
 */

export interface FuzzyResult {
  score: number;
  /** Indices into the target string that matched. */
  matches: number[];
}

// Bonus weights
const BONUS_CONSECUTIVE = 5;
const BONUS_WORD_START = 8;
const BONUS_CAMEL = 4;
const BONUS_FIRST_CHAR = 10;
const PENALTY_GAP = -1;

function isSeparator(ch: string): boolean {
  return ch === "/" || ch === "\\" || ch === "." || ch === "-" || ch === "_";
}

function isUpperCase(ch: string): boolean {
  return ch >= "A" && ch <= "Z";
}

function isWordStart(target: string, i: number): boolean {
  if (i === 0) return true;
  const prev = target[i - 1]!;
  if (isSeparator(prev)) return true;
  // camelCase boundary
  if (isUpperCase(target[i]!) && !isUpperCase(prev)) return true;
  return false;
}

/**
 * Score a query against a target path. Returns null if the query
 * doesn't match (not all characters found in order).
 */
export function fuzzyScore(query: string, target: string): FuzzyResult | null {
  const qLower = query.toLowerCase();
  const tLower = target.toLowerCase();
  const qLen = qLower.length;
  const tLen = tLower.length;

  if (qLen === 0) return { score: 0, matches: [] };
  if (qLen > tLen) return null;

  // Quick check: all query chars exist in target (in order)
  let qi = 0;
  for (let ti = 0; ti < tLen && qi < qLen; ti++) {
    if (tLower[ti] === qLower[qi]) qi++;
  }
  if (qi < qLen) return null;

  // Greedy forward pass with best-match heuristic:
  // prefer word-start positions over mid-word matches.
  const matches: number[] = [];
  qi = 0;
  let score = 0;
  let lastMatch = -1;

  for (let ti = 0; ti < tLen && qi < qLen; ti++) {
    if (tLower[ti] !== qLower[qi]) continue;

    // Look ahead: is there a word-start match for this query char?
    if (!isWordStart(target, ti)) {
      let found = false;
      for (let ahead = ti + 1; ahead < tLen; ahead++) {
        if (tLower[ahead] === qLower[qi] && isWordStart(target, ahead)) {
          // Skip to the word-start match
          // Add gap penalty for skipped chars
          score += (ahead - ti - 1) * PENALTY_GAP;
          ti = ahead;
          found = true;
          break;
        }
        // Don't look too far ahead — cap at 8 chars
        if (ahead - ti > 8) break;
      }
      if (!found) {
        // Use current position
      }
    }

    matches.push(ti);

    // Scoring
    if (qi === 0 && ti === 0) score += BONUS_FIRST_CHAR;
    if (isWordStart(target, ti)) {
      score += BONUS_WORD_START;
      if (isUpperCase(target[ti]!) && ti > 0 && !isUpperCase(target[ti - 1]!)) {
        score += BONUS_CAMEL;
      }
    }
    if (lastMatch >= 0 && ti === lastMatch + 1) {
      score += BONUS_CONSECUTIVE;
    }
    if (lastMatch >= 0 && ti > lastMatch + 1) {
      score += (ti - lastMatch - 1) * PENALTY_GAP;
    }

    lastMatch = ti;
    qi++;
  }

  if (qi < qLen) return null;

  // Normalize: shorter paths score higher for same match quality
  score -= Math.floor(tLen / 10);

  return { score, matches };
}
