import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  listGuardSourceFiles,
  stripComments,
} from "../architectureGuardSources.testlib";

const CANVAS = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = dirname(CANVAS);

const DOMAIN = [CANVAS, join(CLIENT_SRC, "useViewState.ts")];

const HOST_INDEPENDENT_MODULE = join(
  CLIENT_SRC,
  "hostScope",
  "hostIndependent.ts",
);

const MODULE_STATE_RE =
  /^(?:export\s+)?const\s+(?:\[[\w,\s]*\]|\w+)\s*=\s*(create(?:Signal|Store|Memo)|hostIndependent\w+)\b/;

const IMPORT_RE = /import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g;

function hostIndependentDeclarators(): Set<string> {
  const source = readFileSync(HOST_INDEPENDENT_MODULE, "utf8");
  const names = new Set<string>();
  for (const match of source.matchAll(
    /^export function (hostIndependent\w+)\b/gm,
  )) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

function importsDeclarator(
  file: string,
  source: string,
  name: string,
): boolean {
  for (const match of stripComments(source).matchAll(IMPORT_RE)) {
    const clause = match[1] ?? "";
    const specifier = match[2] ?? "";
    if (!specifier.startsWith(".")) continue;
    if (
      resolve(dirname(file), specifier) !==
      HOST_INDEPENDENT_MODULE.replace(/\.ts$/, "")
    )
      continue;
    for (const entry of clause.split(",")) {
      if (entry.trim() === name) return true;
    }
  }
  return false;
}

function findUndeclaredModuleScopeState(): string[] {
  const declarators = hostIndependentDeclarators();
  const violations: string[] = [];
  for (const target of DOMAIN) {
    for (const file of listGuardSourceFiles(target)) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        const name = MODULE_STATE_RE.exec(line)?.[1];
        if (name === undefined) continue;
        if (declarators.has(name) && importsDeclarator(file, source, name))
          continue;
        violations.push(`${file.replace(`${CLIENT_SRC}/`, "")}:${i + 1}`);
      }
    }
  }
  return violations;
}

describe("canvas boundary guard — no unowned module-scope state in the canvas domain (ownership, not enumeration)", () => {
  it("every module-scope create(Signal|Store|Memo) in canvas/** + useViewState.ts is inside a declared owner (indented) or minted by a hostIndependent* declarator imported from hostScope/hostIndependent — a new per-host fact goes in the scopedByEntry owner, never a forgotten module-scope field", () => {
    expect(findUndeclaredModuleScopeState()).toEqual([]);
  });

  it("hostScope/hostIndependent exports the declarators this guard sanctions, so the escape hatch is one reviewable module and not a per-file claim", () => {
    expect([...hostIndependentDeclarators()].sort()).toEqual([
      "hostIndependentSignal",
      "hostIndependentStore",
    ]);
  });
});
