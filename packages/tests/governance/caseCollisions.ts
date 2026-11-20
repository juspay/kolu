const SOURCE_MODULE = /\.(?:[cm]?[jt]s|[jt]sx)$/;

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

export function validateCaseCollisions(collisions: readonly string[][]): void {
  if (collisions.length === 0) return;
  throw new Error(
    [
      "source modules whose import paths differ only by case — one file on a case-insensitive disk (macOS), so the build there resolves the wrong module. Rename one of each group:",
      ...collisions.map((group) => `  ${group.join("  ≡  ")}`),
    ].join("\n"),
  );
}
