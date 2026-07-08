/**
 * BOUNDARY GUARD (padi W7 — the ownership-not-enumeration fence): NO module-scope
 * state constructor in the canvas domain outside a declared owner.
 *
 * Per-host CLIENT state now lives in the per-host `scopedByEntry` owner
 * (`hostScope/*`), born inside its `build` — per-host BY CONSTRUCTION. The failure
 * mode W7 removes is the "forgotten field": a `createSignal`/`createStore`/
 * `createMemo` minted at MODULE scope in the canvas subtree is APP-lifetime, shared
 * across every host — the exact class that stranded the camera at module scope in
 * `useCanvasViewport`. A lint list / sanctioned factory was REJECTED as the FIX
 * (ownership is the fix; a syntax gate can't see meaning). This test is only the
 * residual fence that guards the ONE place ownership can't reach — module scope —
 * so a future bare `createSignal` in the canvas subtree fails HERE instead of
 * silently living app-lifetime. The comment-only `HOST-SCOPING:` convention RETIRES
 * into this test: a module-scope constructor here is a VIOLATION unless it declares
 * itself host-INDEPENDENT with the sanctioned marker + a reason.
 *
 * Scope: `canvas/**` (the canvas subtree) + `useViewState.ts` (the view-state facade
 * that co-owns the camera type + host-independent posture). Column-0 `const` is this
 * biome-formatted tree's signal for "module scope" — an indented constructor is
 * inside a component / hook / `createSharedRoot` factory, which already has an owner
 * (the same heuristic `ui/standingSubscriptionOwnership.test.ts` uses).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CANVAS = dirname(fileURLToPath(import.meta.url)); // packages/client/src/canvas
const CLIENT_SRC = dirname(CANVAS); // packages/client/src

/** The canvas domain: the whole `canvas/` subtree + the view-state facade. */
const DOMAIN = [CANVAS, join(CLIENT_SRC, "useViewState.ts")];

/** Every non-test `.ts`/`.tsx` source file under a domain target (a dir or a file). */
function listSourceFiles(target: string): string[] {
  const st = statSync(target);
  if (!st.isDirectory()) {
    if (!/\.tsx?$/.test(target) || /\.test(-d)?\.tsx?$/.test(target)) return [];
    return [target];
  }
  const out: string[] = [];
  for (const name of readdirSync(target)) {
    if (name === "node_modules") continue;
    out.push(...listSourceFiles(join(target, name)));
  }
  return out;
}

/** A MODULE-SCOPE (column-0) reactive STATE constructor — `createSignal`,
 *  `createStore`, or `createMemo`, in either the single (`const x = createMemo(`)
 *  or destructured (`const [a, b] = createSignal(`) form. NOT `createEffect` (not
 *  state) or `createRoot` / `createSharedRoot` (declared owners). */
const MODULE_STATE_RE =
  /^(?:export\s+)?const\s+(?:\[[\w,\s]*\]|\w+)\s*=\s*create(?:Signal|Store|Memo)\b/;

/** The sanctioned host-INDEPENDENT marker. State that deliberately stays outside
 *  the owner declares itself with this + a reason — the convention this test
 *  retires (e.g. `usePendingLayouts`'s `pending`/`nextDefaultSize`). */
const MARKER = "HOST-SCOPING: host-INDEPENDENT by design";

/** Whether a `//` comment carrying {@link MARKER} sits immediately above line `i`
 *  — walk back over blank + full-line-comment lines; stop at the first real code. */
function markedAbove(lines: string[], i: number): boolean {
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j]?.trim() ?? "";
    if (t === "") continue;
    if (!t.startsWith("//")) return false;
    if (t.includes(MARKER)) return true;
  }
  return false;
}

/** Every unannotated module-scope state constructor in the canvas domain, as
 *  `"<file>:<line>"` strings. */
function findModuleScopeState(): string[] {
  const violations: string[] = [];
  for (const target of DOMAIN) {
    for (const file of listSourceFiles(target)) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined || !MODULE_STATE_RE.test(line)) continue;
        if (markedAbove(lines, i)) continue; // declared host-INDEPENDENT — allowed
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
