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
 *  reason after the dash must START with a word character, so neither a bare
 *  `first-frame-guard:allow —` nor a block comment whose only trailing glyph is its
 *  closing star-slash delimiter counts as a reason. */
const ALLOW_MARKER = /first-frame-guard:allow\s*[—-]\s*[A-Za-z0-9]/;

/** A nested LOOP re-targets an UNLABELED `continue` to itself (so such a continue
 *  can't prove anything about the outer `for await`); a nested FUNCTION is a hard
 *  boundary for BOTH forms (a `continue` inside it — labeled or not — belongs to a
 *  loop in that function, never the one we're inspecting). */
const LOOP_TYPES = new Set([
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
]);
// Every function-scope boundary Babel emits: a `continue` inside one belongs to a
// loop in THAT scope, never the `for await` we're inspecting. (Object/class methods
// and a class `static { }` block are scopes too, not just the three function forms.)
const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "ObjectMethod",
  "ClassMethod",
  "ClassPrivateMethod",
  "StaticBlock",
]);

/** AST node keys that hold no child statement/expression — source positions and
 *  attached comments. Both walkers skip them so recursion stays on the tree. */
const SKIP_KEYS = new Set(["loc", "leadingComments", "trailingComments"]);
const childKeys = (rec: Record<string, unknown>): string[] =>
  Object.keys(rec).filter((k) => !SKIP_KEYS.has(k));

/** A non-test `.ts`/`.tsx` source file. (A deliberate small parallel to
 *  `listGuardSourceFiles` in `packages/client/src` — that helper is a
 *  client-package-internal testlib, not cross-package importable, and a bounded
 *  file-lister is a leaf, not a shared receptacle.) */
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

/** Visit every `for await` loop, carrying the labels that target it so a
 *  `continue <label>` can be recognized as self-targeting. A label binds to its
 *  immediate child statement, and labels chain (`outer: inner: for await …` puts
 *  BOTH on the loop), so the pending labels accumulate across a run of
 *  `LabeledStatement`s and reset at any other node. */
function forEachForAwait(
  node: unknown,
  pending: readonly string[],
  cb: (loop: Record<string, unknown>, labels: readonly string[]) => void,
): void {
  if (node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) forEachForAwait(child, [], cb);
    return;
  }
  const rec = node as Record<string, unknown>;
  if (rec.type === "LabeledStatement") {
    const name = (rec.label as { name?: string } | undefined)?.name;
    forEachForAwait(rec.body, name ? [...pending, name] : pending, cb);
    return;
  }
  if (rec.type === "ForOfStatement" && rec.await === true) cb(rec, pending);
  // Every non-labeled node (including the `for await` just reported) recurses its
  // children with the label stack reset — a label reaches only its immediate child.
  for (const key of childKeys(rec)) forEachForAwait(rec[key], [], cb);
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

/** Does the loop body contain a `continue` that targets THIS loop — meaning the
 *  first iteration need not exit, so a top-level `return`/`break` no longer proves a
 *  one-shot? An UNLABELED `continue` targets it when not enclosed by a nested loop
 *  or function; a LABELED `continue` targets it when the label is one of this loop's
 *  own labels AND it is not inside a nested function (a function is a hard scope
 *  boundary — a `continue <label>` there belongs to a loop in that function). */
function hasSelfContinue(
  body: Record<string, unknown>,
  ownLabels: readonly string[],
): boolean {
  let found = false;
  const descend = (n: unknown, nestedLoop: boolean, inFn: boolean): void => {
    if (found || n === null || typeof n !== "object") return;
    if (Array.isArray(n)) {
      for (const c of n) descend(c, nestedLoop, inFn);
      return;
    }
    const rec = n as Record<string, unknown>;
    const type = rec.type;
    if (type === "ContinueStatement") {
      const label = (rec.label as { name?: string } | null | undefined)?.name;
      const targetsThis =
        label == null ? !nestedLoop && !inFn : !inFn && ownLabels.includes(label);
      if (targetsThis) {
        found = true;
        return;
      }
    }
    const t = typeof type === "string" ? type : "";
    const childNestedLoop = nestedLoop || LOOP_TYPES.has(t);
    const childInFn = inFn || FUNCTION_TYPES.has(t);
    for (const key of childKeys(rec)) descend(rec[key], childNestedLoop, childInFn);
  };
  descend(body, false, false);
  return found;
}

function isOneShotForAwait(
  node: Record<string, unknown>,
  ownLabels: readonly string[],
): boolean {
  const body = node.body as Record<string, unknown>;
  // A self-targeting `continue` can start a second iteration, so a top-level exit
  // no longer proves the loop reads exactly one frame.
  if (hasSelfContinue(body, ownLabels)) return false;
  // A top-level `return` always exits; a top-level `break` (labeled or not) can only
  // target this loop or an enclosing one from here, so it too exits this loop's first
  // iteration.
  return bodyStatements(body).some(
    (s) => s.type === "ReturnStatement" || s.type === "BreakStatement",
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
      forEachForAwait(ast.program, [], (loop, labels) => {
        if (!isOneShotForAwait(loop, labels)) return;
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
      forEachForAwait(ast.program, [], (loop, labels) => {
        if (isOneShotForAwait(loop, labels))
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
    // F2 (chain): consecutive labels both bind the loop, so `continue outer` spares it.
    expect(
      collect(
        "async function f(){ outer: inner: for await (const m of s) { if (x) continue outer; return m; } }",
      ),
    ).toEqual([]);
    // F2 (function boundary): a same-named `continue outer` inside a NESTED function
    // targets THAT function's loop, not ours → our loop is still the flagged one-shot.
    expect(
      collect(
        "async function f(){ outer: for await (const m of s) { const g = () => { outer: for (const y of z) { if (y) continue outer; } }; return m; } }",
      ),
    ).toEqual(["1"]);
    // …the boundary holds for an OBJECT METHOD scope too (not just the function forms).
    expect(
      collect(
        "async function f(){ outer: for await (const m of s) { const o = { g(){ outer: for (const y of z) { if (y) continue outer; } } }; return m; } }",
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
    // block comment with a real reason → allow-listed…
    expect(
      isAllowListed(withMarker("/* first-frame-guard:allow — real */\nfor await"), 2),
    ).toBe(true);
    // …but a bare block-comment marker whose only trailing glyph is `*/` → NOT allowed.
    expect(
      isAllowListed(withMarker("/* first-frame-guard:allow — */\nfor await"), 2),
    ).toBe(false);
  });
});
