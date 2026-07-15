/**
 * NEGATIVE-PROPERTY PIN (SR6 — adopt before you mint): no production consumer
 * spells a one-shot first-frame read as a `for await (…)` loop with a top-level
 * `return`/`break` — the exact shape this adoption sweep deleted. This is a
 * SPELLING fence, not a total property guard: it pins the deleted syntax, not every
 * conceivable one-shot advance (a manual `iter.next()`, an
 * `(await Array.fromAsync(s))[0]` advances one frame yet stays out of scope). A
 * snapshot-then-delta stream (a cell sub, a present-key collection `get`, a `keys`
 * stream, kaval's yields-once `exit` stream) OPENS with its snapshot frame, so
 * "read the first frame and stop" has one home: `firstFrameOrThrow` /
 * `firstFrameOrUndefined` (`@kolu/surface/first-frame`). Hand-advancing the
 * iterator instead — `for await (…) return frame` — is the defect this sweep
 * deleted (kaval-tui's `readExitCode` and server's `readPadiMemoryOnce`, SR6), and
 * this test is the residual fence that keeps it deleted.
 *
 * THE SHAPE THE GUARD FLAGS (precise, AST — not a regex that a nested `(` in the
 * header would fool): a `for await (X of Y)` loop whose body BOTH (a) reaches a
 * `return` or unlabeled `break` as a TOP-LEVEL statement (a direct child of the
 * loop body, not nested inside an `if`/`switch`/`try`) AND (b) has NO `continue`
 * targeting this loop anywhere in its body — neither an unlabeled `continue` outside
 * a nested loop, nor a `continue <thisLoopsLabel>` (which re-targets this loop even
 * from inside a nested one). Both are needed to prove a one-shot: a top-level exit
 * alone is not enough if a `continue` can start a second iteration first — `for
 * await (const m of s) { if (m.kind === "snapshot") continue; return m; }` reaches a
 * top-level `return` yet consumes MULTIPLE frames (it skips the snapshot to read a
 * delta), a filter-first shape the primitive doesn't serve. So a body with a
 * self-targeting `continue` is spared. A snapshot-then-delta consumer never trips
 * this either way: its exits are CONDITIONAL (`if (msg.kind === "overflow") break`,
 * `if (m !== null) return`), nested inside a conditional, so no TOP-LEVEL exit
 * exists — the loop keeps iterating, exactly why the primitive (which closes the
 * iterator after one frame) can't fit it, and why the guard must not flag it.
 *
 * SCOPE: `kaval-tui/src` + `server/src` — the two consumer trees where a surface
 * one-shot read occurs (kaval-tui's `exit` reads; server's `readPadiMemoryOnce`).
 * The sweep confirmed padi/client hold no such site, and a purely-syntactic scan
 * of those large trees would risk flagging a NON-surface one-shot the primitive
 * doesn't serve — so the scope is the two trees the property actually lives in.
 *
 * ALLOW-LIST: a genuine one-shot the primitive CANNOT express marks itself with a
 * `first-frame-guard:allow — <reason>` comment on, or in the comment block DIRECTLY
 * above (no blank line between), the `for await`. The reason after the `—` is
 * mandatory and non-empty, so an allow-list entry is never a silent mute. The one
 * standing entry is `consumeExit` (kaval-tui/src/wait.ts): its `settle` side effect
 * must fire at frame-arrival, BEFORE the iterator's async close is awaited, because
 * it races `consumeOutput` + the timeout in a `Promise.all` and `settle` is
 * first-wins — an ordering the primitive (which awaits close before it resolves)
 * would change.
 */

import { parse } from "@babel/parser";
import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SERVER_SRC = dirname(fileURLToPath(import.meta.url)); // packages/server/src
const PACKAGES = join(SERVER_SRC, "..", ".."); // packages/
const SCANNED_TREES = [join(PACKAGES, "kaval-tui", "src"), SERVER_SRC];

/** The sanctioned opt-out: a genuine one-shot the primitive can't express. The
 *  `\S` after the dash makes a NON-EMPTY reason mandatory — a bare
 *  `first-frame-guard:allow —` never mutes anything. */
const ALLOW_MARKER = /first-frame-guard:allow\s*[—-]\s*\S/;

/** A `continue`/`break` inside one of these re-targets to the NESTED construct — so
 *  an UNLABELED continue inside it can't prove anything about the `for await` we're
 *  inspecting. (A LABELED continue naming the inspected loop still targets it, even
 *  from within one of these — handled separately.) */
