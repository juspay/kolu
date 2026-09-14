/**
 * The `Schema.optional` tolerance allowlist — review finding B3.
 *
 * The migration's law for every wire field zod used to `.optional()` is
 * `Schema.optionalKey`: the key is either ABSENT or a real value, and a key
 * present-with-`undefined` is a decode failure. That law is what turned a class
 * of silent shape drift into a loud one.
 *
 * Four fields deliberately break it. Each sits on a path where the value is
 * FORWARDED — through a tap, or across hops of optional-typed records — so the
 * key arrives present-with-`undefined` no matter what discipline the producer
 * keeps, and `optionalKey` would reject a frame the product needs. `optional`
 * is `optionalKey` + `UndefinedOr`, so the emitted BYTES are identical (the key
 * is omitted, never nulled) and the value is still validated; only the
 * tolerance differs.
 *
 * Nothing else can see a fifth one appear. `exactOptionalPropertyTypes` is OFF
 * repo-wide, so `tsc` never objects to writing an optional key as `undefined`;
 * biome is not type-aware; and `Schema.optional(` reads exactly like the
 * `Schema.optionalKey(` beside it. The three present-undefined bugs this
 * campaign hit were each found by an e2e failure or a daemon crash — never by a
 * gate.
 *
 * Turning `exactOptionalPropertyTypes` on is measured rather than assumed, and
 * the measurement was RE-TAKEN when the grafted `osfacts-client` went
 * Effect-native: **922 errors across 36 of kolu's own packages — 249 distinct
 * files, 490 distinct errors** once the same file reported by several packages
 * is counted once. The earlier reading rested partly on an argument that no
 * longer holds — that the flag would land on a vendored client this repo could
 * not edit. osfacts is ours, it lives in juspay/osfacts, and its own tsconfig
 * turns the flag ON upstream; the grafted client contributes ZERO of the 922.
 * The decision is unchanged, and now it stands on the number alone: the blast
 * radius is kolu's own code, in the hundreds, and every one of those sites is a
 * separate judgement about whether a key should be absent or present-undefined.
 * So the rule is enforced the way the run-edge budget is: by enumeration. Every
 * `.optional(` call under `packages/` is counted, and the result must equal the
 * list below — path AND count, so a second one added to an already-listed file
 * is a failure too.
 *
 * **Adding a row is not the fix.** `optionalKey` is the default; a new row must
 * argue why the value cannot be produced as an absent key at its source.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankNonCode } from "./runEdges";

export interface OptionalToleranceSite {
  /** Repo-relative path, POSIX separators. */
  readonly path: string;
  /** How many `.optional(` fields this file is allowed. */
  readonly sites: number;
  /** WHY absence cannot be produced at the source — the argument, not a
   *  restatement. The full case lives at the call site. */
  readonly why: string;
}

/** The sanctioned tolerance shims. Sorted by path; keep it that way. */
export const OPTIONAL_TOLERANCE_ALLOWLIST: readonly OptionalToleranceSite[] = [
  {
    path: "packages/integrations/git/src/schemas.ts",
    sites: 2,
    why: "`oldPath` on the changed-file record and on the diff input it feeds — a caller reads `file.oldPath` off a decoded record and hands it straight to `getDiff` (`hostCodeTab.ts`), so the key reaches the wire present-with-`undefined` for every file that is not a rename or copy",
  },
  {
    path: "packages/kaval/src/ptyHostSurface.ts",
    sites: 1,
    why: '`foregroundPid` — "no foreground pid" is a VALUE here, not an absent fact (`readForegroundPid` collapses `tcgetpgrp`\'s transient `0` to `undefined` and `ForegroundSample` declares the key REQUIRED), and the tap forwards whole samples verbatim, which no conditional spread can discipline; under `optionalKey` the encode killed the whole foreground tap',
  },
  {
    path: "packages/padi-client/src/surface.ts",
    sites: 2,
    why: "`reflowEpoch` and `grid` on the attach snapshot — BOTH forwarded verbatim across the same five hops of optional-typed records before they are encoded, and reading an absent optional key yields `undefined`, so every hop re-creates the key present-with-`undefined` however clean the hop before it was. `grid` (5.5) shipped as `optionalKey` for one review round: that spelling fails the ENCODE and takes the whole attach stream down on both of its reachable no-grid producers — a kaval predating the field (the mixed-version path its no-major bump exists to keep alive) and `local.ts`'s abort-before-snapshot return, which omits it even on a current kaval",
  },
];

