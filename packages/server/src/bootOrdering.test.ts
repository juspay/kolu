/**
 * W4 fail-open pin: the HTTP server's listen must never sit DOWNSTREAM of the
 * LOCAL padi arm's connect.
 *
 * Before this fix, `index.ts` did `await pool.getSession(LOCAL_HOST)?.pin()` before
 * assembling the router / listening — a slow or wedged local padi (the
 * #1713-class socket-path mismatch this same change fixes, or any other spawn
 * stall) held the WHOLE HTTP server back for its ~30s connect timeout. The REMOTE
 * arm was already fail-open (never boot-awaited); this pins that the LOCAL arm now
 * matches it structurally.
 *
 * A real end-to-end boot-timing measurement (isolated state dirs, XDG_RUNTIME_DIR
 * unset, a wedged/failing local padi) is heavier than a unit suite should carry —
 * see the PR for the manual measurement (HTTP up in ~1s regardless of whether the
 * local padi ever connects). This test instead pins the ORDERING structurally, by
 * parsing the statements of `index.ts`'s exported `bootKoluWeb` (the boot
 * sequence — the module's former top-level script, function-ized at kolu-cli PR1
 * when the bin moved to `packages/kolu-cli`): the local-arm pin statement must
 * (a) exist, (b) NOT be an `await` (so it can't block), and (c) be reached, in
 * source order, before the `serveSurfaceApp(...)` call that binds and starts
 * accepting connections — the boot body is a flat await-bearing sequence with no
 * function indirection between these two points, so source order IS execution
 * order here.
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

/** The statements of `bootKoluWeb`'s body — the boot sequence this test pins.
 *  Finding the function is itself asserted: a rename or a re-flattening of
 *  index.ts fails HERE, loudly, instead of silently passing on an empty list. */
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

/** Is this the statement that starts accepting connections? `serveSurfaceApp`
 *  (`@kolu/surface-app/serve`) owns the node `http(s).Server` now — it creates
 *  it, mounts the app, stands up the ws seam AND binds, all inside the one call
 *  — so that call IS the landmark the bare `server.listen(...)` used to be.
 *  Matched on the call text and not on the statement KIND: the bind's result is
 *  the bound address, so it is a `const … = await …` declaration rather than a
 *  bare expression. */
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
