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
  return null;
}

function valueImportsOf(file: string): string[] {
  const ast = parse(readFileSync(file, "utf8"), {
    sourceFilename: file,
    sourceType: "module",
    createImportExpressions: true,
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  }) as unknown as AstNode;
  const specs = new Set<string>();
  visitAst(ast, (node) => {
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
    if (node.type === "ImportExpression") {
      const s = stringLiteralValue(node.source);
      if (s) specs.add(s);
    }
  });
  return [...specs];
}

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
