/**
 * The zero-`kolu-*` dependency guard for `@kolu/surface-daemon-supervisor`.
 *
 * The supervisor half is **spine**: it must reuse cleanly across consumers (kolu
 * today, `odu serve` next), so it may not depend on kolu the app — no spawn
 * policy, no provider DAG, no `kolu-common`/`kolu-pty`/`kolu-shared`. This walks
 * the package's import graph from `index.ts` and asserts every cross-package
 * edge is a known stable dep. A new `kolu-*` edge (or any unlisted external)
 * fails here and forces a conscious decision: the new code belongs in the
 * caller's soul (`packages/server/src/ptyHost`), not in the shared spine.
 *
 * Unlike kaval's closure test there is no "equals the nix-hashed set" half — the
 * supervisor is deliberately NOT a staleKey root (it runs in the client, never
 * the daemon), so it contributes nothing to a build id and nix hashes none of
 * it. This is purely the graduation/allowlist guard.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const ENTRY = resolve(SRC, "index.ts");

// The stable, kolu-free deps the supervisor legitimately rests on: node
// builtins, the daemon half (whose gate-format primitives it composes),
// @kolu/surface for the frozen control-core transport, and ts-pattern for
// exhaustive policy dispatch. UW2 deliberately admits the surface edge:
// probeDaemonIdentity is shared supervisor spine, and making every consumer
// reassemble the same stdio dial/handshake would duplicate the skew boundary
// this package exists to own. Emphatically NO kolu-* app package.
// OSF4 admits the `osfacts-client` edge: `ReadSocketHolders` is stated in the
// tool client's vocabulary (`SocketHolder` / `SocketOccupancy`, re-exported
// from `socketHolder.ts`), because the fold that produces that answer lives
// beside the parser there — one home for kolu and drishti both, rather than the
// same three-way hand-written twice. It was type-only while the seam was
// Promise-shaped; the client's spawning verbs return Effects now, so the seam
// states `Effect.Effect<SocketOccupancy, OsfactsClientError>` and the edge is
// RUNTIME — the error union's three tagged classes are values a consumer
// branches on. (The guard counted type imports too, so the entry did not have
// to move; what changed is what it admits.) It is admissible for the same
// reason the surface edge is — a Node-builtins-only, un-scoped leaf whose one
// runtime dependency is the `effect` this package already declares, not an app
// package. Emphatically still NO kolu-* app package.
// W2 admits the `effect` edge: the frozen control-core dial taps the peer's
// FIRST FRAME through `RpcSerialization.ndjson` — Effect's own parser, the very
// implementation the RPC protocol layer runs — so the D6/#3 "unspeakable
// protocol" classification asks the one framing authority rather than growing a
// second one here. It is already a declared dependency of this package, and it
// is the same kind of leaf the surface edge is: no app package, no kolu-* name.
const ALLOWED_EXTERNAL = [
  "node:",
  "@kolu/surface",
  "@kolu/surface-daemon",
  "effect",
  "osfacts-client",
  "ts-pattern",
];

const isAllowed = (spec: string): boolean =>
  ALLOWED_EXTERNAL.some((p) => spec === p || spec.startsWith(p));

type AstNode = {
  type: string;
  [key: string]: unknown;
};

const isAstNode = (value: unknown): value is AstNode =>
  value !== null &&
  typeof value === "object" &&
  "type" in value &&
  typeof (value as { type?: unknown }).type === "string";

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

const stringLiteralValue = (node: unknown): string | null =>
  isAstNode(node) &&
  (node.type === "StringLiteral" || node.type === "DirectiveLiteral") &&
  typeof node.value === "string"
    ? node.value
    : null;

function importsOf(file: string): string[] {
  const ast = parse(readFileSync(file, "utf8"), {
    sourceFilename: file,
    sourceType: "module",
    createImportExpressions: true,
    plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
  }) as unknown as AstNode;
  const specs = new Set<string>();
  visitAst(ast, (node) => {
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      const spec = stringLiteralValue(node.source);
      if (spec) specs.add(spec);
    }
    if (node.type === "ImportExpression") {
      const spec = stringLiteralValue(node.source);
      if (spec) specs.add(spec);
    }
    if (node.type === "TSImportType") {
      const spec = stringLiteralValue(node.argument);
      if (spec) specs.add(spec);
    }
  });
  return [...specs];
}

function resolveRelative(from: string, spec: string): string {
  const p = resolve(dirname(from), spec);
  return p.endsWith(".ts") ? p : `${p}.ts`;
}

describe("@kolu/surface-daemon-supervisor dependency closure", () => {
  it("reaches only stable, kolu-free external deps (no app coupling leaks into the spine)", () => {
    const reached = new Set<string>();
    const externals = new Set<string>();
    const stack = [ENTRY];
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (reached.has(file)) continue;
      reached.add(file);
      // Don't follow into test files.
      if (file.endsWith(".test.ts")) continue;
      for (const spec of importsOf(file)) {
        if (spec.startsWith(".")) stack.push(resolveRelative(file, spec));
        else externals.add(spec);
      }
    }

    const unexpected = [...externals].filter((s) => !isAllowed(s)).sort();
    expect(
      unexpected,
      `Unlisted external import(s) reached from @kolu/surface-daemon-supervisor: ${unexpected.join(
        ", ",
      )}. The supervisor is shared spine — a kolu-* edge means the code belongs in the caller's soul (packages/server/src/ptyHost), not here. If it is a genuinely stable, app-free dep, add it to ALLOWED_EXTERNAL.`,
    ).toEqual([]);
  });
});
