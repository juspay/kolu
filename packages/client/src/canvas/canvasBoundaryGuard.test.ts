import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listGuardSourceFiles } from "../architectureGuardSources.testlib";

const CANVAS = dirname(fileURLToPath(import.meta.url));
const CLIENT_SRC = dirname(CANVAS);

const DOMAIN = [CANVAS, join(CLIENT_SRC, "useViewState.ts")];

const MODULE_STATE_RE =
  /^(?:export\s+)?const\s+(?:\[[\w,\s]*\]|\w+)\s*=\s*create(?:Signal|Store|Memo)\b/;

const MARKER = "HOST-SCOPING: host-INDEPENDENT by design";

function markedAbove(lines: string[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j]?.trim() ?? "";
    if (t === "") continue;
    if (!t.startsWith("//")) return false;
    if (t.includes(MARKER)) return true;
  }
  return false;
}

function findModuleScopeState(): string[] {
  const violations: string[] = [];
  for (const target of DOMAIN) {
    for (const file of listGuardSourceFiles(target)) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined || !MODULE_STATE_RE.test(line)) continue;
        if (markedAbove(lines, i)) continue;
        violations.push(`${file.replace(`${CLIENT_SRC}/`, "")}:${i + 1}`);
      }
    }
  }
  return violations;
}

describe("canvas boundary guard — no unowned module-scope state in the canvas domain (ownership, not enumeration)", () => {
  it("every module-scope create(Signal|Store|Memo) in canvas/** + useViewState.ts is inside a declared owner (indented) or an annotated host-INDEPENDENT — a new per-host fact goes in the scopedByEntry owner, never a forgotten module-scope field", () => {
    expect(findModuleScopeState()).toEqual([]);
  });
});
