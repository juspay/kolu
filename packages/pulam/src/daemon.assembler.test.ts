/**
 * The 1:1 guard — a second awareness assembler in the pulam daemon is UNSPELLABLE.
 *
 * R9·lib lifted the per-terminal awareness assembly (seed → sink → tap-bridge →
 * sensors → cwd-persist → activity tap → reconcile) into the pulam-library behind
 * ONE entry point, `createPulam`. The daemon is now a thin serve-wrapper: dial a
 * kaval, `createPulam(...)`, serve the result. Today the daemon owns no second
 * assembler — `createPulam` IS its awareness assembly, and the daemon rests on it
 * as its one consumer. kolu still hand-rolls its own assembler in-process; it
 * converges on `createPulam` in R9.0, once the library grows a sink seam for
 * kolu's richer sink.
 *
 * This test walks the daemon's import graph (`daemon.ts` + `bin.ts` + their
 * transitive *relative* imports) and proves it cannot reach an awareness-assembly
 * primitive — `createPulam(...).served` is the **only** way it can obtain the
 * served skeleton. "Cannot reach" is enforced against every form an import can
 * take, so the bypasses a naïve name-scan would miss are all closed:
 *
 *   - a **named import** is keyed off the IMPORTED symbol, so an alias
 *     (`import { startAwareness as x }`) can't smuggle one past;
 *   - a **namespace import** (`import * as a from "@kolu/pulam-library"`) of any
 *     primitive-bearing module is forbidden outright — its members are unprovable;
 *   - a **dynamic `import()`** of such a module is rejected the same way;
 *   - `serveTerminalWorkspace` — the skeleton factory — is itself a primitive, so
 *     the daemon must obtain the skeleton ONLY as `createPulam(...).served`.
 *
 * The denylist is **derived from the library**, not hand-maintained: it is the
 * value-export surface of the assembly modules (+ the awareness seed helpers), so
 * a newly-added primitive can't silently slip past — it fails the non-drift check
 * until it is admitted to the list, and is then caught everywhere by construction.
 *
 * Each bypass has a red case below proving the guard rejects it. Modelled on the
 * `*.closure.test.ts` import-surface guards
 * (`surface-daemon-supervisor/src/deps.closure.test.ts`,
 * `kaval/src/buildId.closure.test.ts`), but at the granularity of import
 * *bindings*, because the forbidden symbols live in an otherwise-allowed package.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url)); // packages/pulam/src
const LIB_SRC = resolve(SRC, "../../pulam-library/src"); // packages/pulam-library/src
const DAEMON_ENTRIES = [resolve(SRC, "daemon.ts"), resolve(SRC, "bin.ts")];

const LIB = "@kolu/pulam-library";

/** The library modules whose VALUE exports ARE the awareness-assembly machinery
 *  the daemon must obtain only via `createPulam`. */
