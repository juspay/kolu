/**
 * CONFINEMENT PIN (SR10) — registry-entry mutation lives in ONE file.
 *
 * A `TerminalProcess` obtained from the registry (`getTerminal` /
 * `requireTerminal` / `requireMutableTerminal`) carries the two publish-relevant
 * mutable fields the composed-terminal fold writes: `entry.snapshot` (the current
 * observation) and `entry.meta.*` (the authored `AgentMemory` facts +
 * `restoreTarget`). Every such write is a PUBLISH SEAM — it must be followed by a
 * `publishComposedTerminal` so subscribers see the new value. Today all of them
 * live in `terminalEndpoint/metadata.ts` (`commitSnapshot`, `updateMemory`), which
 * pairs each mutation with its guarded publish.
 *
 * SR10 proposed a structural cure (a single in-place mutator that can't be
 * bypassed); srid DECLINED it (dated). This test is the residual fence that keeps
 * the ACCEPTED convention un-sprawlable without that cure: a future write path that
 * mutates a registry entry's `snapshot`/`meta` MUST land in `metadata.ts` — beside
 * the publish seams — or fail CI here. It does NOT allow-list any site outside that
 * file: a new outside mutation is a live instance of the very defect SR10 named, and
 * the fix is to move the write next to its publish, not to widen this list.
 *
 * Detection (AST, no type info): within each non-test module under `packages/padi/
 * src`, collect the identifiers bound to a registry getter (`const e =
 * requireMutableTerminal(id)`), then flag any assignment whose left side reaches
 * `.snapshot` or `.meta` through one of those handles — or through an inline getter
 * call (`getTerminal(id).snapshot = …`). Reads (`entry.meta.state === "parked"`)
 * are never assignments, so they don't trip it. This tracks the NAMED vector (a
 * getter-obtained handle); a grep for `.snapshot =` / `.meta.… =` confirms no
 * other-provenance mutation exists outside the home today, so getter-provenance is
 * both sufficient now and the fence against the realistic future sprawl.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url)); // …/terminalEndpoint
const PADI_SRC = dirname(HERE); // packages/padi/src

/** The ONE sanctioned home for registry-entry mutation. */
const HOME = join(HERE, "metadata.ts");

/** The registry getters that hand out a mutable `TerminalProcess`. */
const REGISTRY_GETTERS = new Set([
  "getTerminal",
  "requireTerminal",
  "requireMutableTerminal",
]);

/** The mutable, publish-relevant fields a registry entry carries. */
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

/** Every non-test `.ts`/`.tsx` under `dir`, recursively. */
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

/** Walk a member-expression LHS down to its base object, collecting the
 *  non-computed property names along the chain. `entry.meta.lastActivityAt` →
 *  `{ root: <Identifier entry>, props: ["meta", "lastActivityAt"] }`. */
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

/** Registry-entry mutations (`<handle>.snapshot = …` / `<handle>.meta.* = …`) in
 *  one source file, as `line: source` violations. */
function registryEntryMutations(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const ast = parse(src, {
    sourceFilename: file,
    sourceType: "module",
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  }) as unknown as AstNode;

  // Identifiers bound to a registry getter, e.g. `const entry = getTerminal(id)`.
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
    // The write reaches a guarded field …
    if (!props.some((p) => GUARDED_FIELDS.has(p))) return;
    // … through a registry-obtained handle (bound identifier or inline getter call).
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

describe("registry-entry mutation is confined to terminalEndpoint/metadata.ts", () => {
  const sources = walkSources(PADI_SRC);

  it("no module outside metadata.ts mutates a registry entry's snapshot/meta", () => {
    const offenders: string[] = [];
    for (const file of sources) {
      if (file === HOME) continue;
      for (const hit of registryEntryMutations(file)) {
        offenders.push(`${relative(PADI_SRC, file)}:${hit}`);
      }
    }
    // A hit here is a live instance of the defect SR10 named: move the write into
    // metadata.ts, beside its publish seam — do NOT allow-list it.
    expect(offenders).toEqual([]);
  });

  it("metadata.ts IS the home (the fence is anchored, not vacuous)", () => {
    // Proves the detector actually fires — so the pass above means "confined",
    // not "the matcher is broken".
    expect(registryEntryMutations(HOME).length).toBeGreaterThan(0);
  });
});
