/** Closure guard — the root barrel kaval's daemon imports must stay lean.
 *
 *  kaval is a Node daemon run from TS SOURCE under tsx (`node --import <tsx
 *  loader> bin.ts`), so ESM is eager: importing `@kolu/xterm-kit` (root) loads
 *  every module the root barrel transitively re-exports, with no tree-shaking.
 *  Two hazards ride in that way and both are structural, not stylistic:
 *
 *   - **solid-js** — a UI reactive framework has no business in a PTY daemon's
 *     closure. `createScrollLock` (solid-reactive) lives behind `/solid` exactly
 *     so the root stays free of it.
 *   - **a VALUE import of `@xterm/xterm`** — the browser terminal ships CJS, and
 *     a static `import { Terminal } from "@xterm/xterm"` fails Node's
 *     cjs-module-lexer under tsx with *"does not provide an export named
 *     'Terminal'"*, crashing daemon startup. The `@xterm/xterm`-constructing
 *     backfill write path lives behind `/backfill` so the root never loads it.
 *
 *  This walks the root's static import graph and fails if either reappears — so a
 *  future misclassification (re-exporting a `/solid` or `/backfill` module from
 *  the root) is red CI here, not a broken daemon in production. */

import { parse } from "@babel/parser";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

type AstNode = { type: string; [key: string]: unknown };
const isAstNode = (v: unknown): v is AstNode =>
  v !== null &&
  typeof v === "object" &&
  "type" in v &&
  typeof (v as { type?: unknown }).type === "string";
function visitAst(node: AstNode, visit: (n: AstNode) => void): void {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) visitAst(item, visit);
    } else if (isAstNode(value)) {
      visitAst(value, visit);
    }
  }
}
const stringLiteralValue = (node: unknown): string | null =>
  isAstNode(node) &&
  node.type === "StringLiteral" &&
  typeof node.value === "string"
    ? node.value
    : null;

/** Resolve a relative import `base` to the source file it names — trying the
 *  bare path, `.ts`/`.tsx`, and a `index.ts`/`index.tsx` directory barrel, the
 *  same order Node/tsx resolve (and the sibling daemon-closure walkers in
 *  padi/kaval use). Returns null ONLY for a genuinely inert, non-source asset
 *  (`.json`/`.css`/`.js`) — which cannot carry a `solid-js` / `@xterm/xterm`
 *  value edge, so is safe to skip. Any relative edge that resolves to NEITHER a
 *  source file NOR such an asset is an unresolved source edge and the caller
 *  throws — silently ignoring it (the old behavior) would let a re-exported
 *  `./solid` directory barrel or a `.tsx` component slip the guard, the exact
 *  regression this test exists to catch. */
function resolveSourceFile(base: string): string | null {
  for (const c of [
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
    base,
  ]) {
    if (
      (c.endsWith(".ts") || c.endsWith(".tsx")) &&
      existsSync(c) &&
      statSync(c).isFile()
    ) {
      return c;
    }
  }
  // Not a source file. The caller distinguishes an inert asset (skip) from a
  // genuinely unresolved edge (throw) by re-testing `spec` — this only reports
  // "no .ts/.tsx here".
  return null;
}

/** VALUE module specifiers `file` pulls at runtime — parsed from the real AST
 *  (`@babel/parser`, like the sibling daemon-closure walkers in
 *  `kaval`/`padi`'s `buildId.closure.test.ts`), so `import type` / `export type`
 *  are skipped by node kind (`importKind`/`exportKind`), and mixed, multi-clause,
 *  or dynamic-import forms are handled without a line-regex's fragility. A
 *  type-only reach can neither crash the daemon nor bloat its closure, so only
 *  value edges count. */
function valueImportsOf(file: string): string[] {
  const ast = parse(readFileSync(file, "utf8"), {
    sourceFilename: file,
    sourceType: "module",
    createImportExpressions: true,
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  }) as unknown as AstNode;
  const specs = new Set<string>();
  visitAst(ast, (node) => {
    // A runtime module load — `import`/`export … from`/`export *` — UNLESS the
    // whole declaration is `import type` / `export type` (erased).
    if (node.type === "ImportDeclaration" && node.importKind !== "type") {
      const s = stringLiteralValue(node.source);
      if (s) specs.add(s);
    }
    if (
      (node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      node.exportKind !== "type"
    ) {
      const s = stringLiteralValue(node.source);
      if (s) specs.add(s);
    }
    // A dynamic `import("x")` also loads at runtime; `import("x")` in a TYPE
    // position (`TSImportType`) is erased and deliberately not counted.
    if (node.type === "ImportExpression") {
      const s = stringLiteralValue(node.source);
      if (s) specs.add(s);
    }
  });
  return [...specs];
}

/** Every bare (non-relative) VALUE module specifier transitively reachable from
 *  `entry`, following relative edges into their source files. An unresolved
 *  relative source edge THROWS rather than being silently dropped. */
function transitiveValueImports(entry: string): Set<string> {
  const seen = new Set<string>();
  const bare = new Set<string>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of valueImportsOf(file)) {
      if (spec.startsWith(".")) {
        const resolved = resolveSourceFile(resolve(dirname(file), spec));
        if (resolved) {
          visit(resolved);
        } else if (!/\.(json|css|js|cjs|mjs)$/.test(spec)) {
          throw new Error(
            `daemon-closure guard: unresolved relative import '${spec}' from ${file} — cannot verify it stays solid-js/@xterm-free`,
          );
        }
      } else {
        bare.add(spec);
      }
    }
  };
  visit(entry);
  return bare;
}

describe("daemon closure guard: @kolu/xterm-kit root barrel", () => {
  it("transitively imports neither solid-js nor a value @xterm/xterm", () => {
    const imports = transitiveValueImports(resolve(here, "index.ts"));
    const forbidden = [...imports].filter(
      (s) =>
        s === "solid-js" || s.startsWith("solid-js/") || s === "@xterm/xterm",
    );
    expect(
      forbidden,
      `The root barrel is imported by kaval's tsx daemon: it must not transitively pull solid-js (UI framework in a PTY daemon) or a VALUE @xterm/xterm (crashes cjs-module-lexer under tsx). Move the offending export to /solid or /backfill. Found: [${forbidden.join(", ")}]`,
    ).toEqual([]);
  });
});
