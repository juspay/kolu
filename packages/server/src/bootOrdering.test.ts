import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "index.ts");
const SOURCE = readFileSync(ENTRY, "utf8");

type AstNode = {
  type: string;
  [key: string]: unknown;
};

const isAstNode = (value: unknown): value is AstNode =>
  value !== null &&
  typeof value === "object" &&
  "type" in value &&
  typeof (value as { type?: unknown }).type === "string";

const isIdentifierNamed = (value: unknown, name: string): boolean =>
  isAstNode(value) && value.type === "Identifier" && value.name === name;

function nodeText(node: AstNode): string {
  if (typeof node.start !== "number" || typeof node.end !== "number") {
    throw new Error(`Babel node missing range: ${node.type}`);
  }
  return SOURCE.slice(node.start, node.end);
}

function parseBootStatements(): AstNode[] {
  const topLevel = parse(SOURCE, {
    sourceFilename: ENTRY,
    sourceType: "module",
    plugins: ["typescript"],
    createParenthesizedExpressions: true,
  }).program.body as unknown as AstNode[];
  for (const stmt of topLevel) {
    const decl =
      stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
    if (
      isAstNode(decl) &&
      decl.type === "FunctionDeclaration" &&
      isIdentifierNamed(decl.id, "bootKoluWeb") &&
      isAstNode(decl.body) &&
      Array.isArray(decl.body.body)
    ) {
      return decl.body.body as AstNode[];
    }
  }
  throw new Error(
    "bootKoluWeb not found in index.ts — the boot-ordering pin has lost its target",
  );
}

function isLocalPinStatement(stmt: AstNode): boolean {
  if (stmt.type !== "ExpressionStatement") return false;
  const text = nodeText(stmt);
  return (
    text.includes("pool") &&
    text.includes(".getSession(") &&
    text.includes(".pin()")
  );
}

function isAwaitStatement(stmt: AstNode): boolean {
  if (stmt.type !== "ExpressionStatement") return false;
  let expr = stmt.expression;
  while (isAstNode(expr) && expr.type === "ParenthesizedExpression") {
    expr = expr.expression;
  }
  return isAstNode(expr) && expr.type === "AwaitExpression";
}

function isServeListenStatement(stmt: AstNode): boolean {
  return nodeText(stmt).includes("serveSurfaceApp(");
}

describe("index.ts boot ordering — the LOCAL padi arm's pin never blocks the listen", () => {
  const statements = parseBootStatements();
  const pinIndex = statements.findIndex(isLocalPinStatement);
  const serveIndex = statements.findIndex(isServeListenStatement);

  it("finds both landmark statements (a stale rewrite of index.ts would otherwise silently pass this pin)", () => {
    expect(pinIndex).toBeGreaterThanOrEqual(0);
    expect(serveIndex).toBeGreaterThanOrEqual(0);
  });

  it("the LOCAL arm's pin is NOT an `await` — reaching it can never suspend module boot", () => {
    expect(isAwaitStatement(statements[pinIndex] as AstNode)).toBe(false);
  });

  it("the LOCAL arm's pin is kicked off BEFORE `serveSurfaceApp()` starts accepting — the pin is reached, but never blocks reaching the listen", () => {
    expect(pinIndex).toBeLessThan(serveIndex);
  });
});
