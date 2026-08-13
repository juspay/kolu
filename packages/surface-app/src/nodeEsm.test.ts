/**
 * The two entries a CONSUMER'S NODE loads directly may not import a relative path.
 *
 * `./vite` has always said this about itself — a Vite config imports it through
 * Node's ESM loader, which cannot resolve this package's extensionless relative
 * imports — and is written self-contained because of it. What that note missed is
 * that a Vite config also imports the package ROOT: kolu's own
 * `packages/client/vite.config.ts` takes `ASSET_DIR` and `NOTIFICATION_SW_SOURCE`
 * from `@kolu/surface-app`. So `./index` carries the identical constraint, and
 * one `from "./anything"` in it — a re-export included — is
 * `ERR_MODULE_NOT_FOUND` at every consumer's `vite dev`.
 *
 * Nothing else in this package can see that. Vitest, Bun and every bundler
 * resolve those imports happily, so the whole suite stays green while the dev
 * server of every consumer is dead. It cost a red `ci::dev-smoke` to find once —
 * a three-minute lane whose failure reads "timed out waiting for
 * http://localhost:…". This is that lane's cheap twin: it fails in
 * milliseconds, in the package that owns the mistake, naming it.
 *
 * It reads the SOURCE rather than loading it, because the honest way to check a
 * resolver is to run one and this suite may not: `execFileSync(process.execPath,
 * …)` is a real fork, and `@kolu/daemon-test-gate` refuses ungated forks
 * (kolu#1334/#1375) — correctly, since a rule that bends for a cheap spawn is not
 * a rule. The source check is stricter than Node is anyway: this package is
 * deliberately extensionless everywhere, so for these two files the answer to
 * "any relative import?" must be none, not "only resolvable ones".
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Every relative specifier the file imports or re-exports from — `import x from
 *  "./a"`, `import "./a"`, `export { x } from "./a"`, `export * from "./a"`. */
const relativeSpecifiers = (file: string): string[] => {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  // The file must be the one we think it is: a path typo would otherwise make
  // every assertion below vacuously true.
  expect(source).toContain("export");
  // Comments first — these files EXPLAIN this rule in their headers, quoting the
  // very shape they must not contain.
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  return [...code.matchAll(/(?:from|import)\s*\(?\s*"(\.[^"]*)"/g)].map(
    (m) => m[1] as string,
  );
};

describe("the entries a consumer's Node loads directly", () => {
  it("`.` imports nothing relative — a Vite config imports it under Node's ESM loader", () => {
    expect(relativeSpecifiers("./index.ts")).toEqual([]);
  });

  it("`/vite` imports nothing relative — that is what a plugin IS", () => {
    expect(relativeSpecifiers("./vite.ts")).toEqual([]);
  });

  it("finds the relative specifiers it is looking for, in a file that has them", () => {
    // The negative assertions above are only worth their green if this reader
    // can see the thing it is asserting the absence of.
    expect(relativeSpecifiers("./bun.ts")).toContain("./modulePreload");
  });
});
