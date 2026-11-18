/**
 * THIS PACKAGE NAMES NO PRODUCT, held red.
 *
 * Two chat UIs run this one copy — kolu's Conductor and olai's chat panel —
 * and olai vendors the directory as raw TypeScript out of a kolu pin. So an
 * import of `kolu-common`, `kolu-mcp` or `@kolu/terminal-vocab` here is not a
 * style complaint: it is a package olai does not have, reached from a file
 * olai compiles, and the failure is a tree that will not build in a repository
 * nobody in this one is watching.
 *
 * IT IS A TEST BECAUSE THE COMPILER CANNOT SEE IT. Inside this workspace every
 * one of those names resolves perfectly well; what breaks is somewhere else.
 * The same argument `packages/acp/src/sharedVocabulary.test.ts` makes for the
 * names that must not disappear, made for the names that must not appear.
 *
 * WHAT IS ALLOWED is `@kolu/acp`, `@kolu/acp-client` and `@kolu/child` — the
 * three siblings olai vendors beside this one (`packages/tests/governance/
 * vendorEntries.ts` says why each is there) — plus `effect`, the protocol SDK
 * underneath the client, and node's own modules.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const SRC = path.dirname(fileURLToPath(import.meta.url));

/** Every `.ts` file of this package, tests and test libraries included: a
 *  suite that reached for a product's schema would be as unbuildable in the
 *  consumer's tree as the source beside it. */
const sources = (dir: string): ReadonlyArray<string> =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const at = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(at);
    return entry.isFile() && entry.name.endsWith(".ts") ? [at] : [];
  });

/** What every `import`/`export … from` in a file names, as written. Literal on
 *  purpose: this repository pins TypeScript 7, whose compiler API no longer
 *  offers `transpileModule`, and a parser is not worth owning for a claim this
 *  shape. */
const importedBy = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(/\bfrom\s+"([^"]+)"/g)].map((match) => match[1] ?? "");

/** A package name out of a specifier: `kolu-mcp/fleetRef` is `kolu-mcp`, and
 *  `@kolu/acp/wire` is `@kolu/acp`. A relative path names no package. */
const packageOf = (specifier: string): string | null => {
  if (specifier.startsWith(".")) return null;
  const parts = specifier.split("/");
  return specifier.startsWith("@")
    ? `${parts[0]}/${parts[1]}`
    : (parts[0] ?? specifier);
};

/** The two spellings a product's own package has in this tree. */
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