const NESTED_TARGET_TYPES = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

/** A non-test `.ts`/`.tsx` source file. */
const isSourceFile = (p: string): boolean =>
  /\.tsx?$/.test(p) && !/\.test(-d)?\.tsx?$/.test(p);

function listSourceFiles(tree: string): string[] {
  return globSync("**/*.{ts,tsx}", {
    cwd: tree,
    exclude: (p) => p.includes("node_modules"),
  })
    .filter(isSourceFile)
    .map((rel) => join(tree, rel));
}

/** Visit every `for await` loop, carrying the label that targets it (a
 *  `LabeledStatement` wrapping the loop) so a `continue <label>` can be recognized
 *  as self-targeting. A label binds only to its immediate child statement, so it is
 *  passed down exactly one hop. */
function forEachForAwait(
  node: unknown,
  ownLabel: string | null,
  cb: (loop: Record<string, unknown>, label: string | null) => void,
): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) forEachForAwait(child, null, cb);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "LabeledStatement") {
    const name = (rec.label as { name?: string } | undefined)?.name ?? null;
    forEachForAwait(rec.body, name, cb);
    return;
  }
  if (rec.type === "ForOfStatement" && rec.await === true) {
    cb(rec, ownLabel);
    forEachForAwait(rec.body, null, cb);
    forEachForAwait(rec.right, null, cb);
    return;
  }
  for (const key of Object.keys(rec)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments")
      continue;
    forEachForAwait(rec[key], null, cb);
  }
}

/** The direct statements of a loop body — the block's children, or the single
 *  braceless body statement. */
function bodyStatements(
  body: Record<string, unknown>,
): Record<string, unknown>[] {
  if (body.type === "BlockStatement" && Array.isArray(body.body))
    return body.body as Record<string, unknown>[];
  return [body];
}

/** Does the loop body contain a `continue` that targets THIS loop — an unlabeled
 *  `continue` not enclosed by a nested loop/function, OR a `continue <ownLabel>`
 *  anywhere (even inside a nested loop, since the label re-targets the outer loop)?
 *  Such a `continue` means the first iteration need not exit, so a top-level
 *  `return`/`break` no longer proves a one-shot. */
function hasSelfContinue(
  body: Record<string, unknown>,
  ownLabel: string | null,
): boolean {
  let found = false;
  const descend = (n: unknown, nested: boolean): void => {
    if (found || n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const c of n) descend(c, nested);
      return;
    }
    const rec = n as Record<string, unknown>;
    const type = rec.type;
    if (type === "ContinueStatement") {
      const label = (rec.label as { name?: string } | null | undefined)?.name;
      if (label == null ? !nested : label === ownLabel) {
        found = true;
        return;
      }
    }
    const childNested =
      nested || (typeof type === "string" && NESTED_TARGET_TYPES.has(type));
    for (const key of Object.keys(rec)) {
      if (key === "loc" || key === "leadingComments" || key === "trailingComments")
        continue;
      descend(rec[key], childNested);
    }
  };
  descend(body, false);
  return found;
}

function isOneShotForAwait(
  node: Record<string, unknown>,
  ownLabel: string | null,
): boolean {
  const body = node.body as Record<string, unknown>;
  // A self-targeting `continue` can start a second iteration, so a top-level exit
  // no longer proves the loop reads exactly one frame.
  if (hasSelfContinue(body, ownLabel)) return false;
  return bodyStatements(body).some(
    (s) =>
      s.type === "ReturnStatement" ||
      (s.type === "BreakStatement" && s.label == null),
  );
}

/** The `for await` at 1-based `line` is allow-listed if the marker sits on that
 *  line or in the comment block DIRECTLY above it. The upward scan stops at the
 *  first blank line or non-comment line, so a marker in a SEPARATED block never
 *  reaches down to mute an unrelated loop. */
