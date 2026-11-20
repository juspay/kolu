import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const PADI_SRC = dirname(HERE);

const HOME = join(HERE, "metadata.ts");

const REGISTRY_GETTERS = new Set([
  "getTerminal",
  "requireTerminal",
  "requireMutableTerminal",
]);

const GUARDED_FIELDS = new Set(["snapshot", "meta"]);

type AstNode = { type: string; [key: string]: unknown };

const isAstNode = (v: unknown): v is AstNode =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as AstNode).type === "string";

function visitAst(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (isAstNode(item)) visitAst(item, visit);
    } else if (isAstNode(value)) {
      visitAst(value, visit);
    }
  }
}

function walkSources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkSources(p));
    else if (
      (e.name.endsWith(".ts") || e.name.endsWith(".tsx")) &&
      !e.name.endsWith(".test.ts") &&
      !e.name.endsWith(".test.tsx") &&
      !e.name.endsWith(".testlib.ts")
    ) {
      out.push(p);
    }
  }
  return out;
}

const callsRegistryGetter = (node: unknown): boolean =>
  isAstNode(node) &&
  node.type === "CallExpression" &&
  isAstNode(node.callee) &&
  node.callee.type === "Identifier" &&
  REGISTRY_GETTERS.has(node.callee.name as string);

function memberChain(lhs: AstNode): { root: AstNode; props: string[] } {
  const props: string[] = [];
  let node: AstNode = lhs;
  while (node.type === "MemberExpression") {
    const property = node.property;
    if (
      node.computed !== true &&
      isAstNode(property) &&
      property.type === "Identifier"
    ) {
      props.unshift(property.name as string);
    }
    if (!isAstNode(node.object)) break;
    node = node.object;
  }
  return { root: node, props };
}

function mutationsThroughRegistryHandles(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const ast = parse(src, {
    sourceFilename: file,
    sourceType: "module",
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  }) as unknown as AstNode;

  const handles = new Set<string>();
  visitAst(ast, (node) => {
    if (
      node.type === "VariableDeclarator" &&
      isAstNode(node.id) &&
      node.id.type === "Identifier" &&
      callsRegistryGetter(node.init)
    ) {
      handles.add(node.id.name as string);
    }
  });

  const hits: string[] = [];
  visitAst(ast, (node) => {
    if (node.type !== "AssignmentExpression" || !isAstNode(node.left)) return;
    if (node.left.type !== "MemberExpression") return;
    const { root, props } = memberChain(node.left);
    if (!props.some((p) => GUARDED_FIELDS.has(p))) return;
    const throughHandle =
      (root.type === "Identifier" && handles.has(root.name as string)) ||
      callsRegistryGetter(root);
    if (!throughHandle) return;
    const line =
      isAstNode(node.loc) && isAstNode(node.loc.start)
        ? (node.loc.start.line as number)
        : 0;
    const text = src.slice(node.start as number, node.end as number);
    hits.push(`${line}: ${text.split("\n")[0]}`);
  });
  return hits;
}

const REMOVAL_DOORS = new Set([
  "claimActiveTerminal",
  "unregisterTerminal",
  "drainTerminals",
]);

function removalDoorImporters(sources: string[]): string[] {
  const importers: string[] = [];
  for (const file of sources) {
    const src = readFileSync(file, "utf8");
    const ast = parse(src, {
      sourceFilename: file,
      sourceType: "module",
      plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
    }) as unknown as AstNode;
    let hit = false;
    visitAst(ast, (node) => {
      if (node.type !== "ImportSpecifier" || !isAstNode(node.imported)) return;
      if (node.imported.type !== "Identifier") return;
      if (REMOVAL_DOORS.has(node.imported.name as string)) hit = true;
    });
    if (hit) importers.push(relative(PADI_SRC, file));
  }
  return importers;
}

describe("registry-entry mutation is confined to terminalEndpoint/metadata.ts", () => {
  const sources = walkSources(PADI_SRC);

  it("no module outside metadata.ts mutates a registry entry's snapshot/meta", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      if (file === HOME) continue;
      for (const hit of mutationsThroughRegistryHandles(file)) {
        offenders.push(`${relative(PADI_SRC, file)}:${hit}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("metadata.ts IS the home (the fence is anchored, not vacuous)", () => {
    expect(mutationsThroughRegistryHandles(HOME).length).toBeGreaterThan(0);
  });
});

describe("terminal removal is confined to terminalEndpoint/local.ts", () => {
  const sources = walkSources(PADI_SRC);

  it("no other module imports a registry removal door", () => {
    expect(removalDoorImporters(sources)).toEqual([
      join("terminalEndpoint", "local.ts"),
    ]);
  });
});
