import { parse } from "@babel/parser";
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVER_SRC = dirname(fileURLToPath(import.meta.url));
const PACKAGES = join(SERVER_SRC, "..", "..");
const SCANNED_TREES = [join(PACKAGES, "kaval-tui", "src"), SERVER_SRC];

const ALLOW_MARKER = /first-frame-guard:allow\s*[—-]\s*[A-Za-z0-9]/;

const LOOP_TYPES = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);
const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "StaticBlock",
]);

const SKIP_KEYS = new Set(["loc", "leadingComments", "trailingComments"]);
const childKeys = (rec: Record<string, unknown>): string[] =>
  Object.keys(rec).filter((k) => !SKIP_KEYS.has(k));

const isSourceFile = (p: string): boolean =>
  /\.tsx?$/.test(p) && !/\.test(-d)?\.tsx?$/.test(p);

function listSourceFiles(tree: string): string[] {
  return globSync("**/*.{ts,tsx}", {
    cwd: tree,
    exclude: (p) => p.includes("node_modules"),
  })
    .filter(isSourceFile)
    .map((rel) => join(tree, rel));
}

function forEachForAwait(
  node: unknown,
  pending: readonly string[],
  cb: (loop: Record<string, unknown>, labels: readonly string[]) => void,
): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) forEachForAwait(child, [], cb);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "LabeledStatement") {
    const name = (rec.label as { name?: string } | undefined)?.name;
    forEachForAwait(rec.body, name ? [...pending, name] : pending, cb);
    return;
  }
  if (rec.type === "ForOfStatement" && rec.await === true) cb(rec, pending);
  for (const key of childKeys(rec)) forEachForAwait(rec[key], [], cb);
}

function bodyStatements(
  body: Record<string, unknown>,
): Record<string, unknown>[] {
  if (body.type === "BlockStatement" && Array.isArray(body.body))
    return body.body as Record<string, unknown>[];
  return [body];
}

function hasSelfTargetingContinue(
  body: Record<string, unknown>,
  ownLabels: readonly string[],
): boolean {
  let found = false;
  const descend = (n: unknown, nestedLoop: boolean, inFn: boolean): void => {
    if (found || n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const c of n) descend(c, nestedLoop, inFn);
      return;
    }
    const rec = n as Record<string, unknown>;
    const type = rec.type;
    if (type === "ContinueStatement") {
      const label = (rec.label as { name?: string } | null | undefined)?.name;
      const targetsThis =
        label == null
          ? !nestedLoop && !inFn
          : !inFn && ownLabels.includes(label);
      if (targetsThis) {
        found = true;
        return;
      }
    }
    const t = typeof type === "string" ? type : "";
    const childNestedLoop = nestedLoop || LOOP_TYPES.has(t);
    const childInFn = inFn || FUNCTION_TYPES.has(t);
    for (const key of childKeys(rec))
      descend(rec[key], childNestedLoop, childInFn);
  };
  descend(body, false, false);
  return found;
}

const hasTopLevelExit = (body: Record<string, unknown>): boolean =>
  bodyStatements(body).some(
    (s) => s.type === "ReturnStatement" || s.type === "BreakStatement",
  );

function isOneShotForAwait(
  node: Record<string, unknown>,
  ownLabels: readonly string[],
): boolean {
  const body = node.body as Record<string, unknown>;
  return !hasSelfTargetingContinue(body, ownLabels) && hasTopLevelExit(body);
}

function markerDirectlyAbove(lines: string[], line: number): boolean {
  if (ALLOW_MARKER.test(lines[line - 1] ?? "")) return true;
  for (let i = line - 2; i >= 0; i--) {
    const t = lines[i]?.trim() ?? "";
    if (t === "") return false;
    if (!(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")))
      return false;
    if (ALLOW_MARKER.test(t)) return true;
  }
  return false;
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const tree of SCANNED_TREES) {
    for (const file of listSourceFiles(tree)) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      const ast = parse(text, {
        sourceType: "module",
        plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
      });
      const rel = file.replace(`${PACKAGES}/`, "");
      forEachForAwait(ast.program, [], (loop, labels) => {
        if (!isOneShotForAwait(loop, labels)) return;
        const line = (loop.loc as { start: { line: number } } | undefined)
          ?.start.line;
        if (line !== undefined && markerDirectlyAbove(lines, line)) return;
        violations.push(`${rel}:${line ?? "?"}`);
      });
    }
  }
  return violations;
}