function isAllowListed(lines: string[], line: number): boolean {
  if (ALLOW_MARKER.test(lines[line - 1] ?? "")) return true;
  for (let i = line - 2; i >= 0; i--) {
    const t = lines[i]?.trim() ?? "";
    if (t === "") return false; // a blank line breaks the "directly above" block
    if (!(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")))
      return false;
    if (ALLOW_MARKER.test(t)) return true;
  }
  return false;
}

function findViolations(): string[] {
  const violations: string[] = [];
  for (const tree of SCANNED_TREES) {
    for (const file of listSourceFiles(tree)) {
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      const ast = parse(text, {
        sourceType: "module",
        plugins: file.endsWith(".tsx") ? ["typescript", "jsx"] : ["typescript"],
      });
      const rel = file.replace(`${PACKAGES}/`, "");
      forEachForAwait(ast.program, null, (loop, label) => {
        if (!isOneShotForAwait(loop, label)) return;
        const line = (loop.loc as { start: { line: number } } | undefined)?.start
          .line;
        if (line !== undefined && isAllowListed(lines, line)) return;
        violations.push(`${rel}:${line ?? "?"}`);
      });
    }
  }
  return violations;
}

describe("first-frame one-shot guard — no consumer spells a one-shot first-frame read as a `for await (…) return/break` loop, the shape this sweep deleted (SR6)", () => {
  it("kaval-tui/src + server/src open-code no un-allow-listed one-shot `for await (…) return/break`; the yields-once first-frame read rides `firstFrameOrThrow`/`firstFrameOrUndefined`", () => {
    expect(findViolations()).toEqual([]);
  });

  // The detector's own competence: it flags a genuine one-shot, spares a
  // conditional-exit delta loop, and — the F2 refinement — spares a top-level return
  // a `continue` (labeled or not) can skip past, while still flagging when a nested
  // loop's `continue` can't reach the outer one-shot.
  it("flags an unconditional one-shot; spares a conditional-exit or continue-guarded loop", () => {
    const collect = (src: string): string[] => {
      const ast = parse(src, { sourceType: "module", plugins: ["typescript"] });
      const hits: string[] = [];
      forEachForAwait(ast.program, null, (loop, label) => {
        if (isOneShotForAwait(loop, label))
          hits.push(String((loop.loc as { start: { line: number } }).start.line));
      });
      return hits;
    };
    // one-shot: braced return, braceless return, and settle-then-return.
    expect(
      collect(
        "async function f(){ for await (const m of await c.g({i})) { return m.x; } }",
      ),
    ).toEqual(["1"]);
    expect(
      collect("async function f(){ for await (const m of s) return m; }"),
    ).toEqual(["1"]);
    expect(
      collect("async function f(){ for await (const _m of s) { g(); return; } }"),
    ).toEqual(["1"]);
    // delta loop: every exit is nested in an `if` → no top-level exit → NOT flagged.
    expect(
      collect(
        "async function f(){ for await (const m of s) { if (m.k==='o') break; await w(m.d); } }",
      ),
    ).toEqual([]);
    expect(
      collect(
        "async function f(){ for await (const m of s) { if (m!==null) return m; buf+=m; } }",
      ),
    ).toEqual([]);
    // F2: a top-level return an UNLABELED `continue` can skip → multi-frame → spared.
    expect(
      collect(
        "async function f(){ for await (const m of s) { if (m.kind==='snapshot') continue; return m; } }",
      ),
    ).toEqual([]);
    // F2: a LABELED `continue` targeting this loop — even the plain form — also spares it.
    expect(
      collect(
        "async function f(){ outer: for await (const m of s) { if (m.kind==='snapshot') continue outer; return m; } }",
      ),
    ).toEqual([]);
    // …a `continue outer` from INSIDE a nested loop still re-targets the outer one → spared.
    expect(
      collect(
        "async function f(){ outer: for await (const m of s) { for (const x of m) { if (x) continue outer; } return m; } }",
      ),
    ).toEqual([]);
    // …but a `continue` confined to a NESTED loop does NOT spare the outer one-shot.
    expect(
      collect(
        "async function f(){ for await (const m of s) { for (const x of m) { if (x) continue; } return m; } }",
      ),
    ).toEqual(["1"]);
  });

  // F5: the allow-list marker must be non-empty AND directly attached, or it mutes
  // nothing — a bare marker and a blank-separated marker do NOT allow-list.
  it("allow-list requires a non-empty reason in the comment block directly above", () => {
    const withMarker = (l: string): string[] => l.split("\n");
    // directly-attached, with a reason → allow-listed.
    expect(
      isAllowListed(withMarker("// first-frame-guard:allow — real reason\nfor await"), 2),
    ).toBe(true);
    // bare marker, no reason after the dash → NOT allow-listed.
    expect(
      isAllowListed(withMarker("// first-frame-guard:allow —\nfor await"), 2),
    ).toBe(false);
    // separated by a blank line → NOT allow-listed (not "directly above").
    expect(
      isAllowListed(
        withMarker("// first-frame-guard:allow — reason\n\nfor await"),
        3,
      ),
    ).toBe(false);
  });
});
