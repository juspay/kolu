/**
 * The 1:1 guard, generalized — a SECOND hand-rolled per-terminal awareness
 * assembler in EITHER home is UNSPELLABLE, and BOTH homes provably rest on the ONE
 * shared sensing leaf.
 *
 * R9·lib + R9.0 reshaped the per-terminal awareness assembly into ONE shared LEAF,
 * `watchTerminalAwareness` (bridgeKavalTaps → cwd-persist → startAwareness →
 * raw-output activity tap). Its two HOMES drive it differently — the `pulam`
 * daemon discovers terminals by POLLING (`packages/pulam`), kolu-server drives the
 * same leaf from its own spawn/wake/adopt EVENTS (`terminalEndpoint/local.ts`) —
 * but neither re-implements the SENSING. The leaf's own internals — the sensor set
 * (`startAwareness`) and the kaval-tap bridge (`bridgeKavalTaps`) — are the
 * forbidden primitives: a home importing either is re-rolling the leaf. They are
 * not even on the package's export surface (the leaf is the only thing that imports
 * them, by relative path), so this guard is belt-and-suspenders over that — but it
 * is the test that pins the DIFFERENTIAL the original R9·lib done-criterion wanted:
 *
 *   daemon's path  ==  kolu's path  ==  the one `watchTerminalAwareness` leaf.
 *
 * "Cannot reach a primitive" is enforced against every import form (named — keyed
 * off the IMPORTED symbol so an alias can't smuggle one past; namespace; dynamic
 * `import()`), and the forbidden set is DERIVED from the library (the value exports
 * of the two sensing modules), so a newly-added sensing primitive fails the
 * non-drift check until consciously admitted. `serveTerminalWorkspace` is NOT
 * forbidden here (both homes legitimately call it to assemble the served skeleton);
 * the boundary that moved is "who owns the per-terminal SENSING", and that is the
 * leaf, once.
 *
 * Modelled on the `*.closure.test.ts` import-surface guards, but at the granularity
 * of import BINDINGS — the forbidden symbols would, if ever re-exported, live in an
 * otherwise-allowed package, so a module-specifier allowlist can't express "no
 * second assembler".
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const LIB_SRC = dirname(fileURLToPath(import.meta.url)); // packages/pulam-library/src
const PULAM_SRC = resolve(LIB_SRC, "../../pulam/src");
const SERVER_SRC = resolve(LIB_SRC, "../../server/src");

const LIB = "@kolu/pulam-library";

/** The daemon home's entry points (its import graph is walked transitively). */
const DAEMON_ENTRIES = [
  resolve(PULAM_SRC, "daemon.ts"),
  resolve(PULAM_SRC, "bin.ts"),
];
/** The kolu home's sensing file — the one place it drives the leaf. */
const KOLU_SENSING = resolve(SERVER_SRC, "terminalEndpoint/local.ts");

/** The leaf's SENSING-internal modules — their value exports are the primitives a
 *  home must obtain ONLY via `watchTerminalAwareness`. */
const SENSING_MODULES = ["sensors.ts", "kavalChannels.ts"];

/** The one shared sensing entry both homes must rest on. */
const LEAF = "watchTerminalAwareness";

const parse = (file: string): ts.SourceFile =>
  ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

const isExported = (s: ts.Statement): boolean =>
  ts.canHaveModifiers(s) &&
  (ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ??
    false);

/** A module's VALUE (function/const/class) export names — never its `export
 *  type` / `export interface` declarations, which a home may freely import. */
function valueExportsOf(file: string): string[] {
  const names: string[] = [];
  for (const s of parse(file).statements) {
    if (!isExported(s)) continue;
    if (ts.isFunctionDeclaration(s) && s.name) names.push(s.name.text);
    else if (ts.isClassDeclaration(s) && s.name) names.push(s.name.text);
    else if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations)
        if (ts.isIdentifier(d.name)) names.push(d.name.text);
    }
  }
  return names;
}

/** The forbidden SENSING primitives, DERIVED from the library so the denylist
 *  cannot drift: every value export of the two sensing modules. */
const SENSING_PRIMITIVES = new Set<string>(
  SENSING_MODULES.flatMap((m) => valueExportsOf(resolve(LIB_SRC, m))),
);

