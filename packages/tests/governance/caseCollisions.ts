/**
 * No two source modules whose import paths differ only by letter case.
 *
 * WHY THIS EXISTS. Imports here carry no extension, so `./ConductorStatus`
 * names a module by its path minus `.ts`/`.tsx`. On Linux's case-sensitive
 * disk `ConductorStatus.tsx` and `conductorStatus.ts` are two files and both
 * imports resolve to the one each author meant. On macOS's case-insensitive
 * disk they are ONE path: the typecheck picks whichever it meets first, fails
 * with "differs only in casing" and "has no default export", and kolu does not
 * build on a Mac at all (#2364 shipped exactly that, green on every Linux lane).
 * Linux can never see the failure by running the build, so it is checked as a
 * fact about the tree instead.
 *
 * THE RULE. Two tracked source modules collide when their paths, with the one
 * module extension dropped, are equal ignoring case. The DIRECTORY part is
 * compared ignoring case too: `a/foo.ts` and `A/foo.ts` are the same file on a
 * Mac for the same reason, so a collision across directories that differ only
 * by case is the same defect, not a different one. Equal stems with different
 * extensions (`foo.ts` beside `foo.tsx`) collide as well — an extensionless
 * `./foo` names one of them by resolver precedence, which is the same silent
 * pick on every OS.
 *
 * WHY GOVERNANCE. A claim about the whole repository rather than about one
 * package — the reason the `Effect.run*` budget and the `Schema.optional`
 * allowlist live here too — and the lane is the fast one Linux CI already runs.
 * `git ls-files` is the file list, so what is checked is what is committed and
 * `.gitignore` decides what is out of scope; there is no second ignore list.
 */

/** The extensions an extensionless import resolves through. */
const SOURCE_MODULE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

/** Every group of two or more source modules that share one case-folded
 *  import path, each group sorted, groups sorted by their first member. */
export function findCaseCollisions(files: readonly string[]): string[][] {
  const byImportPath = new Map<string, string[]>();
  for (const file of files) {
    if (!SOURCE_MODULE.test(file)) continue;
    const key = file.replace(SOURCE_MODULE, "").toLowerCase();
    const group = byImportPath.get(key);
    if (group === undefined) byImportPath.set(key, [file]);
    else group.push(file);
  }
  return [...byImportPath.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort())
    .sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? ""));
}

/** Throw, naming every colliding group, unless there are none. */
export function validateCaseCollisions(collisions: readonly string[][]): void {
  if (collisions.length === 0) return;
  throw new Error(
    [
      "source modules whose import paths differ only by case — one file on a case-insensitive disk (macOS), so the build there resolves the wrong module. Rename one of each group:",
      ...collisions.map((group) => `  ${group.join("  ≡  ")}`),
    ].join("\n"),
  );
}
