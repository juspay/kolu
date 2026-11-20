import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { blankCommentsAndStrings } from "./runEdges";

export interface OptionalToleranceSite {
  readonly path: string;
  readonly sites: number;
  readonly why: string;
}

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
    sites: 1,
    why: "`reflowEpoch` on the attach snapshot — forwarded verbatim across five hops of optional-typed records before it is encoded, and reading an absent optional key yields `undefined`, so every hop re-creates the key present-with-`undefined` however clean the hop before it was. `grid` was the second site until the snapshot frame stopped being able to lack one: an attach with no screen emits no snapshot frame at all now (padi 7.5), so the field is REQUIRED and the tolerance it needed is gone with it",
  },
];

const OPTIONAL_CALL = /\.optional\s*\(/g;

const BARE_OPTIONAL_IMPORT = /import\s*\{[^}]*\boptional\b[^}]*\}\s*from/;

const SKIPPED = new Set(["node_modules", "dist", ".astro"]);

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (SKIPPED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
}

export function countOptionalCalls(source: string): number {
  return (blankCommentsAndStrings(source).match(OPTIONAL_CALL) ?? []).length;
}

export function hasBareOptionalImport(source: string): boolean {
  return BARE_OPTIONAL_IMPORT.test(blankCommentsAndStrings(source));
}

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
