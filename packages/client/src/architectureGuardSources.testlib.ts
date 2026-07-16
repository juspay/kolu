/**
 * Shared source enumerator for the architectural GUARD tests
 * (`procedureCastGuard`, `canvasBoundaryGuard`, `standingSubscriptionOwnership`).
 *
 * Each guard scans the `packages/client/src` tree (or a sub-target) for a
 * forbidden pattern; they only differ in WHAT they scan for, not in HOW they
 * enumerate files. Keeping the walk in ONE place means a future change to the
 * enumeration (a new ignore, a filename-filter tweak) lands once instead of
 * drifting across three near-identical copies.
 */

import { globSync, statSync } from "node:fs";
import { join } from "node:path";

/** A non-test `.ts`/`.tsx` SOURCE file — not `*.test.ts` / `*.test-d.ts` /
 *  `*.test.tsx`. */
const isSourceFile = (p: string): boolean =>
  /\.tsx?$/.test(p) && !/\.test(-d)?\.tsx?$/.test(p);

/** Every non-test `.ts`/`.tsx` source file under a target — a directory subtree
 *  OR a single file. Test files and `node_modules` are excluded; a non-source or
 *  excluded single-file target yields `[]`. The directory walk uses Node's own
 *  focused `fs.globSync` rather than a hand-rolled `readdirSync` recursion. */
export function listGuardSourceFiles(target: string): string[] {
  // A single-file target (e.g. canvasBoundaryGuard's `useViewState.ts`).
  if (!statSync(target).isDirectory())
    return isSourceFile(target) ? [target] : [];
  return globSync("**/*.{ts,tsx}", {
    cwd: target,
    exclude: (p) => p.includes("node_modules"),
  })
    .filter(isSourceFile)
    .map((rel) => join(target, rel));
}

/** Blank every `//`-line and `/* … *​/`-block COMMENT body with spaces (newlines and
 *  byte offsets preserved), leaving STRING bodies intact — a guard scans CODE, not the
 *  prose in a docstring narrating a `.use(...)` / `createRoot(...)` shape. It is a
 *  string-aware char lexer (honours escapes and the three quote kinds), so a `//` inside
 *  a string (`wire.ts`'s `${protocol}//${host}` ws URL) is NOT mistaken for a comment and
 *  a `//` opening a real trailing comment IS blanked. Shared by every guard that must
 *  ignore commented-out or narrated patterns (was duplicated as `blankComments` /
 *  `stripComments` in two adjacent guard tests). */
export function stripComments(text: string): string {
  const out = text.split("");
  let state: "code" | "line" | "block" | "'" | '"' | "`" = "code";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (state === "code") {
      if (c === "/" && n === "/") state = "line";
      else if (c === "/" && n === "*") state = "block";
      else if (c === "'" || c === '"' || c === "`") state = c;
      if (state === "line" || state === "block") {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
      }
      continue;
    }
    if (state === "line") {
      if (c === "\n") state = "code";
      else out[i] = " ";
      continue;
    }
    if (state === "block") {
      if (c === "*" && n === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i++;
        state = "code";
      } else if (c !== "\n") out[i] = " ";
      continue;
    }
    // Inside a string literal — leave bytes intact; honour escapes and the closer.
    if (c === "\\") i++;
    else if (c === state) state = "code";
  }
  return out.join("");
}