/** The explicit, reviewable denylist — asserted equal to the derived set, so a
 *  newly-added sensing primitive fails CI here until it is admitted (forcing a
 *  conscious decision) and is then caught in BOTH homes by the same set. */
const EXPECTED_PRIMITIVES = new Set(["startAwareness", "bridgeKavalTaps"]);

/** Pulam-library specifiers a whole-module (namespace / dynamic) import may safely
 *  target — they expose NO sensing primitive: the served-surface factory + its
 *  activity backings, the surface contract, the fs/git endpoint + wiring, the
 *  socket path, the browser-safe schema, the agent projection. Any OTHER
 *  pulam-library specifier — the index `.` (could, if a sensing primitive were ever
 *  re-exported), or an internal sensing module — is forbidden as a whole-module
 *  import (members unprovable). */
const NAMESPACE_SAFE = new Set([
  `${LIB}/serveTerminalWorkspace`,
  `${LIB}/surface`,
  `${LIB}/endpoint`,
  `${LIB}/serveFsGit`,
  `${LIB}/socket`,
  `${LIB}/schema`,
  `${LIB}/agentProjection`,
]);

const isLibSpecifier = (spec: string): boolean =>
  spec === LIB || spec.startsWith(`${LIB}/`);

/** Every forbidden way a source reaches a SENSING primitive: a named import (keyed
 *  off the IMPORTED symbol, so an alias can't hide it), a namespace import of a
 *  primitive-bearing specifier, or a dynamic `import()` of one. */
function assemblyViolations(sourceText: string): string[] {
  const sf = ts.createSourceFile(
    "in-memory.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const out: string[] = [];
  const walk = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isLibSpecifier(node.moduleSpecifier.text)
    ) {
      const spec = node.moduleSpecifier.text;
      const bindings = node.importClause?.namedBindings;
      if (
        bindings &&
        ts.isNamespaceImport(bindings) &&
        !NAMESPACE_SAFE.has(spec)
      )
        out.push(
          `namespace import \`* as ${bindings.name.text}\` of ${spec} — members unprovable`,
        );
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const imported = (el.propertyName ?? el.name).text; // imported symbol, not the local alias
          if (SENSING_PRIMITIVES.has(imported))
            out.push(`named import \`${imported}\` from ${spec}`);
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (
        arg &&
        ts.isStringLiteralLike(arg) &&
        isLibSpecifier(arg.text) &&
        !NAMESPACE_SAFE.has(arg.text)
      )
        out.push(`dynamic import() of ${arg.text} — members unprovable`);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return out;
}

/** Does `sourceText` NAMED-import `LEAF` from a pulam-library specifier? */
function importsLeaf(sourceText: string): boolean {
  const sf = ts.createSourceFile(
    "in-memory.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  let found = false;
  const walk = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isLibSpecifier(node.moduleSpecifier.text)
    ) {
      const b = node.importClause?.namedBindings;
      if (
        b &&
        ts.isNamedImports(b) &&
        b.elements.some((e) => (e.propertyName ?? e.name).text === LEAF)
      )
        found = true;
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);
  return found;
}

/** Walk a home's import graph from its entries through transitive *relative*
 *  imports (skipping test files), collecting sensing violations per file and
 *  whether the shared leaf is imported anywhere in it. */
function walkGraph(
  entries: string[],
  root: string,
): { violations: string[]; importsLeaf: boolean } {
  const seen = new Set<string>();
  const stack = [...entries];
  const violations: string[] = [];
  let leafImported = false;
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file) || file.endsWith(".test.ts")) continue;
    seen.add(file);
    if (!existsSync(file)) continue; // a relative spec that isn't a .ts file (e.g. .json)
    const text = readFileSync(file, "utf8");
    for (const v of assemblyViolations(text))
      violations.push(`${file.slice(root.length + 1)}: ${v}`);
    if (importsLeaf(text)) leafImported = true;
    for (const s of parse(file).statements) {
      if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier))
        continue;
      const spec = s.moduleSpecifier.text;
      if (spec.startsWith(".")) {
        const p = resolve(dirname(file), spec);
        stack.push(p.endsWith(".ts") ? p : `${p}.ts`);
      }
    }
  }
  return { violations, importsLeaf: leafImported };
}

