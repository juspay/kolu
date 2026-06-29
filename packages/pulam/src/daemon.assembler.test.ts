/**
 * The 1:1 guard — the pulam daemon owns NO awareness assembly of its own.
 *
 * R9·lib lifted the per-terminal awareness assembly (seed → sink → tap-bridge →
 * sensors → cwd-persist → activity tap → reconcile) into the pulam-library behind
 * ONE entry point, `createPulam`. The daemon is now a thin serve-wrapper: dial a
 * kaval, `createPulam(...)`, serve the result. There is exactly one assembler, in
 * the library — the daemon and (in R9.0) kolu both rest on it.
 *
 * This test makes a *second* assembler in the daemon UNSPELLABLE rather than
 * merely discouraged: it parses `daemon.ts`'s imports and asserts none of the
 * awareness-assembly primitives are reachable by name. You cannot re-assemble
 * awareness in the daemon without importing at least one of them — and that
 * import fails here. The companion guarantee (the daemon DOES rest on the
 * library's assembly) is the asserted presence of `createPulam`.
 *
 * Modelled on the `*.closure.test.ts` import-surface guards
 * (`surface-daemon-supervisor/src/deps.closure.test.ts`,
 * `kaval/src/buildId.closure.test.ts`), but at the granularity of import
 * *bindings* rather than module specifiers, because the forbidden symbols live in
 * an otherwise-allowed package (`@kolu/pulam-library`).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
const DAEMON = resolve(SRC, "daemon.ts");

/** The awareness-assembly primitives that now live ONLY behind `createPulam`.
 *  The daemon importing any of these would mean it is re-assembling awareness
 *  itself — a second assembler. (All are value exports; the daemon may still
 *  import the awareness *types* like `AwarenessValue`/`TerminalId`.) */
const FORBIDDEN = new Set([
  "startAwareness",
  "bridgeKavalTaps",
  "makeAwarenessSink",
  "createActivityTracker",
  "sameActivitySet",
  "seedAwarenessValue",
]);

/** Every value/type *name* `daemon.ts` pulls in via an `import { … }` binding. */
function importedNames(file: string): Set<string> {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const names = new Set<string>();
  for (const stmt of source.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    const clause = stmt.importClause;
    if (!clause) continue;
    if (clause.name) names.add(clause.name.text); // default import
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      names.add(bindings.name.text);
    if (bindings && ts.isNamedImports(bindings)) {
      for (const el of bindings.elements) names.add(el.name.text);
    }
  }
  return names;
}

describe("pulam daemon — no second awareness assembler (lib↔daemon 1:1)", () => {
  const imported = importedNames(DAEMON);

  it("rests on the library's single assembly (`createPulam`)", () => {
    expect(
      imported.has("createPulam"),
      "daemon.ts must import `createPulam` — its awareness backing is the pulam-library's one assembly, not a hand-rolled copy.",
    ).toBe(true);
  });

  it("imports NONE of the awareness-assembly primitives (they live only behind createPulam)", () => {
    const leaked = [...imported].filter((n) => FORBIDDEN.has(n)).sort();
    expect(
      leaked,
      `daemon.ts imports awareness-assembly primitive(s) the pulam-library now owns: ${leaked.join(
        ", ",
      )}. That is a second assembler. Assemble through createPulam instead — these symbols must be unreachable from the daemon.`,
    ).toEqual([]);
  });
});
