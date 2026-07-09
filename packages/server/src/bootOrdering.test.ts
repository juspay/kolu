/**
 * W4 fail-open pin: the HTTP server's `serve()` must never sit DOWNSTREAM of the
 * LOCAL padi arm's connect.
 *
 * Before this fix, `index.ts` did `await pool.getSession(LOCAL_HOST)?.pin()` before
 * assembling the router / calling `serve()` — a slow or wedged local padi (the
 * #1713-class socket-path mismatch this same change fixes, or any other spawn
 * stall) held the WHOLE HTTP server back for its ~30s connect timeout. The REMOTE
 * arm was already fail-open (never boot-awaited); this pins that the LOCAL arm now
 * matches it structurally.
 *
 * A real end-to-end boot-timing measurement (isolated state dirs, XDG_RUNTIME_DIR
 * unset, a wedged/failing local padi) is heavier than a unit suite should carry —
 * see the PR for the manual measurement (HTTP up in ~1s regardless of whether the
 * local padi ever connects). This test instead pins the ORDERING structurally, by
 * parsing `index.ts`'s own top-level statements: the local-arm pin statement must
 * (a) exist, (b) NOT be an `await` (so it can't block), and (c) be reached, in
 * source order, before the `serve(...)` call that starts accepting connections —
 * `index.ts` is a flat top-level-await script with no function indirection between
 * these two points, so source order IS execution order here.
 */

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

function parseTopLevelStatements(): AstNode[] {
  return parse(SOURCE, {
    sourceFilename: ENTRY,
    sourceType: "module",
    plugins: ["typescript"],
    createParenthesizedExpressions: true,
  }).program.body as unknown as AstNode[];
}

/** Does this statement's (possibly parenthesized) expression textually reach a
 *  `.pin()` call chained off `pool.getSession(...)` — the LOCAL padi arm's warm-up
 *  kick? Text-contains rather than a full call-chain walk: robust to the exact
 *  chain shape (optional-chaining `?.`, multi-line formatting) while still narrow
 *  enough that it can't accidentally match an unrelated statement. */
function isLocalPinStatement(stmt: AstNode): boolean {
  if (stmt.type !== "ExpressionStatement") return false;
  const text = nodeText(stmt);
  return (
    text.includes("pool") &&
    text.includes(".getSession(") &&
    text.includes(".pin()")
  );
}

/** Is `stmt`'s top-level expression an `await` — i.e. would reaching this
 *  statement actually SUSPEND the module's top-level execution here? Unwraps one
 *  level of parens (`(await x)` written as a bare statement), which is all a
 *  `ts.isExpressionStatement` can legally wrap. */
function isAwaitStatement(stmt: AstNode): boolean {
  if (stmt.type !== "ExpressionStatement") return false;
  let expr = stmt.expression;
  while (isAstNode(expr) && expr.type === "ParenthesizedExpression") {
    expr = expr.expression;
  }
  return isAstNode(expr) && expr.type === "AwaitExpression";
}

/** Is this the `const server = serve(...)` declaration that starts accepting
 *  HTTP connections? Matched by the declared name (`server`) + the initializer
 *  textually calling `serve(` — robust to `serve`'s exact argument shape. */
function isServeListenStatement(stmt: AstNode): boolean {
  if (
    stmt.type !== "VariableDeclaration" ||
    !Array.isArray(stmt.declarations)
  ) {
    return false;
  }
  return stmt.declarations.some((decl) => {
    if (!isAstNode(decl) || !isIdentifierNamed(decl.id, "server")) return false;
    const init = decl.init;
    return (
      isAstNode(init) &&
      init.type === "CallExpression" &&
      isIdentifierNamed(init.callee, "serve")
    );
  });
}

describe("index.ts boot ordering — the LOCAL padi arm's pin never blocks serve()", () => {
  const statements = parseTopLevelStatements();
  const pinIndex = statements.findIndex(isLocalPinStatement);
  const serveIndex = statements.findIndex(isServeListenStatement);

  it("finds both landmark statements (a stale rewrite of index.ts would otherwise silently pass this pin)", () => {
    expect(pinIndex).toBeGreaterThanOrEqual(0);
    expect(serveIndex).toBeGreaterThanOrEqual(0);
  });

  it("the LOCAL arm's pin is NOT an `await` — reaching it can never suspend module boot", () => {
    expect(isAwaitStatement(statements[pinIndex] as AstNode)).toBe(false);
  });

  it("the LOCAL arm's pin is kicked off BEFORE `serve()` starts listening — the pin is reached, but never blocks reaching serve()", () => {
    expect(pinIndex).toBeLessThan(serveIndex);
  });
});
