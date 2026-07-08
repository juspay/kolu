/**
 * REGRESSION PIN (the ownerless-standing-subscription class): a bare module-const
 * `.use()` on a surface cell/collection/stream/event — with NO ambient Solid owner —
 * is the "ownerless" path `@kolu/surface`'s `createKeyedSubscriptionCache` documents:
 * it acquires the shared subscription slot and releases it in the SAME tick, netting
 * the listener count to zero, so the underlying subscription tears down a MICROTASK
 * later — long before the first real (network) value can land. Every reader then sees
 * the honest-unknown default FOREVER: the exact "padi status unknown / build commit —
 * / memory unavailable" symptom this fix retired (`useMemoryUsage.ts`,
 * `useProcessUptime.ts`, `useDaemonInventory.ts`, `useDaemonStatus.ts`'s `padiLinkSub`
 * were all bare module-const `.use()` calls with no owning root).
 *
 * The fix is an app-lifetime `createRoot(() => X.cells.Y.use(...))` wrapper (the idiom
 * `useDaemonStatus.ts`'s `sub` / `useHostInventory.ts`'s `sub` already used correctly).
 * This is a GREP-BASED scan (not a full static analyzer — a plain text heuristic is
 * enough to catch the class, per the fix's own charter), so a FUTURE hook that opens a
 * new standing `.use()` at module scope without an owning `createRoot` fails this test
 * instead of silently freezing at "unknown" for a whole session.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every non-test `.ts`/`.tsx` source file under `packages/client/src`. */
function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.test(-d)?\.tsx?$/.test(name)) continue; // tests, incl. type-only .test-d.ts
    out.push(full);
  }
  return out;
}

/** A surface `.use()` call site the base client's ref-counted cache dedups — a cell,
 *  a whole collection, a stream, an event, or the map's `entries` collection. */
const STANDING_USE_RE =
  /\.(cells|collections|streams|events|entries)(\.\w+)?\.use\(/;

/** Blank out comments (preserving line numbers, so reported line numbers stay
 *  accurate) before scanning — a PROSE comment that mentions a call shape (e.g.
 *  `wire.ts`'s own JSDoc narrating `app.cells.preferences.use(...)`) must never be
 *  mistaken for a real call site. Strips `/* ... *\/` block comments (incl. JSDoc) and
 *  full-line `//` comments (this codebase's overwhelming comment style); deliberately
 *  leaves a trailing `// ...` after real code alone, so a template literal that
 *  legitimately contains a bare `//` (e.g. `wire.ts`'s `${protocol}//${host}` ws URL)
 *  is never corrupted. */
function stripComments(src: string): string {
  const blank = (s: string): string => s.replace(/[^\n]/g, " ");
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/^[ \t]*\/\/[^\n]*/gm, blank);
}

/** How far past a module-top-level `const NAME = ` to look for BOTH a standing `.use()`
 *  call and an owning `createRoot(` — comfortably wider than the real (2-6 line)
 *  pattern, narrow enough not to accidentally absorb a later, unrelated statement. */
const STATEMENT_WINDOW = 600;

/** Every module-TOP-LEVEL (column-0) `const NAME = <standing .use() call>` site with no
 *  `createRoot(` wrapping it, as `"<file>:<line>"` strings. Column-0 `const` is this
 *  biome-formatted tree's actual signal for "module scope" (an indented `const` is
 *  inside a function/component, which has its own reactive owner already). */
function findUnownedStandingSubscriptions(): string[] {
  const violations: string[] = [];
  for (const file of listSourceFiles(SRC_ROOT)) {
    const text = stripComments(readFileSync(file, "utf8"));
    const topLevelConst = /^const\s+\w+\s*=\s*/gm;
    const starts: number[] = [];
    let m: RegExpExecArray | null = topLevelConst.exec(text);
    while (m !== null) {
      starts.push(m.index);
      m = topLevelConst.exec(text);
    }
    for (const [i, start] of starts.entries()) {
      const nextConst = starts[i + 1] ?? text.length;
      const windowEnd = Math.min(start + STATEMENT_WINDOW, nextConst);
      const stmt = text.slice(start, windowEnd);
      if (!STANDING_USE_RE.test(stmt)) continue; // not a standing-subscription const
      if (stmt.includes("createRoot(")) continue; // owned — fine
      const line = text.slice(0, start).split("\n").length;
      violations.push(`${file.replace(`${SRC_ROOT}/`, "")}:${line}`);
    }
  }
  return violations;
}

describe("standing-subscription ownership — no bare module-const `.use()` (the ownerless-subscription class)", () => {
  it("every module-top-level cell/collection/stream/event/entries `.use()` is wrapped in an app-lifetime `createRoot` — never an ownerless call the base client's ref-counted cache tears down a microtask after load", () => {
    expect(findUnownedStandingSubscriptions()).toEqual([]);
  });
});
