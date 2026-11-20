/// <reference types="node" />

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  listGuardSourceFiles,
  stripComments,
} from "../architectureGuardSources.testlib";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** A surface `.use()` call site the base client's ref-counted cache dedups. */
const STANDING_USE_RE =
  /\.(cells|collections|streams|events|entries)(\.\w+)?\.use\(/;

/** Where a module-top-level declaration ends: the next line that starts a new
 *  column-0 statement (a declaration's own continuation lines are indented or
 *  start with a closing bracket). */
const NEXT_TOP_LEVEL_STATEMENT = /^[A-Za-z_@$]/gm;

function declarationEnd(text: string, start: number): number {
  const nextLine = text.indexOf("\n", start);
  if (nextLine === -1) return text.length;
  NEXT_TOP_LEVEL_STATEMENT.lastIndex = nextLine + 1;
  return NEXT_TOP_LEVEL_STATEMENT.exec(text)?.index ?? text.length;
}

/** Every module-top-level (column-0) `const NAME = <standing .use() call>`
 *  site with no `createRoot` / `createSharedRoot` owning it, as
 *  `"<file>:<line>"` strings. */
function findUnownedStandingSubscriptions(): string[] {
  const violations: string[] = [];
  for (const file of listGuardSourceFiles(SRC_ROOT)) {
    const text = stripComments(readFileSync(file, "utf8"));
    const topLevelConst = /^const\s+\w+\s*=\s*/gm;
    let m: RegExpExecArray | null = topLevelConst.exec(text);
    while (m !== null) {
      const stmt = text.slice(m.index, declarationEnd(text, m.index));
      if (STANDING_USE_RE.test(stmt) && !/create(Shared)?Root[(<]/.test(stmt)) {
        const line = text.slice(0, m.index).split("\n").length;
        violations.push(`${file.replace(`${SRC_ROOT}/`, "")}:${line}`);
      }
      m = topLevelConst.exec(text);
    }
  }
  return violations;
}

describe("standing-subscription ownership — no bare module-const `.use()` (the ownerless-subscription class)", () => {
  it("every module-top-level cell/collection/stream/event/entries `.use()` is wrapped in an app-lifetime `createRoot` — never an ownerless call the base client's ref-counted cache tears down a microtask after load", () => {
    expect(findUnownedStandingSubscriptions()).toEqual([]);
  });
});