/** A `.optional(` call on ANY receiver, not just a `Schema.` namespace — an
 *  alias import (`import { Schema as S }`) must not be able to dodge the count.
 *  `.optionalKey(` does not match: the `(` has to follow `optional` directly. */
const OPTIONAL_CALL = /\.optional\s*\(/g;

/** A named import of `optional` — the one way a call site could dodge
 *  {@link OPTIONAL_CALL}'s member-access shape. The module specifier is
 *  deliberately NOT part of the match: reading it would mean keeping string
 *  literals, and this scan covers test files, which quote the dodge in order to
 *  prove it is caught. Any local export named `optional` is caught too; the fix
 *  there is to rename it, since the name is Schema vocabulary. `optionalKey`
 *  does not match — `\b` needs a boundary right after `optional`. */
const BARE_OPTIONAL_IMPORT = /import\s*\{[^}]*\boptional\b[^}]*\}\s*from/;

/** Directories with nothing to police. `example` trees are IN scope: they are
 *  consumer code people copy, so a tolerance shim shown there without its
 *  argument teaches the wrong default. */
const SKIPPED = new Set(["node_modules", "dist", ".astro"]);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

/** How many tolerance shims `source` really declares. Comments and string
 *  literals are blanked first — the four sites are each argued for in prose
 *  above themselves, and this file names the spelling too. */
export function countOptionalCalls(source: string): number {
  return (blankNonCode(source).match(OPTIONAL_CALL) ?? []).length;
}

/** True when `source` imports `optional` by bare name. */
export function hasBareOptionalImport(source: string): boolean {
  return BARE_OPTIONAL_IMPORT.test(blankNonCode(source));
}

/** Path → number of `.optional(` fields, for every file under `packages/` that
 *  has at least one. Tests and examples included: a fifth shim is a fifth shim
 *  wherever it is written. */
export function collectOptionalTolerance(
  repoRoot: string,
): Map<string, number> {
  const files: string[] = [];
  walk(path.join(repoRoot, "packages"), files);
  const found = new Map<string, number>();
  for (const full of files.sort()) {
    const file = path.relative(repoRoot, full).split(path.sep).join("/");
    const source = readFileSync(full, "utf8");
    if (hasBareOptionalImport(source)) {
      throw new Error(
        `${file} imports \`optional\` by bare name. Use the namespaced form (\`Schema.optional\`) so the tolerance allowlist can see it.`,
      );
    }
    const count = countOptionalCalls(source);
    if (count > 0) found.set(file, count);
  }
  return found;
}

/** Throw unless the found shims are EXACTLY the allowlisted ones. */
export function validateOptionalTolerance(
  found: ReadonlyMap<string, number>,
  allowlist: readonly OptionalToleranceSite[] = OPTIONAL_TOLERANCE_ALLOWLIST,
): void {
  const allowed = new Map(allowlist.map((e) => [e.path, e.sites]));
  const problems: string[] = [];
  for (const [file, count] of [...found].sort()) {
    const expected = allowed.get(file);
    if (expected === undefined) {
      problems.push(
        `  + ${file} declares ${count} \`optional\` field(s) and is NOT on the allowlist. Use \`Schema.optionalKey\` and produce the key ABSENT at its source (a conditional spread, not an \`undefined\` value); list it only if forwarding makes that impossible.`,
      );
    } else if (expected !== count) {
      problems.push(
        `  ~ ${file} declares ${count} \`optional\` field(s); the allowlist says ${expected}.`,
      );
    }
  }
  for (const entry of allowlist) {
    if (!found.has(entry.path)) {
      problems.push(
        `  - ${entry.path} is allowlisted for ${entry.sites} \`optional\` field(s) but has none — drop the row.`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `\`Schema.optional\` tolerance allowlist is out of date (review finding B3):\n${problems.join("\n")}`,
    );
  }
}