describe("first-frame one-shot guard — no consumer spells a one-shot first-frame read as a `for await (…) return/break` loop, the shape this sweep deleted (SR6)", () => {
  it("kaval-tui/src + server/src open-code no un-allow-listed one-shot `for await (…) return/break`; the yields-once first-frame read rides `firstFrameOrThrow`/`firstFrameOrUndefined`", () => {
    expect(findViolations()).toEqual([]);
  });

  it("flags an unconditional one-shot; spares a conditional-exit or continue-guarded loop", () => {
    const collect = (src: string): string[] => {
      const ast = parse(src, { sourceType: "module", plugins: ["typescript"] });
      const hits: string[] = [];
      forEachForAwait(ast.program, [], (loop, labels) => {
        if (isOneShotForAwait(loop, labels))
          hits.push(
            String((loop.loc as { start: { line: number } }).start.line),
          );
      });
      return hits;
    };
    expect(
      collect(
        "async function f(){ for await (const m of await c.g({i})) { return m.x; } }",
      ),
    ).toEqual(["1"]);
    expect(
      collect("async function f(){ for await (const m of s) return m; }"),
    ).toEqual(["1"]);
    expect(
      collect(
        "async function f(){ for await (const _m of s) { g(); return; } }",
      ),
    ).toEqual(["1"]);
    expect(
      collect(
        "async function f(){ for await (const m of s) { if (m.k==='o') break; await w(m.d); } }",
      ),
    ).toEqual([]);
    expect(
      collect(
        "async function f(){ for await (const m of s) { if (m!==null) return m; buf+=m; } }",
      ),
    ).toEqual([]);
    expect(
      collect(
        "async function f(){ for await (const m of s) { if (m.kind==='snapshot') continue; return m; } }",
      ),
    ).toEqual([]);
    expect(
      collect(
        "async function f(){ outer: for await (const m of s) { if (m.kind==='snapshot') continue outer; return m; } }",
      ),
    ).toEqual([]);
    expect(
      collect(
        "async function f(){ outer: for await (const m of s) { for (const x of m) { if (x) continue outer; } return m; } }",
      ),
    ).toEqual([]);
    expect(
      collect(
        "async function f(){ for await (const m of s) { for (const x of m) { if (x) continue; } return m; } }",
      ),
    ).toEqual(["1"]);
    expect(
      collect(
        "async function f(){ outer: inner: for await (const m of s) { if (x) continue outer; return m; } }",
      ),
    ).toEqual([]);
    expect(
      collect(
        "async function f(){ outer: for await (const m of s) { const g = () => { outer: for (const y of z) { if (y) continue outer; } }; return m; } }",
      ),
    ).toEqual(["1"]);
    expect(
      collect(
        "async function f(){ outer: for await (const m of s) { const o = { g(){ outer: for (const y of z) { if (y) continue outer; } } }; return m; } }",
      ),
    ).toEqual(["1"]);
  });

  it("allow-list requires a non-empty reason in the comment block directly above", () => {
    const withMarker = (l: string): string[] => l.split("\n");
    expect(
      markerDirectlyAbove(
        withMarker("// first-frame-guard:allow — real reason\nfor await"),
        2,
      ),
    ).toBe(true);
    expect(
      markerDirectlyAbove(
        withMarker("// first-frame-guard:allow —\nfor await"),
        2,
      ),
    ).toBe(false);
    expect(
      markerDirectlyAbove(
        withMarker("// first-frame-guard:allow — reason\n\nfor await"),
        3,
      ),
    ).toBe(false);
    expect(
      markerDirectlyAbove(
        withMarker("/* first-frame-guard:allow — real */\nfor await"),
        2,
      ),
    ).toBe(true);
    expect(
      markerDirectlyAbove(
        withMarker("/* first-frame-guard:allow — */\nfor await"),
        2,
      ),
    ).toBe(false);
  });
});
