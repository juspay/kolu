import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const SRC = path.dirname(fileURLToPath(import.meta.url));

const sources = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(at);
    return entry.isFile() && entry.name.endsWith(".ts") ? [at] : [];
  });

const importedBy = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(/\bfrom\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

const packageOf = (specifier: string): string | null => {
  if (specifier.startsWith(".")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? `${parts[0]}/${parts[1]}`
    : (parts[0] ?? specifier);
};

const isProduct = (name: string): boolean =>
  name.startsWith("kolu-") || name === "@kolu/terminal-vocab";

describe("the harness carries nothing of a product", () => {
  test("no file under src/ imports one", () => {
    const named = sources(SRC).flatMap((file) =>
      importedBy(readFileSync(file, "utf8"))
        .map(packageOf)
        .filter((name) => name !== null && isProduct(name))
        .map((name) => `${path.relative(SRC, file)} → ${name}`),
    );
    expect(named).toEqual([]);
  });

  test("and the manifest declares none", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(SRC, "..", "package.json"), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];
    expect(declared.filter(isProduct)).toEqual([]);
  });
});