const ASSEMBLY_MODULES = [
  "sensors.ts",
  "kavalChannels.ts",
  "awarenessSink.ts",
  "activity.ts",
  "serveTerminalWorkspace.ts",
];

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
 *  type` / `export interface` declarations, which the daemon may freely import. */
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

/** The actual assembly-primitive export set, derived from the library so the
 *  denylist cannot drift: every value export of the assembly modules, plus the
 *  awareness seed helpers (which live in the shared `schema` module). */
const ASSEMBLY_PRIMITIVES = new Set<string>([
  ...ASSEMBLY_MODULES.flatMap((m) => valueExportsOf(resolve(LIB_SRC, m))),
  ...valueExportsOf(resolve(LIB_SRC, "schema.ts")).filter((n) =>
    n.startsWith("seed"),
  ),
]);

/** The explicit, reviewable denylist — asserted equal to the derived set, so a
 *  newly-added assembly primitive fails CI here until it is admitted (forcing a
 *  conscious decision) and is then caught in the daemon by the same set. */
const EXPECTED_PRIMITIVES = new Set([
  "startAwareness",
  "bridgeKavalTaps",
  "makeAwarenessSink",
  "createActivityTracker",
  "sameActivitySet",
  "quietActivity",
  "serveTerminalWorkspace",
  "seedAwarenessLive",
  "seedAwarenessValue",
]);

/** Pulam-library specifiers a whole-module (namespace / dynamic) import may
 *  safely target — they expose NO assembly primitive: `createPulam` (the allowed
 *  assembly path), the surface contract, the fs/git endpoint, the socket path,
 *  and the fs/git wiring. Any OTHER pulam-library specifier — the index, `/schema`,
 *  `/serveTerminalWorkspace`, or an internal assembly module — can reach a
 *  primitive, so a whole-module import of it is forbidden (members unprovable). */
const NAMESPACE_SAFE = new Set([
  `${LIB}/createPulam`,
  `${LIB}/surface`,
  `${LIB}/endpoint`,
  `${LIB}/socket`,
  `${LIB}/serveFsGit`,
]);

const isLibSpecifier = (spec: string): boolean =>
  spec === LIB || spec.startsWith(`${LIB}/`);

/** Every forbidden way a source reaches an awareness-assembly primitive: a named
 *  import (keyed off the IMPORTED symbol, so an alias can't hide it), a namespace
 *  import of a primitive-bearing module, or a dynamic `import()` of one. */
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
          if (ASSEMBLY_PRIMITIVES.has(imported))
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

/** Walk the daemon's import graph from its entries through transitive *relative*
 *  imports (skipping test files), collecting assembly violations per file and
 *  whether `createPulam` is imported anywhere in it. */
function walkDaemonGraph(): {
  violations: string[];
  importsCreatePulam: boolean;
} {
  const seen = new Set<string>();
  const stack = [...DAEMON_ENTRIES];
  const violations: string[] = [];
  let importsCreatePulam = false;
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file) || file.endsWith(".test.ts")) continue;
    seen.add(file);
    if (!existsSync(file)) continue; // a relative spec that isn't a .ts file (e.g. .json)
    const text = readFileSync(file, "utf8");
    for (const v of assemblyViolations(text))
      violations.push(`${file.slice(SRC.length + 1)}: ${v}`);
    for (const s of parse(file).statements) {
      if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier))
        continue;
      const spec = s.moduleSpecifier.text;
      if (spec === `${LIB}/createPulam`) {
        const b = s.importClause?.namedBindings;
        if (
          b &&
          ts.isNamedImports(b) &&
          b.elements.some(
            (e) => (e.propertyName ?? e.name).text === "createPulam",
          )
        )
          importsCreatePulam = true;
      }
      if (spec.startsWith(".")) {
        const p = resolve(dirname(file), spec);
        stack.push(p.endsWith(".ts") ? p : `${p}.ts`);
      }
    }
  }
  return { violations, importsCreatePulam };
}

describe("pulam daemon — no second awareness assembler (lib↔daemon 1:1)", () => {
  it("the denylist is derived from the library, not hand-maintained (non-drift)", () => {
    // A new value export in any assembly module (or a new awareness seed) lands in
    // ASSEMBLY_PRIMITIVES automatically; this pins the explicit list to it, so the
    // addition fails here until consciously admitted — it can never slip past.
    expect([...ASSEMBLY_PRIMITIVES].sort()).toEqual(
      [...EXPECTED_PRIMITIVES].sort(),
    );
  });

  const graph = walkDaemonGraph();

  it("rests on `createPulam` — its one and only assembly path", () => {
    expect(
      graph.importsCreatePulam,
      "the daemon must import `createPulam` — its awareness backing is the pulam-library's one assembly.",
    ).toBe(true);
  });

  it("reaches NO awareness-assembly primitive by any import form", () => {
    expect(
      graph.violations,
      `the daemon graph can reach awareness-assembly primitive(s) the pulam-library owns:\n  ${graph.violations.join(
        "\n  ",
      )}\nThat is a second assembler. Obtain the served skeleton ONLY as createPulam(...).served.`,
    ).toEqual([]);
  });

  describe("rejects every assembler bypass (red cases)", () => {
    it("an aliased named import (`startAwareness as x`)", () => {
      expect(
        assemblyViolations(
          `import { startAwareness as x } from "${LIB}";\nvoid x;`,
        ),
      ).not.toEqual([]);
    });

    it("a namespace import of the index", () => {
      expect(
        assemblyViolations(`import * as aware from "${LIB}";\nvoid aware;`),
      ).not.toEqual([]);
    });

    it("a namespace import of an internal assembly module", () => {
      expect(
        assemblyViolations(`import * as s from "${LIB}/sensors";\nvoid s;`),
      ).not.toEqual([]);
    });

    it("a dynamic import() of an assembly module", () => {
      expect(
        assemblyViolations(
          `const m = await import("${LIB}/sensors");\nvoid m;`,
        ),
      ).not.toEqual([]);
    });

    it("a direct import of the skeleton factory `serveTerminalWorkspace`", () => {
      expect(
        assemblyViolations(
          `import { serveTerminalWorkspace } from "${LIB}/serveTerminalWorkspace";\nvoid serveTerminalWorkspace;`,
        ),
      ).not.toEqual([]);
    });

    it("but PASSES the daemon's real, safe imports (createPulam + the leaf seams)", () => {
      // The exact safe shapes the daemon uses — none reach a primitive.
      expect(
        assemblyViolations(
          [
            `import { createPulam } from "${LIB}/createPulam";`,
            `import { createTerminalWorkspaceEndpoint } from "${LIB}/endpoint";`,
            `import { type AwarenessValue, terminalWorkspaceSurface, type TerminalId } from "${LIB}/surface";`,
            `import { pulamSocketPath } from "${LIB}/socket";`,
          ].join("\n"),
        ),
      ).toEqual([]);
    });
  });
});