describe("the per-terminal sensing leaf is shared 1:1 by both homes", () => {
  it("the forbidden sensing set is derived from the library, not hand-maintained (non-drift)", () => {
    // A new value export in either sensing module lands in SENSING_PRIMITIVES
    // automatically; this pins the explicit list to it, so the addition fails here
    // until consciously admitted — it can never slip past in either home.
    expect([...SENSING_PRIMITIVES].sort()).toEqual(
      [...EXPECTED_PRIMITIVES].sort(),
    );
  });

  const daemon = walkGraph(DAEMON_ENTRIES, PULAM_SRC);
  const kolu = (() => {
    const text = readFileSync(KOLU_SENSING, "utf8");
    return {
      violations: assemblyViolations(text).map(
        (v) => `terminalEndpoint/local.ts: ${v}`,
      ),
      importsLeaf: importsLeaf(text),
    };
  })();

  it("the DAEMON home rests on the shared leaf — and re-rolls NO sensing", () => {
    expect(
      daemon.importsLeaf,
      "the pulam daemon must import `watchTerminalAwareness` — its per-terminal sensing is the one shared leaf.",
    ).toBe(true);
    expect(
      daemon.violations,
      `the daemon graph reaches a sensing primitive the leaf owns:\n  ${daemon.violations.join(
        "\n  ",
      )}\nThat is a second assembler. Sense terminals ONLY via watchTerminalAwareness.`,
    ).toEqual([]);
  });

  it("the KOLU home rests on the same leaf — and re-rolls NO sensing", () => {
    expect(
      kolu.importsLeaf,
      "kolu-server's local endpoint must import `watchTerminalAwareness` — the SAME leaf the daemon drives.",
    ).toBe(true);
    expect(
      kolu.violations,
      `kolu's local endpoint reaches a sensing primitive the leaf owns:\n  ${kolu.violations.join(
        "\n  ",
      )}\nThat is kolu's old hand-rolled assembler. Sense terminals ONLY via watchTerminalAwareness.`,
    ).toEqual([]);
  });

  it("the DIFFERENTIAL holds: daemon path == kolu path == the one leaf", () => {
    // Both homes import the SAME sensing entry, and neither re-derives it — the
    // exact 1:1 the original R9·lib done-criterion asked for, now that the second
    // home (kolu) is plugged in.
    expect(daemon.importsLeaf && kolu.importsLeaf).toBe(true);
    expect([...daemon.violations, ...kolu.violations]).toEqual([]);
  });

  describe("rejects every assembler bypass (red cases — detector logic)", () => {
    it("an aliased named import (`startAwareness as x`)", () => {
      expect(
        assemblyViolations(
          `import { startAwareness as x } from "${LIB}";\nvoid x;`,
        ),
      ).not.toEqual([]);
    });

    it("an aliased named import of the tap bridge (`bridgeKavalTaps as b`)", () => {
      expect(
        assemblyViolations(
          `import { bridgeKavalTaps as b } from "${LIB}";\nvoid b;`,
        ),
      ).not.toEqual([]);
    });

    it("a namespace import of the index", () => {
      expect(
        assemblyViolations(`import * as aware from "${LIB}";\nvoid aware;`),
      ).not.toEqual([]);
    });

    it("a dynamic import() of an internal sensing module", () => {
      expect(
        assemblyViolations(
          `const m = await import("${LIB}/sensors");\nvoid m;`,
        ),
      ).not.toEqual([]);
    });

    it("PASSES both homes' real, safe imports (the leaf + the composition pieces)", () => {
      // The exact safe shapes the homes use — none reach a sensing primitive.
      expect(
        assemblyViolations(
          [
            `import { watchTerminalAwareness, makeAwarenessSink, createActivityTracker, seedAwarenessValue, type AwarenessRecord, type AwarenessSink } from "${LIB}";`,
            `import { serveTerminalWorkspace, liveActivity, quietActivity } from "${LIB}/serveTerminalWorkspace";`,
            `import { createTerminalWorkspaceEndpoint } from "${LIB}/endpoint";`,
            `import { terminalWorkspaceSurface } from "${LIB}/surface";`,
            `import { pulamSocketPath } from "${LIB}/socket";`,
          ].join("\n"),
        ),
      ).toEqual([]);
    });
  });
});
